import type { ApiErrorBody, AuthResponse, AuthTokens } from '@watchly/shared';
import { clearTokens, loadTokens, saveTokens } from './tokens';

/**
 * On a simulator localhost reaches the host machine, but on a physical device it
 * points at the phone itself — so for real-device testing set EXPO_PUBLIC_API_URL
 * to your machine's LAN address (e.g. http://192.168.1.5:4000) in apps/mobile/.env.
 */
export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000';

/** Thrown for any non-2xx response; carries the API's structured error body. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

/**
 * Called when refresh fails and the user is definitively logged out. The auth
 * provider registers itself here — this module can't import the provider without
 * a cycle, and a 401 can surface from any screen, not just one with auth context.
 */
let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

/**
 * In-flight refresh, if any. Concurrent 401s (the app fires several requests on
 * launch) must not each burn a refresh token: the first rotation would invalidate
 * the token the others are holding and they'd all log the user out. So they all
 * await the same promise.
 */
let refreshInFlight: Promise<AuthTokens> | null = null;

async function refreshTokens(refreshToken: string): Promise<AuthTokens> {
  refreshInFlight ??= (async () => {
    try {
      const res = await fetch(`${API_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) throw await toApiError(res);

      const data = (await res.json()) as AuthResponse;
      await saveTokens(data);
      return { accessToken: data.accessToken, refreshToken: data.refreshToken };
    } finally {
      refreshInFlight = null;
    }
  })();

  return refreshInFlight;
}

async function toApiError(res: Response): Promise<ApiError> {
  let body: ApiErrorBody | undefined;
  try {
    body = (await res.json()) as ApiErrorBody;
  } catch {
    // Non-JSON response (proxy error page, Render cold-start HTML, ...).
  }
  return new ApiError(
    res.status,
    body?.error?.code ?? 'UNKNOWN',
    body?.error?.message ?? 'Something went wrong. Try again.',
    body?.error?.fields,
  );
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skips the Authorization header and the 401-refresh dance (login/signup). */
  public?: boolean;
}

export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, public: isPublic = false } = options;

  const send = async (accessToken?: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          ...(body !== undefined && { 'content-type': 'application/json' }),
          ...(accessToken && { authorization: `Bearer ${accessToken}` }),
        },
        ...(body !== undefined && { body: JSON.stringify(body) }),
      });
    } catch {
      // fetch only rejects on network failure, not on HTTP errors.
      throw new ApiError(0, 'NETWORK', "Can't reach Watchly. Check your connection.");
    }
    return res;
  };

  if (isPublic) {
    const res = await send();
    if (!res.ok) throw await toApiError(res);
    return parse<T>(res);
  }

  const tokens = await loadTokens();
  if (!tokens) {
    onSessionExpired();
    throw new ApiError(401, 'UNAUTHORIZED', 'Sign in to continue.');
  }

  let res = await send(tokens.accessToken);

  // The access token lives 15 minutes, so this fires constantly in normal use —
  // it's the happy path, not an edge case.
  if (res.status === 401) {
    let fresh: AuthTokens;
    try {
      fresh = await refreshTokens(tokens.refreshToken);
    } catch {
      // Refresh token is expired or revoked: this is a real logout.
      await clearTokens();
      onSessionExpired();
      throw new ApiError(401, 'UNAUTHORIZED', 'Your session expired. Sign in again.');
    }
    res = await send(fresh.accessToken);
  }

  if (!res.ok) throw await toApiError(res);
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
