
export const SessionMode = {
  SAME_DEVICE: 'SAME_DEVICE',
  MULTI_DEVICE: 'MULTI_DEVICE',
} as const;
export type SessionMode = (typeof SessionMode)[keyof typeof SessionMode];

export const SessionStatus = {
  WAITING: 'WAITING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  ABANDONED: 'ABANDONED',
} as const;
export type SessionStatus = (typeof SessionStatus)[keyof typeof SessionStatus];

export const TitleType = {
  MOVIE: 'MOVIE',
  TV: 'TV',
} as const;
export type TitleType = (typeof TitleType)[keyof typeof TitleType];

export const Voter = {
  PERSON_A: 'PERSON_A',
  PERSON_B: 'PERSON_B',
} as const;
export type Voter = (typeof Voter)[keyof typeof Voter];

export const Decision = {
  YES: 'YES',
  NO: 'NO',
  SEEN: 'SEEN',
  MAYBE: 'MAYBE',
} as const;
export type Decision = (typeof Decision)[keyof typeof Decision];

/* --------------------------------------------------------------- catalog */

export const REGIONS = ['IN', 'US'] as const;
export type Region = (typeof REGIONS)[number];

export const DEFAULT_REGION: Region = 'IN';

export interface StreamingService {
  id: string;
  label: string;
  tmdbProviderIds: Partial<Record<Region, number | number[]>>;
  androidPackage: string;
  iosScheme: string;
  /** Brand colour, used for the service chips and result-card logos. */
  color: string;
}

/** Every TMDB provider id a service uses in a region, normalised to an array. */
export function providerIdsInRegion(service: StreamingService, region: Region): number[] {
  const ids = service.tmdbProviderIds[region];
  if (ids === undefined) return [];
  return Array.isArray(ids) ? ids : [ids];
}

