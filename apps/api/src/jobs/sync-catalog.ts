import type { Prisma } from '@prisma/client';
import { REGIONS, STREAMING_SERVICES, type Region } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { POSTER_BASE, detail, listPage, pickTrailers, sleep, type TmdbListItem } from '../lib/tmdb.js';

/**
 * TMDB provider_id -> our internal service id, per region. Must be per-region:
 * TMDB gives Prime Video id 119 in IN but 9 in US, so a single flat map would
 * mis-attribute providers across territories.
 */
const PROVIDER_TO_SERVICE: Record<Region, Map<number, string>> = {
  IN: new Map(),
  US: new Map(),
};
for (const svc of STREAMING_SERVICES) {
  for (const region of REGIONS) {
    const tmdbId = svc.tmdbProviderIds[region];
    if (tmdbId !== undefined) PROVIDER_TO_SERVICE[region].set(tmdbId, svc.id);
  }
}

/**
 * Pages per (kind x media x region), 20 results per page. There are 8 such lists
 * (2 regions x 2 media x 2 kinds), and they overlap heavily — the same film is
 * popular in both IN and US, and trending titles are usually popular ones. After
 * dedupe, and after ~40% of candidates are dropped for having no trailer or no
 * streaming provider, 100 pages lands in the spec's 5–10k range.
 *
 * Tunable because the ceiling is TMDB's, not ours: `SYNC_PAGES=10 npm run sync`
 * gives a fast partial catalog for local work.
 */
const PAGES_PER_LIST = Number(process.env.SYNC_PAGES ?? 100);

/** Parallel detail fetches. TMDB tolerates ~50/s; this stays well clear. */
const CONCURRENCY = 8;

interface Candidate {
  tmdbId: number;
  media: 'movie' | 'tv';
  item: TmdbListItem;
}

/**
 * Nightly catalog refresh.
 *
 * Two passes, because a title's *providers* are region-specific but its
 * *metadata* is not: we gather candidate ids per region, then fetch each unique
 * title once and record providers for every region it's available in.
 */
export async function syncCatalog(): Promise<{ scanned: number; cached: number; skipped: number }> {
  const candidates = new Map<string, Candidate>();
  let badPages = 0;

  for (const region of REGIONS) {
    for (const media of ['movie', 'tv'] as const) {
      for (const kind of ['popular', 'trending'] as const) {
        for (let page = 1; page <= PAGES_PER_LIST; page++) {
          let res;
          try {
            res = await listPage(kind, media, region, page);
          } catch (err) {
            // One flaky page must not throw away a 15-minute run. Losing 20
            // candidates out of ~16,000 is invisible; losing the whole sync is not.
            badPages++;
            console.warn(
              `  page ${page} of ${kind}/${media}/${region} failed, skipping:`,
              err instanceof Error ? err.message : err,
            );
            continue;
          }

          for (const item of res.results) {
            candidates.set(`${media}:${item.id}`, { tmdbId: item.id, media, item });
          }
          if (page >= res.total_pages) break;

          // Pacing. Firing ~800 list requests back-to-back is what was drawing
          // connection resets out of TMDB in the first place.
          await sleep(60);
        }
      }
    }
  }

  if (badPages > 0) console.warn(`  (${badPages} list pages were skipped)`);

  const all = [...candidates.values()];
  console.log(`Gathered ${all.length} unique candidates. Fetching details...`);
  let cached = 0;
  let skipped = 0;

  for (let i = 0; i < all.length; i += CONCURRENCY) {
    const batch = all.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map(upsertTitle));

    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('  skipped a title:', r.reason instanceof Error ? r.reason.message : r.reason);
        skipped++;
      } else if (r.value === 'cached') {
        cached++;
      } else {
        skipped++;
      }
    }

    // Gentle on TMDB, and this job has all night.
    await sleep(120);
  }

  return { scanned: all.length, cached, skipped };
}

