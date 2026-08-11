import type { ApiErrorBody, AuthResponse, AuthTokens } from '@watchly/shared';
import { clearTokens, loadTokens, saveTokens } from './tokens';

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

let onSessionExpired: () => void = () => {};
export function setSessionExpiredHandler(fn: () => void) {
  onSessionExpired = fn;
}

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

  if (res.status === 401) {
    const current = await loadTokens();

    if (current && current.accessToken !== tokens.accessToken) {
      // Somebody else already refreshed. Just use what they got.
      res = await send(current.accessToken);
    } else {
      let fresh: AuthTokens;
      try {
        fresh = await refreshTokens(current?.refreshToken ?? tokens.refreshToken);
      } catch {
        // Refresh token is genuinely expired or revoked: this is a real logout.
        await clearTokens();
        onSessionExpired();
        throw new ApiError(401, 'UNAUTHORIZED', 'Your session expired. Sign in again.');
      }
      res = await send(fresh.accessToken);
    }
  }

  if (!res.ok) throw await toApiError(res);
  return parse<T>(res);
}

async function parse<T>(res: Response): Promise<T> {
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