export const STREAMING_SERVICES: StreamingService[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    tmdbProviderIds: { IN: 8, US: 8 },
    androidPackage: 'com.netflix.mediaclient',
    iosScheme: 'nflx://',
    color: '#E50914',
  },
  {
    id: 'prime',
    label: 'Prime Video',
    tmdbProviderIds: { IN: 119, US: 9 },
    androidPackage: 'com.amazon.avod.thirdpartyclient',
    iosScheme: 'aiv://',
    color: '#00A8E1',
  },
  {
    id: 'hotstar',
    label: 'JioHotstar',
    tmdbProviderIds: { IN: 2336 },
    androidPackage: 'in.startv.hotstar',
    iosScheme: 'hotstar://',
    color: '#1F80E0',
  },
  {
    id: 'sonyliv',
    label: 'Sony LIV',
    tmdbProviderIds: { IN: 237 },
    androidPackage: 'com.sonyliv',
    iosScheme: 'sonyliv://',
    color: '#F26522',
  },
  {
    id: 'zee5',
    label: 'ZEE5',
    tmdbProviderIds: { IN: 232 },
    androidPackage: 'com.graymatrix.did',
    iosScheme: 'zee5://',
    color: '#8230C6',
  },
  {
    id: 'appletv',
    label: 'Apple TV+',
    tmdbProviderIds: { IN: 350, US: 350 },
    androidPackage: 'com.apple.atve.androidtv.appletv',
    iosScheme: 'videos://',
    color: '#B0B0B0',
  },
  {
    id: 'disneyplus',
    label: 'Disney+',
    tmdbProviderIds: { US: 337 },
    androidPackage: 'com.disney.disneyplus',
    iosScheme: 'disneyplus://',
    color: '#113CCF',
  },
  // ---- Cross-region niche subscriptions ----
  {
    id: 'crunchyroll',
    label: 'Crunchyroll',
    tmdbProviderIds: { IN: 283, US: 283 },
    androidPackage: 'com.crunchyroll.crunchyroid',
    iosScheme: 'crunchyroll://',
    color: '#F47521',
  },
  {
    id: 'mubi',
    label: 'MUBI',
    tmdbProviderIds: { IN: 11, US: 11 },
    androidPackage: 'com.mubi',
    iosScheme: 'mubi://',
    color: '#4C6EF5',
  },
  // ---- India (primary market) ----
  {
    id: 'sunnxt',
    label: 'Sun NXT',
    tmdbProviderIds: { IN: 309 },
    androidPackage: 'com.suntv.sunnxt',
    iosScheme: 'sunnxt://',
    color: '#ED1C24',
  },
  {
    id: 'aha',
    label: 'aha',
    tmdbProviderIds: { IN: 532 },
    androidPackage: 'com.valuelabs.aha',
    iosScheme: 'aha://',
    color: '#F94E3F',
  },
  {
    id: 'hoichoi',
    label: 'hoichoi',
    tmdbProviderIds: { IN: 315 },
    androidPackage: 'com.viewlift.hoichoi',
    iosScheme: 'hoichoi://',
    color: '#E63946',
  },
  {
    id: 'lionsgateplay',
    label: 'Lionsgate Play',
    tmdbProviderIds: { IN: 561 },
    androidPackage: 'com.lionsgateplay.videoapp',
    iosScheme: 'lionsgateplay://',
    color: '#8E44AD',
  },
  // ---- United States ----
  {
    id: 'hulu',
    label: 'Hulu',
    tmdbProviderIds: { US: 15 },
    androidPackage: 'com.hulu.plus',
    iosScheme: 'hulu://',
    color: '#1CE783',
  },
  {
    id: 'max',
    label: 'Max',
    tmdbProviderIds: { US: 1899 },
    androidPackage: 'com.wbd.stream',
    iosScheme: 'max://',
    color: '#7B2FF7',
  },
  {
    // Split into Premium (386) and Premium Plus (387) tiers on TMDB.
    id: 'peacock',
    label: 'Peacock',
    tmdbProviderIds: { US: [386, 387] },
    androidPackage: 'com.peacocktv.peacockandroid',
    iosScheme: 'peacock://',
    color: '#F5A623',
  },
  {
    // Split into Premium (2303) and Essential (2616) tiers on TMDB.
    id: 'paramountplus',
    label: 'Paramount+',
    tmdbProviderIds: { US: [2303, 2616] },
    androidPackage: 'com.cbs.ott',
    iosScheme: 'paramountplus://',
    color: '#0064FF',
  },
];

export const SERVICE_IDS = STREAMING_SERVICES.map((s) => s.id);

export function servicesForRegion(region: Region): StreamingService[] {
  return STREAMING_SERVICES.filter((s) => s.tmdbProviderIds[region] !== undefined);
}

export function serviceById(id: string): StreamingService | undefined {
  return STREAMING_SERVICES.find((s) => s.id === id);
}

/* ----------------------------------------------------------------- moods */

export interface Mood {
  id: string;
  label: string;
  emoji: string;
  genres: Record<TitleType, string[]>;
}

export const MOODS: Mood[] = [
  {
    id: 'funny',
    label: 'Make us laugh',
    emoji: '😂',
    genres: { MOVIE: ['Comedy'], TV: ['Comedy'] },
  },
  {
    id: 'thrilling',
    label: 'Keep us on edge',
    emoji: '😰',
    genres: { MOVIE: ['Thriller', 'Mystery', 'Crime'], TV: ['Mystery', 'Crime'] },
  },
  {
    id: 'romantic',
    label: 'Something tender',
    emoji: '💘',
    // TV has no Romance genre; Soap is the closest thing TMDB offers.
    genres: { MOVIE: ['Romance', 'Drama'], TV: ['Drama', 'Soap'] },
  },
  {
    id: 'action',
    label: 'Blow something up',
    emoji: '💥',
    genres: { MOVIE: ['Action', 'Adventure'], TV: ['Action & Adventure'] },
  },
  {
    id: 'scary',
    label: 'Scare us',
    emoji: '👻',
    genres: { MOVIE: ['Horror'], TV: ['Mystery', 'Sci-Fi & Fantasy'] },
  },
  {
    id: 'mindbending',
    label: 'Mess with our heads',
    emoji: '🌀',
    genres: {
      MOVIE: ['Science Fiction', 'Mystery', 'Fantasy'],
      TV: ['Sci-Fi & Fantasy', 'Mystery'],
    },
  },
];

