import { create } from 'zustand';
import type { AuthResponse, LoginBody, PublicUser, SignupBody, UpdateMeBody } from '@watchly/shared';
import { api, setSessionExpiredHandler } from '../lib/api';
import { clearTokens, loadTokens, saveTokens } from '../lib/tokens';

interface AuthStore {
  user: PublicUser | null;
  /** True until we've checked SecureStore for an existing session on launch. */
  loading: boolean;

  restore: () => Promise<void>;
  signup: (body: SignupBody) => Promise<void>;
  login: (body: LoginBody) => Promise<void>;
  logout: () => Promise<void>;
  updateMe: (patch: UpdateMeBody) => Promise<PublicUser>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  loading: true,

  /** Called once on mount from the root layout. */
  restore: async () => {
    try {
      const tokens = await loadTokens();
      if (!tokens) return;
      // api() transparently refreshes if the stored access token is stale.
      set({ user: await api<PublicUser>('/api/me') });
    } catch {
      // Expired or revoked — stay signed out. api() already cleared the tokens.
    } finally {
      set({ loading: false });
    }
  },

  signup: async (body) => {
    const res = await api<AuthResponse>('/api/auth/signup', {
      method: 'POST',
      body,
      public: true,
    });
    await saveTokens(res);
    set({ user: res.user });
  },

  login: async (body) => {
    const res = await api<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body,
      public: true,
    });
    await saveTokens(res);
    set({ user: res.user });
  },

  logout: async () => {
    try {
      await api<void>('/api/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails (offline, already-expired token), the local
      // session must go — the user asked to sign out.
    }
    await clearTokens();
    set({ user: null });
  },

  updateMe: async (patch) => {
    const updated = await api<PublicUser>('/api/me', { method: 'PATCH', body: patch });
    set({ user: updated });
    return updated;
  },
}));

/**
 * A failed refresh anywhere in the app drops us back to signed-out. Registered at
 * module scope rather than in a hook: a 401 can surface from any screen, and the
 * api module can't import this store without a cycle.
 */
setSessionExpiredHandler(() => useAuthStore.setState({ user: null }));

/* Selectors. Subscribing to one field means a screen that only reads `user`
   doesn't re-render when `loading` flips, which matters on the swipe screen. */
export const useUser = () => useAuthStore((s) => s.user);
export const useAuthLoading = () => useAuthStore((s) => s.loading);
