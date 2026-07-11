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
 * Session.services). `tmdbProviderId` is TMDB's id for the same service — the
 * join key when we read watch providers off a title. Deep links are wired up in
 * Feature 5; `androidPackage` / `iosScheme` are here so the catalog stays the
 * single source of truth for a service rather than getting split across files.
 */
export interface StreamingService {
  id: string;
  label: string;
  tmdbProviderId: number;
  regions: Region[];
  androidPackage: string;
  iosScheme: string;
  /** Brand colour, used for the service chips and result-card logos. */
  color: string;
}

export const STREAMING_SERVICES: StreamingService[] = [
  {
    id: 'netflix',
    label: 'Netflix',
    tmdbProviderId: 8,
    regions: ['IN', 'US'],
    androidPackage: 'com.netflix.mediaclient',
    iosScheme: 'nflx://',
    color: '#E50914',
  },
  {
    id: 'prime',
    label: 'Prime Video',
    tmdbProviderId: 119,
    regions: ['IN', 'US'],
    androidPackage: 'com.amazon.avod.thirdpartyclient',
    iosScheme: 'aiv://',
    color: '#00A8E1',
  },
  {
    id: 'hotstar',
    label: 'JioHotstar',
    tmdbProviderId: 122,
    regions: ['IN'],
    androidPackage: 'in.startv.hotstar',
    iosScheme: 'hotstar://',
    color: '#1F80E0',
  },
  {
    id: 'jiocinema',
    label: 'JioCinema',
    tmdbProviderId: 970,
    regions: ['IN'],
    androidPackage: 'com.jio.media.ondemand',
    iosScheme: 'jiocinema://',
    color: '#8A2BE2',
  },
  {
    id: 'sonyliv',
    label: 'Sony LIV',
    tmdbProviderId: 237,
    regions: ['IN'],
    androidPackage: 'com.sonyliv',
    iosScheme: 'sonyliv://',
    color: '#F26522',
  },
  {
    id: 'zee5',
    label: 'ZEE5',
    tmdbProviderId: 232,
    regions: ['IN'],
    androidPackage: 'com.graymatrix.did',
    iosScheme: 'zee5://',
    color: '#8230C6',
  },
  {
    id: 'appletv',
    label: 'Apple TV+',
    tmdbProviderId: 350,
    regions: ['IN', 'US'],
    androidPackage: 'com.apple.atve.androidtv.appletv',
    iosScheme: 'videos://',
    color: '#B0B0B0',
  },
  {
    id: 'disneyplus',
    label: 'Disney+',
    tmdbProviderId: 337,
    regions: ['US'],
    androidPackage: 'com.disney.disneyplus',
    iosScheme: 'disneyplus://',
    color: '#113CCF',
  },
];

export const SERVICE_IDS = STREAMING_SERVICES.map((s) => s.id);

export function servicesForRegion(region: Region): StreamingService[] {
  return STREAMING_SERVICES.filter((s) => s.regions.includes(region));
}

export function serviceById(id: string): StreamingService | undefined {
  return STREAMING_SERVICES.find((s) => s.id === id);
}

/* ------------------------------------------------------------- api types */

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  region: Region;
  services: string[];
  partnerId: string | null;
  /** False until the user has picked a region + at least one service. */
  onboarded: boolean;
  createdAt: string;
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
