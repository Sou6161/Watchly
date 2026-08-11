import type { Region } from '@watchly/shared';
import { BACKDROP_BASE, PROFILE_BASE, type TmdbDetail } from './tmdb.js';

const RECOMMENDATION_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

/** A full-bleed hero image, or null for the (rare) title TMDB has none for. */
export function extractBackdrop(d: TmdbDetail): string | null {
  return d.backdrop_path ? `${BACKDROP_BASE}${d.backdrop_path}` : null;
}

const MAX_CAST = 8;

/** Top-billed cast, TMDB's own `order` field — already sorted, so no re-ranking. */
export function extractCast(d: TmdbDetail): { name: string; character: string; profileUrl: string | null }[] {
  return (d.credits?.cast ?? []).slice(0, MAX_CAST).map((c) => ({
    name: c.name,
    character: c.character,
    profileUrl: c.profile_path ? `${PROFILE_BASE}${c.profile_path}` : null,
  }));
}

export function extractCertifications(
  d: TmdbDetail,
  media: 'movie' | 'tv',
  regions: readonly Region[],
): Partial<Record<Region, string>> {
  const out: Partial<Record<Region, string>> = {};

  if (media === 'movie') {
    const results = d.release_dates?.results ?? [];
    for (const region of regions) {
      const entry = results.find((r) => r.iso_3166_1 === region);
      const dates = entry?.release_dates.filter((rd) => rd.certification) ?? [];
      if (dates.length === 0) continue;
      const cert = dates.find((rd) => rd.type === 3)?.certification ?? dates[0]!.certification;
      out[region] = cert;
    }
  } else {
    const results = d.content_ratings?.results ?? [];
    for (const region of regions) {
      const rating = results.find((r) => r.iso_3166_1 === region)?.rating;
      if (rating) out[region] = rating;
    }
  }

  return out;
}

const MAX_RECOMMENDATIONS = 8;

export function extractRecommendations(
  d: TmdbDetail,
  media: 'movie' | 'tv',
): { tmdbId: number; type: 'MOVIE' | 'TV'; title: string; posterUrl: string | null }[] {
  const type = media === 'movie' ? 'MOVIE' : 'TV';
  return (d.recommendations?.results ?? []).slice(0, MAX_RECOMMENDATIONS).map((r) => ({
    tmdbId: r.id,
    type,
    title: r.title ?? r.name ?? 'Untitled',
    posterUrl: r.poster_path ? `${RECOMMENDATION_POSTER_BASE}${r.poster_path}` : null,
  }));
}
