import type { Region } from '@watchly/shared';
import { BACKDROP_BASE, PROFILE_BASE, type TmdbDetail } from './tmdb.js';

/** Smaller than the full POSTER_BASE (w780) — these render as thumbnails in a
 *  horizontal "more like this" row, not a card. */
const RECOMMENDATION_POSTER_BASE = 'https://image.tmdb.org/t/p/w342';

/**
 * Detail-screen enrichment, factored out here because it's shared by two
 * independent write paths — the lazy per-session catalog (catalog.ts) and the
 * nightly bulk sync (jobs/sync-catalog.ts) — and both need to agree on exactly
 * what a TMDB response turns into.
 */

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

/**
 * Age/content rating, normalized across movies and TV into one shape:
 * { IN: "U/A 13+", US: "PG-13" }. Movies bury it inside a per-release-type array
 * (theatrical, digital, physical, ...) that can list several certifications for
 * the same country; theatrical (type 3) is preferred when present since it's the
 * rating most people mean by "the certification". TV is flat — one rating per
 * country — so there's nothing to disambiguate.
 */
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

/**
 * TMDB's "more like this", denormalized — most of these referenced titles have
 * never been swiped on, so there's no Title row of ours to point a real relation
 * at yet. getOrFetchTitle (catalog.ts) resolves one into a real row the moment
 * someone actually taps it.
 */
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
