import { create } from 'zustand';
import type { AuthResponse, LoginBody, PublicUser, SignupBody, UpdateMeBody } from '@watchly/shared';
import { api, setSessionExpiredHandler } from '../lib/api';
import { clearTokens, loadTokens, saveTokens } from '../lib/tokens';
import { identify, resetAnalytics } from '../lib/analytics';

interface AuthStore {
  user: PublicUser | null;
  /** True until we've checked SecureStore for an existing session on launch. */
  loading: boolean;

  restore: () => Promise<void>;
  signup: (body: SignupBody) => Promise<void>;
  login: (body: LoginBody) => Promise<void>;
  logout: () => Promise<void>;
  updateMe: (patch: UpdateMeBody) => Promise<PublicUser>;
  deleteAccount: (password: string) => Promise<void>;
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
      const me = await api<PublicUser>('/api/me');
      identify(me.id, { region: me.region, services: me.services.length });
      set({ user: me });
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
    identify(res.user.id, { region: res.user.region, services: res.user.services.length });
    set({ user: res.user });
  },

  login: async (body) => {
    const res = await api<AuthResponse>('/api/auth/login', {
      method: 'POST',
      body,
      public: true,
    });
    await saveTokens(res);
    identify(res.user.id, { region: res.user.region, services: res.user.services.length });
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
    resetAnalytics();
    set({ user: null });
  },

  updateMe: async (patch) => {
    const updated = await api<PublicUser>('/api/me', { method: 'PATCH', body: patch });
    set({ user: updated });
    return updated;
  },

  deleteAccount: async (password) => {
    await api<void>('/api/me', { method: 'DELETE', body: { password } });
    await clearTokens();
    resetAnalytics();
    set({ user: null });
  },
}));

setSessionExpiredHandler(() => useAuthStore.setState({ user: null }));

export const useUser = () => useAuthStore((s) => s.user);
export const useAuthLoading = () => useAuthStore((s) => s.loading);
