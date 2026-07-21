/**
 * Types shared between the Expo app and the Express API.
 *
 * Consumed directly as TypeScript source (no build step) — Metro transpiles it
 * for mobile, tsx/tsc for the API.
 */

/* ------------------------------------------------------------------ enums */
/* These mirror the Prisma enums exactly. Prisma generates its own copies for
   the server; these are the versions the mobile app can import without pulling
   in @prisma/client. Keep them in sync with apps/api/prisma/schema.prisma. */

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

/**
 * The streaming services a user can subscribe to.
 *
 * `id` is our stable internal key (what we persist on User.services and
 * Session.services).
 *
 * `tmdbProviderIds` is keyed BY REGION, not a single number — TMDB assigns the
 * same service different provider ids in different territories (Prime Video is
 * 119 in India but 9 in the US). A service is offered in exactly the regions
 * this map has keys for, so there's no separate `regions` list to fall out of
 * sync with it. All ids below were verified against the live TMDB
 * /watch/providers endpoint (`npm run tmdb:providers -w @watchly/api`).
 *
 * Deep links are wired up in Feature 5; `androidPackage` / `iosScheme` live here
 * so a service is defined in exactly one place.
 */
export interface StreamingService {
  id: string;
  label: string;
  tmdbProviderIds: Partial<Record<Region, number>>;
  androidPackage: string;
  iosScheme: string;
  /** Brand colour, used for the service chips and result-card logos. */
  color: string;
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
    // Hotstar and JioCinema merged into a single service (JioHotstar) in 2025.
    // TMDB reflects that: there is no JioCinema provider in IN any more, and the
    // old Hotstar id (122) is gone. This one entry is both.
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
];

export const SERVICE_IDS = STREAMING_SERVICES.map((s) => s.id);

export function servicesForRegion(region: Region): StreamingService[] {
  return STREAMING_SERVICES.filter((s) => s.tmdbProviderIds[region] !== undefined);
}

export function serviceById(id: string): StreamingService | undefined {
  return STREAMING_SERVICES.find((s) => s.id === id);
}

/* ----------------------------------------------------------------- moods */

/**
 * Session mood filters. Each maps to a set of TMDB genre names, matched against
 * the genres we cached on Title. Genre *names* rather than TMDB's numeric ids
 * because movie and TV use different id spaces for the same genre — names are
 * the only thing that joins cleanly across both.
 */
export interface Mood {
  id: string;
  label: string;
  emoji: string;
  /**
   * Genre names PER MEDIA TYPE, because TMDB uses two different vocabularies.
   *
   * There is no "Horror" or "Action" genre for television — TMDB collapses those
   * into "Sci-Fi & Fantasy" and "Action & Adventure". Using the movie list for a
   * series search silently matches nothing and hands the user an empty deck, which
   * is exactly what happened before this was split.
   */
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
    // No Horror genre for TV at all. Mystery + Sci-Fi & Fantasy is the nearest
    // honest approximation TMDB's taxonomy allows.
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

/**
 * Movie or series — asked before anything else, because it changes what the rest
 * of the filters even mean.
 *
 * Notably the duration filter: TMDB reports a series' runtime PER EPISODE, so
 * "under 100 min" would be satisfied by a 62-episode show with 40-minute episodes.
 * Someone asking for something short means "we have 90 minutes tonight". So the
 * duration filter is offered for movies only.
 */
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

/** How many titles each person swipes in a session. */
export const SESSION_QUEUE_SIZE = 15;

/** Don't re-show a title the user swiped on within this window. */
export const RECENT_SWIPE_EXCLUSION_DAYS = 30;

/** How many near-misses the results screen offers as a tiebreaker. */
export const NEAR_MISS_LIMIT = 5;

/** How long after a matched night we still ask "did you watch it?". */
export const WATCH_CHECK_WINDOW_DAYS = 7;

/**
 * How long an async session may sit idle before it's abandoned. Far longer than
 * the 30-minute live timeout: the whole point of async is that person B might not
 * pick it up until tomorrow.
 */
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
  /**
   * The saved partner's name, resolved server-side. The client needs it to label
   * a button ("Start with Aditi") and has no other way to turn an id into a name
   * — it can't look up other users, and it shouldn't be able to.
   */
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
  /** The other person's name, from this caller's point of view. */
  partnerLabel: string;
  matchCount: number;
  /** Posters of the matches, for the little stack on the history row. */
  matchPosters: string[];
  mood: string | null;
  createdAt: string;
  completedAt: string | null;
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

/**
 * Passwords that a length check happily accepts and an attacker tries first.
 *
 * A minimum length alone is close to useless: "password", "12345678" and
 * "qwertyui" are all eight characters. Every real credential-stuffing attempt
 * starts with a list like this, so blocking the top of it removes most of the
 * risk for one comparison.
 *
 * Deliberately small and readable rather than a bundled breach corpus — the long
 * tail needs a k-anonymity lookup against Have I Been Pwned, which is worth doing
 * when there are real users, not at zero.
 */
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

/**
 * Shared by the client (instant feedback while typing) and the server (the check
 * that actually counts — a client-side rule is a suggestion, not a control).
 */
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

/**
 * Multi-device sync. Typed on both ends so an event rename can't silently break
 * one side — Socket.io would otherwise just deliver nothing, forever, quietly.
 *
 * Deliberately, no event carries a vote *decision*. Neither person may see what
 * the other picked until the results screen; leaking it over the wire would make
 * the whole mechanic pointless, and "the client just won't render it" is not a
 * guarantee worth relying on.
 */

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
