import type { Prisma, PrismaClient, Title } from '@prisma/client';
import { REGIONS, STREAMING_SERVICES, providerIdsInRegion, type Region } from '@watchly/shared';
import { POSTER_BASE, detail, discover, genreMap, pickTrailers } from './tmdb.js';
import {
  extractBackdrop,
  extractCast,
  extractCertifications,
  extractRecommendations,
} from './titleExtract.js';
import { buildQueue, type QueueFilters } from './queue.js';
import { env } from '../env.js';

/** How many raw candidates to pull for each title we actually need. */
const OVERFETCH = 2.5;

const CONCURRENCY = 20;

/** Give up after this many TMDB rounds rather than stall the user forever. */
const MAX_ROUNDS = 3;

const STALE_AFTER_DAYS = 7;

const MAX_REFRESH_PER_REQUEST = 8;

const providerIdsFor = (region: Region, services: string[]): number[] =>
  STREAMING_SERVICES.filter((s) => services.includes(s.id)).flatMap((s) =>
    providerIdsInRegion(s, region),
  );

function providerLookup(region: Region): Map<number, string> {
  const map = new Map<number, string>();
  for (const svc of STREAMING_SERVICES) {
    for (const id of providerIdsInRegion(svc, region)) map.set(id, svc.id);
  }
  return map;
}

export async function ensureQueue(
  prisma: PrismaClient,
  filters: QueueFilters,
  excludeForUserIds: string[],
): Promise<Title[]> {
  if (!env.TMDB_API_KEY) {
    return buildQueue(prisma, filters, excludeForUserIds);
  }

  await refreshFilterWindow(prisma, filters, 0);

  let queue = await buildQueue(prisma, filters, excludeForUserIds);

  for (let round = 1; round < MAX_ROUNDS && queue.length < filters.limit; round++) {
    const added = await refreshFilterWindow(prisma, filters, round);
    if (added === 0) break; // TMDB has nothing more for these filters.
    queue = await buildQueue(prisma, filters, excludeForUserIds);
  }

  return queue;
}

export async function getOrFetchTitle(
  prisma: PrismaClient,
  tmdbId: number,
  type: 'MOVIE' | 'TV',
  region: Region,
): Promise<Title | null> {
  const existing = await prisma.title.findUnique({ where: { tmdbId_type: { tmdbId, type } } });
  if (existing) return existing;

  const row = await buildFullRow(tmdbId, type, region);
  if (!row) return null;

  try {
    return await prisma.title.create({ data: row });
  } catch {
    return prisma.title.findUnique({ where: { tmdbId_type: { tmdbId, type } } });
  }
}

async function buildFullRow(
  tmdbId: number,
  type: 'MOVIE' | 'TV',
  region: Region,
): Promise<Prisma.TitleCreateInput | null> {
  if (!env.TMDB_API_KEY) return null;

  const media = type === 'MOVIE' ? 'movie' : 'tv';

  let d;
  try {
    d = await detail(media, tmdbId);
  } catch {
    return null;
  }

  const lookup = providerLookup(region);
  const date = d.release_date || d.first_air_date;
  const runtime = media === 'movie' ? d.runtime : d.episode_run_time?.[0];

  return {
    tmdbId,
    type,
    title: d.title ?? d.name ?? 'Untitled',
    posterUrl: d.poster_path ? `${POSTER_BASE}${d.poster_path}` : null,
    backdropUrl: extractBackdrop(d),
    trailerYoutubeIds: pickTrailers(d.videos?.results ?? []),
    genres: d.genres.map((g) => g.name),
    releaseYear: date ? Number(date.slice(0, 4)) : null,
    runtime: runtime ?? null,
    rating: d.vote_average ?? null,
    overview: d.overview || null,
    language: d.original_language ?? null,
    topCast: extractCast(d) as unknown as Prisma.InputJsonValue,
    certifications: extractCertifications(d, media, REGIONS) as unknown as Prisma.InputJsonValue,
    recommendations: extractRecommendations(d, media) as unknown as Prisma.InputJsonValue,
    watchProviders: mapProviders(d, lookup, region) as unknown as Prisma.InputJsonValue,
    popularity: d.popularity ?? 0,
    cachedAt: new Date(),
  };
}

