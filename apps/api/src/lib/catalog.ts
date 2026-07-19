import type { Prisma, PrismaClient, Title } from '@prisma/client';
import { STREAMING_SERVICES, type Region } from '@watchly/shared';
import { POSTER_BASE, detail, discover, genreMap, pickTrailer } from './tmdb.js';
import { buildQueue, type QueueFilters } from './queue.js';
import { env } from '../env.js';

/**
 * Lazy, write-through catalog.
 *
 * Titles are fetched from TMDB on demand and cached in Postgres as we go, rather
 * than bulk-synced ahead of time. The cache still exists — and it still has to,
 * because Vote is foreign-keyed to Title, which is what makes "don't re-show a
 * title swiped in the last 30 days" one SQL clause and what makes past sessions
 * openable without re-hydrating fifteen titles from TMDB.
 *
 * What's lazy is *when* it fills: the first session on a cold cache pays a couple
 * of seconds fetching, every session after that is served from Postgres.
 *
 * The one thing TMDB genuinely cannot do for us is filter by "has a trailer" —
 * there's no such parameter on /discover, and roughly HALF of all titles don't
 * have one. So we over-fetch candidates and drop the trailerless ones here.
 */

/** How many raw candidates to pull for each title we actually need. */
const OVERFETCH = 2.5;

/**
 * Parallel detail fetches. TMDB allows ~50 req/s; 20 in flight is well clear of
 * that and cuts the cold-start wait roughly in half versus 8, because the whole
 * cost here is round-trip latency, not our CPU.
 */
const CONCURRENCY = 20;

/** Give up after this many TMDB rounds rather than stall the user forever. */
const MAX_ROUNDS = 3;

/**
 * How long a cached title's streaming providers are trusted. Titles come and go
 * from Netflix constantly; a week-old provider list is fine, a month-old one will
 * start sending people to apps that no longer have the title.
 */
const STALE_AFTER_DAYS = 7;

/**
 * Cap on stale titles re-checked per request. Each is an individual UPDATE, and
 * one user's session must never turn into a catalogue-wide repair job.
 */
const MAX_REFRESH_PER_REQUEST = 8;

const providerIdsFor = (region: Region, services: string[]): number[] =>
  STREAMING_SERVICES.filter((s) => services.includes(s.id))
    .map((s) => s.tmdbProviderIds[region])
    .filter((id): id is number => id !== undefined);

/** TMDB provider_id -> our service id, for this region. */
function providerLookup(region: Region): Map<number, string> {
  const map = new Map<number, string>();
  for (const svc of STREAMING_SERVICES) {
    const id = svc.tmdbProviderIds[region];
    if (id !== undefined) map.set(id, svc.id);
  }
  return map;
}

/**
 * Returns a queue of `limit` titles, fetching from TMDB only if the cache can't
 * already satisfy the filters.
 */
export async function ensureQueue(
  prisma: PrismaClient,
  filters: QueueFilters,
  excludeForUserIds: string[],
): Promise<Title[]> {
  // No TMDB key: serve whatever is cached rather than throwing. Keeps the app
  // degraded-but-working if the key goes missing in production, and keeps the test
  // suite hermetic — tests seed their own fixtures and must never hit the network.
  if (!env.TMDB_API_KEY) {
    return buildQueue(prisma, filters, excludeForUserIds);
  }

  /**
   * ALWAYS ask TMDB what currently matches these filters — even when the cache
   * looks full.
   *
   * The earlier version only called TMDB when the cache ran short, which meant a
   * user with a warm cache would never see a film released last week: we had
   * fifteen perfectly good cached titles, so we never asked. The catalogue would
   * quietly rot, and "popular this week" would mean "popular whenever we last
   * happened to be short".
   *
   * This is cheap. /discover is ONE request (~200ms) and returns the live ranking.
   * The expensive part — a details call per title, to get the trailer — is only
   * paid for titles we've never seen. A returning user typically pays for the two
   * or three that are genuinely new since last time.
   */
  await refreshFilterWindow(prisma, filters, 0);

  let queue = await buildQueue(prisma, filters, excludeForUserIds);

  // Still short? Walk deeper into TMDB's pages. Happens on a cold cache, or when
  // someone has swiped through most of what matches a narrow filter.
  for (let round = 1; round < MAX_ROUNDS && queue.length < filters.limit; round++) {
    const added = await refreshFilterWindow(prisma, filters, round);
    if (added === 0) break; // TMDB has nothing more for these filters.
    queue = await buildQueue(prisma, filters, excludeForUserIds);
  }

  return queue;
}

