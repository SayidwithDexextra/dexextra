'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

type ThemeState = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
  canSwitchTheme: boolean;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

const STORAGE_KEY = 'dexextra-theme';
const DEFAULT_THEME: ThemeMode = 'dark';

function isDevEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  const host = window.location.hostname;
  return (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host.startsWith('192.168.') ||
    process.env.NODE_ENV === 'development'
  );
}

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.classList.remove('light', 'dark');
  el.classList.add(theme);
}

function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_THEME;
  if (!isDevEnvironment()) return DEFAULT_THEME;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {}
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>(DEFAULT_THEME);
  const [canSwitch, setCanSwitch] = useState(false);

  const setTheme = useCallback((t: ThemeMode) => {
    if (!isDevEnvironment()) return;
    setThemeState(t);
    applyThemeToDom(t);
    try { localStorage.setItem(STORAGE_KEY, t); } catch {}
  }, []);

  const toggleTheme = useCallback(() => {
    if (!isDevEnvironment()) return;
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark';
      applyThemeToDom(next);
      try { localStorage.setItem(STORAGE_KEY, next); } catch {}
      return next;
    });
  }, []);

  useEffect(() => {
    const dev = isDevEnvironment();
    setCanSwitch(dev);
    const stored = dev ? getStoredTheme() : DEFAULT_THEME;
    setThemeState(stored);
    applyThemeToDom(stored);
  }, []);

  const value = useMemo<ThemeState>(
    () => ({ theme, setTheme, toggleTheme, canSwitchTheme: canSwitch }),
    [theme, setTheme, toggleTheme, canSwitch],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
