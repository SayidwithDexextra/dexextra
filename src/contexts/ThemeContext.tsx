'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemeMode = 'dark' | 'light';

type ThemeState = {
  theme: ThemeMode;
  setTheme: (t: ThemeMode) => void;
  toggleTheme: () => void;
};

const ThemeContext = createContext<ThemeState | undefined>(undefined);

// Theme switching is intentionally disabled across the platform.
// Keep this provider for API compatibility, but lock the theme to a single value.
const LOCKED_THEME: ThemeMode = 'dark';

function applyThemeToDom(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.classList.remove('light', 'dark');
  el.classList.add(theme);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Keep state so consumers still re-render predictably, but never allow switching.
  const [theme] = useState<ThemeMode>(LOCKED_THEME);

  const setTheme = useCallback((_t: ThemeMode) => {
    // no-op: theme switching disabled
  }, []);

  const toggleTheme = useCallback(() => {
    // no-op: theme switching disabled
  }, []);

  // Ensure the locked theme is applied after mount.
  useEffect(() => {
    applyThemeToDom(LOCKED_THEME);
  }, []);

  const value = useMemo<ThemeState>(() => ({ theme, setTheme, toggleTheme }), [theme, setTheme, toggleTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeState {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}


