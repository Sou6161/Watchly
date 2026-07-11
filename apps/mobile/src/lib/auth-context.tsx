import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthResponse, LoginBody, PublicUser, SignupBody, UpdateMeBody } from '@watchly/shared';
import { api, setSessionExpiredHandler } from './api';
import { clearTokens, loadTokens, saveTokens } from './tokens';

interface AuthState {
  user: PublicUser | null;
  /** True until we've checked SecureStore for an existing session on launch. */
  loading: boolean;
  signup: (body: SignupBody) => Promise<void>;
  login: (body: LoginBody) => Promise<void>;
  logout: () => Promise<void>;
  updateMe: (patch: UpdateMeBody) => Promise<PublicUser>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [loading, setLoading] = useState(true);

  // A failed refresh anywhere in the app drops us back to signed-out.
  useEffect(() => {
    setSessionExpiredHandler(() => setUser(null));
  }, []);

  // Restore the session on cold start.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const tokens = await loadTokens();
        if (!tokens) return;
        // api() transparently refreshes if the stored access token is stale.
        const me = await api<PublicUser>('/api/me');
        if (!cancelled) setUser(me);
      } catch {
        // Expired or revoked — stay signed out. api() already cleared tokens.
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(async (path: string, body: SignupBody | LoginBody) => {
    const res = await api<AuthResponse>(path, { method: 'POST', body, public: true });
    await saveTokens(res);
    setUser(res.user);
  }, []);

  const signup = useCallback(
    (body: SignupBody) => authenticate('/api/auth/signup', body),
    [authenticate],
  );

  const login = useCallback(
    (body: LoginBody) => authenticate('/api/auth/login', body),
    [authenticate],
  );

  const logout = useCallback(async () => {
    try {
      await api<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails (offline, already-expired token), the
      // local session must go — the user asked to sign out.
    }
    await clearTokens();
    setUser(null);
  }, []);

  const updateMe = useCallback(async (patch: UpdateMeBody) => {
    const updated = await api<PublicUser>('/api/me', { method: 'PATCH', body: patch });
    setUser(updated);
    return updated;
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, loading, signup, login, logout, updateMe }),
    [user, loading, signup, login, logout, updateMe],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>.');
  return ctx;
}