export async function refreshIfIncomplete(
  prisma: PrismaClient,
  title: Title,
  region: Region,
): Promise<Title> {
  const looksUnenriched =
    title.backdropUrl === null &&
    (title.topCast as unknown[]).length === 0 &&
    (title.recommendations as unknown[]).length === 0;

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  if (!looksUnenriched && title.cachedAt >= staleCutoff) return title;

  const row = await buildFullRow(title.tmdbId, title.type, region);
  if (!row) return title;

  return prisma.title.update({ where: { id: title.id }, data: row });
}

async function refreshFilterWindow(
  prisma: PrismaClient,
  filters: QueueFilters,
  round: number,
): Promise<number> {
  const { region, services, titleType, genres, maxRuntime, minYear, minRating, language, limit } =
    filters;

  const providerIds = providerIdsFor(region, services);
  if (providerIds.length === 0) return 0;

  const lookup = providerLookup(region);

  const media = [titleType === 'MOVIE' ? 'movie' : 'tv'] as const;
  // Enough candidates to survive the ~50% trailer cull, at 20 results per page.
  const pages = Math.max(1, Math.ceil((limit * OVERFETCH) / 20));

  const candidates: { tmdbId: number; media: 'movie' | 'tv'; item: TmdbItem }[] = [];

  for (const m of media) {
    const genreIds = genres.length > 0 ? await resolveGenreIds(m, genres) : [];

    for (let p = 0; p < pages; p++) {
      const page = round * pages + p + 1;

      const dateKey = m === 'movie' ? 'primary_release_date.gte' : 'first_air_date.gte';

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
        ...(minYear !== null && { [dateKey]: `${minYear}-01-01` }),
        ...(minRating !== null && { 'vote_average.gte': String(minRating) }),
        ...(language !== null && { with_original_language: language }),
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

  const staleCutoff = new Date(Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const stale = candidates
    .filter((c) => {
      const row = known.get(key(c));
      return row && row.cachedAt < staleCutoff;
    })
    .slice(0, MAX_REFRESH_PER_REQUEST);

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

  const created =
    rows.length > 0
      ? (await prisma.title.createMany({ data: rows, skipDuplicates: true })).count
      : 0;

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

async function buildTitleRow(
  tmdbId: number,
  media: 'movie' | 'tv',
  item: TmdbItem,
  lookup: Map<number, string>,
  region: Region,
): Promise<Prisma.TitleCreateManyInput | null> {
  const d = await detail(media, tmdbId);

  const trailerYoutubeIds = pickTrailers(d.videos?.results ?? []);
  if (trailerYoutubeIds.length === 0) return null;

  const watchProviders = mapProviders(d, lookup, region);
  if (!watchProviders[region]?.flatrate.length) return null;

  const date = item.release_date || item.first_air_date;
  const runtime = media === 'movie' ? d.runtime : d.episode_run_time?.[0];

  return {
    tmdbId,
    type: media === 'movie' ? 'MOVIE' : 'TV',
    title: item.title ?? item.name ?? 'Untitled',
    posterUrl: item.poster_path ? `${POSTER_BASE}${item.poster_path}` : null,
    backdropUrl: extractBackdrop(d),
    trailerYoutubeIds,
    genres: d.genres.map((g) => g.name),
    releaseYear: date ? Number(date.slice(0, 4)) : null,
    runtime: runtime ?? null,
    rating: item.vote_average,
    // Cached but never sent to a card — the spec forbids plot synopses (spoilers).
    overview: item.overview || null,
    language: item.original_language,
    topCast: extractCast(d) as unknown as Prisma.InputJsonValue,
    certifications: extractCertifications(d, media, REGIONS) as unknown as Prisma.InputJsonValue,
    recommendations: extractRecommendations(d, media) as unknown as Prisma.InputJsonValue,
    watchProviders: watchProviders as unknown as Prisma.InputJsonValue,
    popularity: item.popularity,
    cachedAt: new Date(),
  };
}

type ProviderMap = Partial<Record<Region, { flatrate: string[] }>>;

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

const genreCache = new Map<'movie' | 'tv', Map<string, number>>();

async function resolveGenreIds(media: 'movie' | 'tv', names: string[]): Promise<number[]> {
  let map = genreCache.get(media);
  if (!map) {
    map = await genreMap(media);
    genreCache.set(media, map);
  }
  return names.map((n) => map!.get(n)).filter((id): id is number => id !== undefined);
}