async function upsertTitle({ tmdbId, media, item }: Candidate): Promise<'cached' | 'skipped'> {
  const d = await detail(media, tmdbId);

  // No trailer, no card. This is the single biggest filter in the pipeline —
  // swiping on a title you can't watch a trailer for is the whole product failing.
  const trailerYoutubeIds = pickTrailers(d.videos?.results ?? []);
  if (trailerYoutubeIds.length === 0) return 'skipped';

  const watchProviders = mapProviders(d);

  // If nobody streams it in any region we serve, it can never appear in a queue.
  const streamableSomewhere = Object.values(watchProviders).some(
    (r) => (r.flatrate?.length ?? 0) > 0,
  );
  if (!streamableSomewhere) return 'skipped';

  const type = media === 'movie' ? 'MOVIE' : 'TV';
  const date = item.release_date || item.first_air_date;
  const runtime = media === 'movie' ? d.runtime : d.episode_run_time?.[0];

  const data = {
    title: item.title ?? item.name ?? 'Untitled',
    posterUrl: item.poster_path ? `${POSTER_BASE}${item.poster_path}` : null,
    trailerYoutubeIds,
    genres: d.genres.map((g) => g.name),
    releaseYear: date ? Number(date.slice(0, 4)) : null,
    runtime: runtime ?? null,
    rating: item.vote_average,
    // Cached but never shown on a card — the spec forbids plot synopses (spoilers).
    // Kept for possible use on the results screen, where the decision is already made.
    overview: item.overview || null,
    language: item.original_language,
    watchProviders: watchProviders as unknown as Prisma.InputJsonValue,
    popularity: item.popularity,
    cachedAt: new Date(),
  };

  await prisma.title.upsert({
    where: { tmdbId_type: { tmdbId, type } },
    create: { tmdbId, type, ...data },
    update: data,
  });

  return 'cached';
}

type ProviderMap = Partial<Record<Region, { flatrate: string[] }>>;

/**
 * Reduces TMDB's per-region provider block to the services we actually support,
 * expressed as our internal ids so the queue filter can compare directly against
 * User.services.
 *
 * Only flatrate/free/ads count as "streamable" — a title you'd have to rent for
 * ₹149 is not something to surface as "you both have this".
 */
function mapProviders(d: TmdbDetailLike): ProviderMap {
  const out: ProviderMap = {};
  const byRegion = d['watch/providers']?.results ?? {};

  for (const region of REGIONS) {
    const block = byRegion[region];
    if (!block) continue;

    const entries = [...(block.flatrate ?? []), ...(block.free ?? []), ...(block.ads ?? [])];
    const lookup = PROVIDER_TO_SERVICE[region];
    const services = [
      ...new Set(
        entries
          .map((e) => lookup.get(e.provider_id))
          .filter((id): id is string => id !== undefined),
      ),
    ];

    if (services.length > 0) out[region] = { flatrate: services };
  }

  return out;
}

type TmdbDetailLike = Awaited<ReturnType<typeof detail>>;

/**
 * Run directly (`npm run sync -w @watchly/api`) rather than imported. This file
 * is also imported by routes/internal.ts, where this block must NOT fire — hence
 * the argv check rather than just running on import. Matches both the tsx path
 * (.ts) and the compiled one (.js).
 */
const isEntrypoint = /sync-catalog\.(ts|js)$/.test(process.argv[1] ?? '');
if (isEntrypoint) {
  const started = Date.now();
  syncCatalog()
    .then(({ scanned, cached, skipped }) => {
      const secs = ((Date.now() - started) / 1000).toFixed(0);
      console.log(
        `Catalog sync done in ${secs}s — scanned ${scanned}, cached ${cached}, skipped ${skipped} (no trailer or not streamable).`,
      );
      return prisma.$disconnect();
    })
    .catch(async (err) => {
      console.error('Catalog sync failed:', err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