export const MOOD_IDS = MOODS.map((m) => m.id);

export function moodById(id: string): Mood | undefined {
  return MOODS.find((m) => m.id === id);
}

export const WATCH_KINDS = [
  { id: 'MOVIE', label: 'A movie', emoji: '🎬', blurb: 'One sitting, done tonight.' },
  { id: 'TV', label: 'A series', emoji: '📺', blurb: 'Something to start together.' },
] as const;

export type WatchKind = (typeof WATCH_KINDS)[number]['id'];

/** Duration filters, in minutes. `null` max = no upper bound. Movies only. */
export const DURATION_FILTERS = [
  { id: 'short', label: 'Under 100 min', maxRuntime: 100 },
  { id: 'medium', label: 'Under 2 hours', maxRuntime: 120 },
  { id: 'any', label: 'Any length', maxRuntime: null },
] as const;

export const ERA_FILTERS = [
  { id: 'any', label: 'Any era', sinceYears: null },
  { id: 'new', label: '🆕 New', sinceYears: 0 },
  { id: 'recent', label: 'Last 5 years', sinceYears: 5 },
  { id: 'modern', label: 'Last 15 years', sinceYears: 15 },
] as const;
export type EraId = (typeof ERA_FILTERS)[number]['id'];

/** Turns an era id into a minimum release year, or null for "any". */
export function minYearForEra(id: string, now = new Date()): number | null {
  const era = ERA_FILTERS.find((e) => e.id === id);
  if (!era || era.sinceYears === null) return null;
  return now.getFullYear() - era.sinceYears;
}

/** A quality floor on TMDB's average vote. null = anything goes. */
export const RATING_FILTERS = [
  { id: 'any', label: '🎲 Surprise us', minRating: null },
  { id: 'decent', label: '👍 6+', minRating: 6 },
  { id: 'great', label: '⭐ 7.5+', minRating: 7.5 },
] as const;
export type RatingId = (typeof RATING_FILTERS)[number]['id'];

export function minRatingForId(id: string): number | null {
  return RATING_FILTERS.find((r) => r.id === id)?.minRating ?? null;
}

export const LANGUAGE_FILTERS = [
  { id: 'any', label: '🌍 Any language', code: null },
  { id: 'hi', label: '🇮🇳 Hindi', code: 'hi' },
  { id: 'en', label: '🔤 English', code: 'en' },
] as const;
export type LanguageId = (typeof LANGUAGE_FILTERS)[number]['id'];

export function languageCodeForId(id: string): string | null {
  return LANGUAGE_FILTERS.find((l) => l.id === id)?.code ?? null;
}

export const DECK_SIZES = [10, 15, 20] as const;
export type DeckSize = (typeof DECK_SIZES)[number];

/** How many titles each person swipes in a session, by default. */
export const SESSION_QUEUE_SIZE = 15;

/** Don't re-show a title the user swiped on within this window. */
export const RECENT_SWIPE_EXCLUSION_DAYS = 30;

/** How many near-misses the results screen offers as a tiebreaker. */
export const NEAR_MISS_LIMIT = 5;

/** How long after a matched night we still ask "did you watch it?". */
export const WATCH_CHECK_WINDOW_DAYS = 7;

export const WATCH_CHECK_MIN_AGE_HOURS = 8;

export const ASYNC_SESSION_TTL_DAYS = 7;

/* ------------------------------------------------------------- api types */

/** A saved recurring partner, for the one-tap "Start with X" button. */
export interface PublicPartner {
  id: string;
  displayName: string;
}

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  region: Region;
  services: string[];
  partnerId: string | null;
  partner: PublicPartner | null;
  /** False until the user has picked a region + at least one service. */
  onboarded: boolean;
  createdAt: string;
}

