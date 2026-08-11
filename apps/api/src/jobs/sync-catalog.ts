import type { Prisma } from '@prisma/client';
import { REGIONS, STREAMING_SERVICES, providerIdsInRegion, type Region } from '@watchly/shared';
import { prisma } from '../lib/prisma.js';
import { POSTER_BASE, detail, listPage, pickTrailers, sleep, type TmdbListItem } from '../lib/tmdb.js';
import {
  extractBackdrop,
  extractCast,
  extractCertifications,
  extractRecommendations,
} from '../lib/titleExtract.js';

const PROVIDER_TO_SERVICE: Record<Region, Map<number, string>> = {
  IN: new Map(),
  US: new Map(),
};
for (const svc of STREAMING_SERVICES) {
  for (const region of REGIONS) {
    for (const tmdbId of providerIdsInRegion(svc, region)) {
      PROVIDER_TO_SERVICE[region].set(tmdbId, svc.id);
    }
  }
}

const PAGES_PER_LIST = Number(process.env.SYNC_PAGES ?? 100);

/** Parallel detail fetches. TMDB tolerates ~50/s; this stays well clear. */
const CONCURRENCY = 8;

interface Candidate {
  tmdbId: number;
  media: 'movie' | 'tv';
  item: TmdbListItem;
}

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
    backdropUrl: extractBackdrop(d),
    trailerYoutubeIds,
    genres: d.genres.map((g) => g.name),
    releaseYear: date ? Number(date.slice(0, 4)) : null,
    runtime: runtime ?? null,
    rating: item.vote_average,
    overview: item.overview || null,
    language: item.original_language,
    topCast: extractCast(d) as unknown as Prisma.InputJsonValue,
    certifications: extractCertifications(d, media, REGIONS) as unknown as Prisma.InputJsonValue,
    recommendations: extractRecommendations(d, media) as unknown as Prisma.InputJsonValue,
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
