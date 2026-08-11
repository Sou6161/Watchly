import { env } from '../env.js';

const BASE = 'https://api.themoviedb.org/3';
export const POSTER_BASE = 'https://image.tmdb.org/t/p/w780';
/** Wide enough for a full-bleed hero without shipping a multi-MB original. */
export const BACKDROP_BASE = 'https://image.tmdb.org/t/p/w1280';
/** Small — these render as ~50px circular headshots in a cast row. */
export const PROFILE_BASE = 'https://image.tmdb.org/t/p/w185';

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

interface TmdbCastMember {
  name: string;
  character: string;
  profile_path: string | null;
  order: number;
}

interface TmdbReleaseDateEntry {
  certification: string;
  type: number; // 3 = theatrical, the one worth preferring when several exist
}

export interface TmdbDetail {
  id: number;
  title?: string; // movies
  name?: string; // tv
  poster_path?: string | null;
  backdrop_path?: string | null;
  release_date?: string;
  first_air_date?: string;
  vote_average?: number;
  popularity?: number;
  original_language?: string;
  overview?: string;

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
  credits?: { cast: TmdbCastMember[] };
  release_dates?: { results: { iso_3166_1: string; release_dates: TmdbReleaseDateEntry[] }[] };
  // TV only (append key "content_ratings"). Flat — one rating per country.
  content_ratings?: { results: { iso_3166_1: string; rating: string }[] };
  recommendations?: { results: TmdbListItem[] };
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
  return tmdb<TmdbPage>(`/discover/${media}`, {
    page: String(page),
    watch_region: region,
    with_watch_monetization_types: 'flatrate|free|ads',
    sort_by: 'popularity.desc',
    'vote_count.gte': '20',
  });
}

export function discover(
  media: 'movie' | 'tv',
  params: Record<string, string>,
): Promise<TmdbPage> {
  return tmdb<TmdbPage>(`/discover/${media}`, params);
}

/** Genre name -> TMDB id, for the media type. Movie and TV number them differently. */
export async function genreMap(media: 'movie' | 'tv'): Promise<Map<string, number>> {
  const res = await tmdb<{ genres: { id: number; name: string }[] }>(`/genre/${media}/list`);
  return new Map(res.genres.map((g) => [g.name, g.id]));
}

export function detail(media: 'movie' | 'tv', id: number): Promise<TmdbDetail> {
  const certKey = media === 'movie' ? 'release_dates' : 'content_ratings';
  return tmdb<TmdbDetail>(`/${media}/${id}`, {
    append_to_response: `videos,watch/providers,credits,${certKey},recommendations`,
  });
}

/** All flatrate/free/ads providers TMDB knows about in a region — used to verify our catalog. */
export function providersInRegion(media: 'movie' | 'tv', region: string) {
  return tmdb<{ results: { provider_id: number; provider_name: string }[] }>(
    `/watch/providers/${media}`,
    { watch_region: region },
  );
}

const MAX_TRAILERS = 3;

export function pickTrailers(videos: TmdbVideo[]): string[] {
  const youtube = videos.filter((v) => v.site === 'YouTube' && v.key);
  const rank = (v: TmdbVideo) => {
    if (v.type === 'Trailer') return v.official ? 0 : 1;
    if (v.type === 'Teaser') return v.official ? 2 : 3;
    return 4;
  };
  const ranked = youtube.sort((a, b) => rank(a) - rank(b) || b.size - a.size);

  const seen = new Set<string>();
  const keys: string[] = [];
  for (const v of ranked) {
    if (seen.has(v.key)) continue;
    seen.add(v.key);
    keys.push(v.key);
    if (keys.length === MAX_TRAILERS) break;
  }
  return keys;
}
