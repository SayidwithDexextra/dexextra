'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

type ThemeState = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const STORAGE_KEY = 'dexetra_theme';

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.classList.remove('light', 'dark');
  el.classList.add(theme);
}

function getInitialTheme(): ThemeMode {
  // Default to dark to match current styling; allow user pref if present.
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  try {
    const prefersLight = window.matchMedia?.('(prefers-color-scheme: light)')?.matches;
    return prefersLight ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Important for Next.js hydration:
  // The server cannot read localStorage / matchMedia, so it always renders the default theme.
  // If the client chooses a different theme during the *first render*, React hydration will fail.
  // Start with a deterministic value that matches SSR, then resolve user/system preference after mount.
  const [theme, _setTheme] = useState<ThemeMode>('dark');

  const setTheme = useCallback((t: ThemeMode) => {
    _setTheme(t);
    applyThemeToDom(t);
    try {
      window.localStorage.setItem(STORAGE_KEY, t);
    } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [setTheme, theme]);

  // After hydration, align with stored preference / system theme (if any).
  useEffect(() => {
    const initial = getInitialTheme();
    _setTheme(initial);
    applyThemeToDom(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ensure DOM stays in sync whenever theme changes after mount.
  useEffect(() => {
    applyThemeToDom(theme);
  }, [theme]);

  const value = useMemo<ThemeState>(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}


