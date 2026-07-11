import type { Region, SessionMode, SessionStatus, TitleType } from '@watchly/shared';

/**
 * Wire shapes returned by the API. These mirror toPublicTitle/toPublicSession on
 * the server — they live here rather than in @watchly/shared because they're
 * response DTOs derived from Prisma models, and the shared package deliberately
 * has no Prisma dependency.
 */

/** Per-region streaming availability, keyed by our internal service ids. */
export type WatchProviders = Partial<Record<Region, { flatrate: string[] }>>;

export interface PublicTitle {
  id: string;
  tmdbId: number;
  type: TitleType;
  title: string;
  posterUrl: string | null;
  trailerYoutubeId: string;
  genres: string[];
  releaseYear: number | null;
  runtime: number | null;
  rating: number | null;
  watchProviders: WatchProviders;
  // No `overview` — plot synopses are spoilers and never reach a card.
}

export interface PublicSession {
  id: string;
  code: string;
  mode: SessionMode;
  status: SessionStatus;
  personALabel: string;
  personBLabel: string;
  region: Region;
  services: string[];
  mood: string | null;
  maxRuntime: number | null;
  queueLength: number;
  createdAt: string;
  completedAt: string | null;
}

export interface SessionProgress {
  total: number;
  personA: number;
  personB: number;
  personADone: boolean;
  personBDone: boolean;
  bothDone: boolean;
}
