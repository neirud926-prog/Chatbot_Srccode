// Theme store — persists in localStorage, toggles data-theme on <html>.
// Two themes: "nature" (default, warm cream + sage) and "dark" (Gemini-style).
import { create } from 'zustand';

export type Theme = 'nature' | 'dark';
const KEY = 'pychatbot_theme';

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function initialTheme(): Theme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === 'dark' || stored === 'nature') return stored;
  } catch {
    /* ignore */
  }
  // Default follows OS preference if available, else nature
  if (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  ) {
    return 'dark';
  }
  return 'nature';
}

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

export const useTheme = create<ThemeState>((set, get) => {
  const initial = initialTheme();
  applyTheme(initial);
  return {
    theme: initial,
    setTheme: (t) => {
      applyTheme(t);
      try {
        localStorage.setItem(KEY, t);
      } catch {
        /* ignore */
      }
      set({ theme: t });
    },
    toggle: () => {
      const next: Theme = get().theme === 'dark' ? 'nature' : 'dark';
      get().setTheme(next);
    },
  };
});
