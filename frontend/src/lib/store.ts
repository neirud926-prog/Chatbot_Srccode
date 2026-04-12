// Global auth/session store. Kept small on purpose.
import { create } from 'zustand';
import { api } from './api';

interface AuthState {
  loaded: boolean;
  loggedIn: boolean;
  userId: number | null;
  username: string | null;
  provider: string;
  refresh: () => Promise<void>;
  login: (username: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  setProvider: (p: string) => void;
}

export const useAuth = create<AuthState>((set) => ({
  loaded: false,
  loggedIn: false,
  userId: null,
  username: null,
  provider: 'nltk',
  refresh: async () => {
    try {
      const me = await api.me();
      set({
        loaded: true,
        loggedIn: me.logged_in,
        userId: me.user_id ?? null,
        username: me.username ?? null,
        provider: me.provider ?? 'nltk',
      });
    } catch {
      set({ loaded: true, loggedIn: false, userId: null, username: null });
    }
  },
  login: async (username, password) => {
    try {
      const r = await api.login(username, password);
      if (!r.ok) return r.message;
      set({
        loaded: true,
        loggedIn: true,
        userId: r.user_id,
        username,
      });
      return null;
    } catch (e: any) {
      return e?.message || 'Login failed';
    }
  },
  logout: async () => {
    try {
      await api.logout();
    } catch {
      /* ignore */
    }
    set({ loggedIn: false, userId: null, username: null });
  },
  setProvider: (p) => set({ provider: p }),
}));
