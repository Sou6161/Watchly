import { env } from '../env.js';

const BASE = 'https://api.themoviedb.org/3';
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w780';

/**
 * TMDB issues two credential styles: a v3 API key (query param) and a v4 read
 * access token (JWT, Authorization header). People grab whichever the dashboard
 * showed them, so accept both rather than making the key style a setup footgun.
 */
function authFor(url: URL): Record<string, string> {
  const key = env.TMDB_API_KEY;
  if (!key) throw new Error('TMDB_API_KEY is not set.');

  if (key.startsWith('eyJ')) {
    return { authorization: `Bearer ${key}`, accept: 'application/json' };
  }
  url.searchParams.set('api_key', key);
  return { accept: 'application/json' };
}

/** TMDB rate-limits around 50 req/s; on 429 it tells us how long to wait. */
async function tmdb<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = authFor(url);

  const MAX_ATTEMPTS = 6;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const last = attempt === MAX_ATTEMPTS - 1;
    let res: Response;

    try {
      res = await fetch(url, { headers });
    } catch (err) {
      // ECONNRESET/ETIMEDOUT and friends. Over a full sync (thousands of
      // requests) these are a matter of when, not if. TMDB seems to reset the
      // connection when hit hard for a sustained stretch, so back off properly
      // — up to ~16s — rather than retrying three times in 3 seconds and giving
      // up while it's still angry.
      if (last) throw err;
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('retry-after') ?? 1);
      await sleep((retryAfter + 0.5) * 1000);
      continue;
    }

    // 5xx from TMDB is usually transient; back off and retry.
    if (res.status >= 500) {
      if (last) throw new Error(`TMDB ${res.status} on ${path} after ${MAX_ATTEMPTS} attempts.`);
      await sleep(2 ** attempt * 500);
      continue;
    }

    if (!res.ok) {
      // 4xx (bad key, unknown id) won't fix itself — fail immediately.
      throw new Error(`TMDB ${res.status} on ${path}: ${await res.text()}`);
    }

    return (await res.json()) as T;
  }

  throw new Error(`TMDB kept failing on ${path} after ${MAX_ATTEMPTS} attempts.`);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/* --------------------------------------------------------------- responses */

export interface TmdbListItem {
  id: number;
  title?: string; // movies
  name?: string; // tv
  poster_path: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average: number;
  popularity: number;
  original_language: string;
  genre_ids: number[];
  overview: string;
}

interface TmdbPage {
  page: number;
  results: TmdbListItem[];
  total_pages: number;
}

interface TmdbVideo {
  key: string;
  site: string;
  type: string;
  official: boolean;
  size: number;
}

interface TmdbProviderEntry {
  provider_id: number;
  provider_name: string;
}

export interface TmdbDetail {
  id: number;
  runtime?: number; // movies
  episode_run_time?: number[]; // tv
  genres: { id: number; name: string }[];
  videos: { results: TmdbVideo[] };
  'watch/providers': {
    results: Record<
      string,
      { flatrate?: TmdbProviderEntry[]; free?: TmdbProviderEntry[]; ads?: TmdbProviderEntry[] }
    >;
  };
}

export function listPage(
  kind: 'popular' | 'trending',
  media: 'movie' | 'tv',
  region: string,
  page: number,
): Promise<TmdbPage> {
  if (kind === 'trending') {
    return tmdb<TmdbPage>(`/trending/${media}/week`, { page: String(page) });
  }
  // /discover beats /movie/popular here: it's the only one that can filter to
  // titles actually watchable in a region, which is the whole point for India.
  return tmdb<TmdbPage>(`/discover/${media}`, {
    page: String(page),
    watch_region: region,
    with_watch_monetization_types: 'flatrate|free|ads',
    sort_by: 'popularity.desc',
    'vote_count.gte': '20',
  });
}

/** One call gets details, trailers, and providers — 3x fewer requests than separate hits. */
export function detail(media: 'movie' | 'tv', id: number): Promise<TmdbDetail> {
  return tmdb<TmdbDetail>(`/${media}/${id}`, { append_to_response: 'videos,watch/providers' });
}

/** All flatrate/free/ads providers TMDB knows about in a region — used to verify our catalog. */
export function providersInRegion(media: 'movie' | 'tv', region: string) {
  return tmdb<{ results: { provider_id: number; provider_name: string }[] }>(
    `/watch/providers/${media}`,
    { watch_region: region },
  );
}

/**
 * Picks the trailer to autoplay. Prefers an official YouTube "Trailer"; falls
 * back to a teaser, then to any YouTube video. Titles with nothing playable get
 * dropped from the catalog entirely — a card with no trailer is a dead card.
 */
export function pickTrailer(videos: TmdbVideo[]): string | null {
  const youtube = videos.filter((v) => v.site === 'YouTube' && v.key);
  const rank = (v: TmdbVideo) => {
    if (v.type === 'Trailer') return v.official ? 0 : 1;
    if (v.type === 'Teaser') return v.official ? 2 : 3;
    return 4;
  };
  const best = youtube.sort((a, b) => rank(a) - rank(b) || b.size - a.size)[0];
  return best?.key ?? null;
}