/**
 * Asks TMDB what currently matches these exact filters, and makes sure Postgres
 * knows about all of it.
 *
 * The /discover query IS the user's filter, translated: their region, their
 * services' TMDB provider ids, their mood's genre ids, their runtime cap. So the
 * result is the live, current ranking for what they asked for — not a snapshot
 * from whenever a cron last ran.
 *
 * Returns how many titles were newly cached.
 */
async function refreshFilterWindow(
  prisma: PrismaClient,
  filters: QueueFilters,
  round: number,
): Promise<number> {
  const { region, services, titleType, genres, maxRuntime, limit } = filters;

  const providerIds = providerIdsFor(region, services);
  if (providerIds.length === 0) return 0;

  const lookup = providerLookup(region);

  // ONE media type — the user picked movie night or series night, so fetching the
  // other would burn TMDB calls on titles that can never enter the queue.
  const media = [titleType === 'MOVIE' ? 'movie' : 'tv'] as const;
  // Enough candidates to survive the ~50% trailer cull, at 20 results per page.
  const pages = Math.max(1, Math.ceil((limit * OVERFETCH) / 20));

  const candidates: { tmdbId: number; media: 'movie' | 'tv'; item: TmdbItem }[] = [];

  for (const m of media) {
    const genreIds = genres.length > 0 ? await resolveGenreIds(m, genres) : [];

    for (let p = 0; p < pages; p++) {
      const page = round * pages + p + 1;

      const res = await discover(m, {
        watch_region: region,
        with_watch_providers: providerIds.join('|'),
        with_watch_monetization_types: 'flatrate|free|ads',
        // The live popularity ranking — this is what makes "latest" actually latest.
        sort_by: 'popularity.desc',
        'vote_count.gte': '20',
        page: String(page),
        ...(genreIds.length > 0 && { with_genres: genreIds.join('|') }),
        // TMDB's runtime filter is movies-only; TV is filtered in SQL afterwards.
        ...(maxRuntime !== null && m === 'movie' && { 'with_runtime.lte': String(maxRuntime) }),
      });

      for (const item of res.results) {
        candidates.push({ tmdbId: item.id, media: m, item });
      }

      if (page >= res.total_pages) break;
    }
  }

  if (candidates.length === 0) return 0;

  const key = (c: { tmdbId: number; media: 'movie' | 'tv' }) =>
    `${c.media === 'movie' ? 'MOVIE' : 'TV'}:${c.tmdbId}`;

  const existing = await prisma.title.findMany({
    where: {
      OR: candidates.map((c) => ({
        tmdbId: c.tmdbId,
        type: c.media === 'movie' ? ('MOVIE' as const) : ('TV' as const),
      })),
    },
    select: { id: true, tmdbId: true, type: true, cachedAt: true },
  });

  const known = new Map(existing.map((e) => [`${e.type}:${e.tmdbId}`, e]));

  const unseen = candidates.filter((c) => !known.has(key(c)));

  /**
   * Titles we already have, but cached long enough ago that their streaming
   * providers may have moved. A title that left Netflix last month would otherwise
   * sit in the cache advertising Netflix forever, and the results screen would
   * send someone to an app that no longer has it — the exact failure the spec calls
   * the punchline.
   *
   * Capped per request so a big stale window can't turn one session into a
   * thirty-second refresh.
   */
  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const stale = candidates
    .filter((c) => {
      const row = known.get(key(c));
      return row && row.cachedAt < staleCutoff;
    })
    .slice(0, MAX_REFRESH_PER_REQUEST);

  /**
   * Fetch details in parallel, then write ONCE.
   *
   * The first cut did a prisma.upsert() per title, and each is a separate round
   * trip to Neon — ~100ms apiece from Singapore, so 30 titles burned 3 seconds of
   * pure latency before TMDB was even counted. createMany collapses that to one.
   */
  const rows: Prisma.TitleCreateManyInput[] = [];
  const refreshed: Prisma.TitleCreateManyInput[] = [];

  const fetchRows = async (
    list: typeof candidates,
    sink: Prisma.TitleCreateManyInput[],
  ) => {
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = list.slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(
        batch.map((c) => buildTitleRow(c.tmdbId, c.media, c.item, lookup, region)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled' && r.value) sink.push(r.value);
      }
    }
  };

  await Promise.all([fetchRows(unseen, rows), fetchRows(stale, refreshed)]);

  // skipDuplicates: two sessions can start at once and race on the same title.
  // Losing that race must not fail the request.
  const created =
    rows.length > 0
      ? (await prisma.title.createMany({ data: rows, skipDuplicates: true })).count
      : 0;

  // Stale rows need a real update, so these are individual writes — which is why
  // they're capped.
  await Promise.all(
    refreshed.map((r) =>
      prisma.title.update({
        where: { tmdbId_type: { tmdbId: r.tmdbId, type: r.type as 'MOVIE' | 'TV' } },
        data: r,
      }),
    ),
  );

  return created;
}