/** One row in the home screen's recent-sessions list. */
export interface SessionSummary {
  id: string;
  mode: SessionMode;
  status: SessionStatus;
  titleType: TitleType;
  /** The other person's name, from this caller's point of view. */
  partnerLabel: string;
  matchCount: number;
  /** Posters of the matches, for the little stack on the history row. */
  matchPosters: string[];
  mood: string | null;
  createdAt: string;
  completedAt: string | null;
}

/** One page of the nights history, with a cursor to fetch the next. */
export interface SessionsPage {
  sessions: SessionSummary[];
  /** True when another page exists. */
  hasMore: boolean;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResponse extends AuthTokens {
  user: PublicUser;
}

export interface SignupBody {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginBody {
  email: string;
  password: string;
}

export interface RefreshBody {
  refreshToken: string;
}

export interface UpdateMeBody {
  displayName?: string;
  region?: Region;
  services?: string[];
  partnerId?: string | null;
}

/** Shape of every non-2xx response from the API. */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** Present on 422s: field name -> problem. */
    fields?: Record<string, string>;
  };
}

export const PASSWORD_MIN_LENGTH = 8;

const COMMON_PASSWORDS = new Set([
  'password', 'password1', 'password123', 'passw0rd', 'p@ssword',
  '12345678', '123456789', '1234567890', '12345678910', '87654321',
  'qwertyui', 'qwerty123', 'qwertyuiop', 'asdfghjk', 'asdfghjkl',
  'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'welcome1', 'admin123', 'letmein1', 'trustno1', 'monkey12',
  'abc12345', 'a1b2c3d4', '11111111', '00000000', 'zaq12wsx',
  'watchly', 'watchly1', 'watchly123',
]);

export interface PasswordProblem {
  ok: boolean;
  message?: string;
}

export function checkPassword(password: string, email?: string): PasswordProblem {
  if (password.length < PASSWORD_MIN_LENGTH) {
    return { ok: false, message: `Use at least ${PASSWORD_MIN_LENGTH} characters.` };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { ok: false, message: 'That one is on every password-guessing list. Pick another.' };
  }

  // A single repeated character clears any length check and is trivially guessed.
  if (new Set(password).size < 4) {
    return { ok: false, message: 'Too repetitive — mix in some different characters.' };
  }

  // Using the local part of your own email is a very common habit.
  const local = email?.split('@')[0]?.toLowerCase();
  if (local && local.length >= 4 && password.toLowerCase().includes(local)) {
    return { ok: false, message: "Don't use your email address in your password." };
  }

  return { ok: true };
}

/* ------------------------------------------------------- realtime (Socket.io) */

/** How far each person has got through the deck. */
export interface SessionProgressPayload {
  total: number;
  personA: number;
  personB: number;
  personADone: boolean;
  personBDone: boolean;
  bothDone: boolean;
}

/** Server -> client. */
export interface ServerToClientEvents {
  /** Person B has joined; person A can stop waiting and start swiping. */
  'session:joined': (data: {
    personALabel: string;
    personBLabel: string;
    /** Both phones deal from this exact list, in this exact order. */
    titleIds: string[];
  }) => void;

  /** Someone swiped. Count only — never the decision. */
  'vote:submitted': (data: { progress: SessionProgressPayload }) => void;

  /** Both people finished the deck. Both phones navigate to results together. */
  'session:completed': (data: { progress: SessionProgressPayload }) => void;

  /** The other person dropped off (backgrounded the app, lost signal). */
  'partner:disconnected': () => void;
  'partner:reconnected': () => void;

  /** Session was abandoned (30 minutes idle) and can no longer be resumed. */
  'session:abandoned': () => void;

  'error:message': (data: { message: string }) => void;
}

/** Client -> server. */
export interface ClientToServerEvents {
  /** Enter the session's room. Ack tells the caller which side they are. */
  'session:join': (
    data: { sessionId: string },
    ack: (res: { ok: true; voter: Voter } | { ok: false; message: string }) => void,
  ) => void;
}

/** Sessions idle longer than this are auto-abandoned, and reconnects refused. */
export const SESSION_IDLE_TIMEOUT_MINUTES = 30;
