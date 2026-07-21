import type {
  Decision,
  Region,
  SessionMode,
  SessionStatus,
  TitleType,
  Voter,
} from '@watchly/shared';

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
  // Ranked, official-first — the card plays [0]; the modal offers a picker
  // when there's more than one.
  trailerYoutubeIds: string[];
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
  /** Async: person A swipes now, person B finishes later. */
  isAsync: boolean;
  status: SessionStatus;
  personALabel: string;
  personBLabel: string;
  region: Region;
  services: string[];
  titleType: TitleType;
  mood: string | null;
  maxRuntime: number | null;
  queueLength: number;
  createdAt: string;
  completedAt: string | null;
  /** Watch-loop: when the couple logged how the night went, and what they watched. */
  watchLoggedAt: string | null;
  watchedTitleId: string | null;
}

/** The "did you watch it?" prompt payload, or absent when nothing's pending. */
export interface WatchCheck {
  session: PublicSession;
  matches: PublicTitle[];
  partnerLabel: string;
}

export interface WatchCheckResponse {
  check: WatchCheck | null;
}

/** An open async session, for the home "in progress" strip. */
export interface ActiveSession {
  session: PublicSession;
  partnerLabel: string;
  progress: SessionProgress;
  /** The caller still has cards to swipe. */
  yourTurn: boolean;
  /** The caller is done; the partner hasn't finished. */
  waitingOnPartner: boolean;
}

export interface ActiveResponse {
  active: ActiveSession[];
}

/** The couple's taste profile, computed from votes already cast. */
export interface TasteProfile {
  nights: number;
  swiped: number;
  yes: number;
  /** Titles the user marked as already seen. */
  seen: number;
  /** 0..1 — share of the user's own swipes that were a yes. */
  yesRate: number;
  /** 0..1 — of everything either person liked, how much both did. Null if none yet. */
  agreement: number | null;
  watchedTogether: number;
  /** The most recent match you actually watched, from the watch-loop. */
  lastWatched: { id: string; title: string; posterUrl: string | null } | null;
  loves: { genre: string; count: number }[];
}

export interface SessionProgress {
  total: number;
  personA: number;
  personB: number;
  personADone: boolean;
  personBDone: boolean;
  bothDone: boolean;
}

/** A title exactly one person said yes to — the raw material for a tiebreaker. */
export interface NearMiss {
  title: PublicTitle;
  likedBy: Voter;
  /** What the other person said. Null if they never got to it (async / quit early). */
  otherDecision: Decision | null;
}

export interface ResultsResponse {
  session: PublicSession;
  matches: PublicTitle[];
  nearMisses: NearMiss[];
  progress: SessionProgress;
  /** The other person's account id. Null for same-device — no account to save. */
  partnerUserId: string | null;
}