interface TmdbItem {
  id: number;
  title?: string;
  name?: string;
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  popularity: number;
  original_language: string;
  overview: string;
}

/**
 * Fetches one title's details and shapes it for insertion. Returns null if it has
 * no trailer, or doesn't stream on anything we care about — those are dropped, not
 * cached, because a card you can't play a trailer for is a dead card.
 *
 * Does no database work: the caller writes the whole batch in one go.
 */
async function buildTitleRow(
  tmdbId: number,
  media: 'movie' | 'tv',
  item: TmdbItem,
  lookup: Map<number, string>,
  region: Region,
): Promise<Prisma.TitleCreateManyInput | null> {
  const d = await detail(media, tmdbId);

  // No trailer, no card. This is the filter TMDB can't do for us, and it drops
  // roughly half of everything — which is exactly why we over-fetch.
  const trailerYoutubeId = pickTrailer(d.videos?.results ?? []);
  if (!trailerYoutubeId) return null;

  const watchProviders = mapProviders(d, lookup, region);
  if (!watchProviders[region]?.flatrate.length) return null;

  const date = item.release_date || item.first_air_date;
  const runtime = media === 'movie' ? d.runtime : d.episode_run_time?.[0];

  return {
    tmdbId,
    type: media === 'movie' ? 'MOVIE' : 'TV',
    title: item.title ?? item.name ?? 'Untitled',
    posterUrl: item.poster_path ? `${POSTER_BASE}${item.poster_path}` : null,
    trailerYoutubeId,
    genres: d.genres.map((g) => g.name),
    releaseYear: date ? Number(date.slice(0, 4)) : null,
    runtime: runtime ?? null,
    rating: item.vote_average,
    // Cached but never sent to a card — the spec forbids plot synopses (spoilers).
    overview: item.overview || null,
    language: item.original_language,
    watchProviders: watchProviders as unknown as Prisma.InputJsonValue,
    popularity: item.popularity,
    cachedAt: new Date(),
  };
}

type ProviderMap = Partial<Record<Region, { flatrate: string[] }>>;

/**
 * Reduces TMDB's per-region provider block to the services we support, as our own
 * ids, so the queue's jsonb filter can compare directly against User.services.
 *
 * Only flatrate/free/ads count as streamable — a title you'd have to rent for ₹149
 * is not something to surface as "you both have this".
 */
function mapProviders(
  d: Awaited<ReturnType<typeof detail>>,
  lookup: Map<number, string>,
  region: Region,
): ProviderMap {
  const block = d['watch/providers']?.results?.[region];
  if (!block) return {};

  const entries = [...(block.flatrate ?? []), ...(block.free ?? []), ...(block.ads ?? [])];
  const services = [
    ...new Set(
      entries.map((e) => lookup.get(e.provider_id)).filter((id): id is string => id !== undefined),
    ),
  ];

  return services.length > 0 ? { [region]: { flatrate: services } } : {};
}

/**
 * Mood genres are stored as NAMES (Comedy, Horror) because movie and TV use
 * different numeric ids for the same genre — names are the only thing that joins
 * across both. TMDB's /discover wants ids, so translate here. The list changes
 * about never, so it's fetched once per process.
 */
const genreCache = new Map<'movie' | 'tv', Map<string, number>>();

async function resolveGenreIds(media: 'movie' | 'tv', names: string[]): Promise<number[]> {
  let map = genreCache.get(media);
  if (!map) {
    map = await genreMap(media);
    genreCache.set(media, map);
  }
  return names.map((n) => map!.get(n)).filter((id): id is number => id !== undefined);
}
