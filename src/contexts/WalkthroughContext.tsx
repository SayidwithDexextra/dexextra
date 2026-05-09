'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import WalkthroughLayer from '@/components/walkthrough/WalkthroughLayer';

export type WalkthroughPlacement = 'auto' | 'top' | 'right' | 'bottom' | 'left';

export type WalkthroughStep = {
  id: string;
  route?: string;
  selector: string;
  title: string;
  description: string;
  placement?: WalkthroughPlacement;
  paddingPx?: number;
  radiusPx?: number;
  /**
   * Extra spacing between the bubble and the highlighted target.
   * Note: total visual spacing from the actual element is roughly `paddingPx + gapPx`.
   */
  gapPx?: number;
  /**
   * Optional events to dispatch when this step becomes active.
   * Useful for opening modals / switching UI context during a walkthrough.
   */
  enterEvents?: Array<{ name: string; detail?: any }>;
  /**
   * If true, do not apply the global scroll lock for this step.
   * Useful for tours that intentionally scroll the page to reveal content.
   */
  allowDocumentScroll?: boolean;
  scrollIntoView?: boolean;
  nextLabel?: string;
};

export type WalkthroughDefinition = {
  id: string;
  steps: WalkthroughStep[];
  /**
   * If set, completion is persisted in localStorage under this key.
   * If omitted, a default key `dexextra:walkthrough:<id>:completed` is used.
   */
  storageKey?: string;
};

type WalkthroughState = {
  active: boolean;
  definition: WalkthroughDefinition | null;
  index: number;
};

type WalkthroughContextValue = {
  state: WalkthroughState;
  currentStep: WalkthroughStep | null;
  progress: { index: number; total: number } | null;
  start: (definition: WalkthroughDefinition, opts?: { startAt?: number | string; force?: boolean }) => void;
  stop: (opts?: { markCompleted?: boolean }) => void;
  next: () => void;
  prev: () => void;
  goTo: (indexOrId: number | string) => void;
  isCompleted: (walkthroughId: string, storageKeyOverride?: string) => boolean;
};

const WalkthroughContext = createContext<WalkthroughContextValue | null>(null);

function resolveStorageKey(definition: WalkthroughDefinition) {
  return definition.storageKey || `dexextra:walkthrough:${definition.id}:completed`;
}

// Cookie names can't contain `:` or other separator chars, so we derive a
// safe cookie name from the storage key (which IS allowed to contain colons).
function cookieNameFromStorageKey(storageKey: string): string {
  return storageKey.replace(/[^a-zA-Z0-9_-]/g, '_');
}

const COMPLETION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const value = `; ${document.cookie}`;
    const parts = value.split(`; ${name}=`);
    if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
    return null;
  } catch {
    return null;
  }
}

function writeCookie(name: string, value: string, maxAgeSeconds: number) {
  if (typeof document === 'undefined') return;
  try {
    const secure = typeof window !== 'undefined' && window.location?.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${name}=${value}; Max-Age=${maxAgeSeconds}; Path=/; SameSite=Lax${secure}`;
  } catch {}
}

function safeReadCompleted(storageKey: string): boolean {
  if (typeof window === 'undefined') return false;
  // Cookie is the source of truth across sessions / devices that share the same browser.
  const cookieName = cookieNameFromStorageKey(storageKey);
  if (readCookie(cookieName) === '1') return true;
  // Backwards compatibility: users who completed a tour before the cookie
  // switch shouldn't see it again. Fall back to localStorage and migrate.
  try {
    if (window.localStorage.getItem(storageKey) === '1') {
      writeCookie(cookieName, '1', COMPLETION_COOKIE_MAX_AGE_SECONDS);
      return true;
    }
  } catch {}
  return false;
}

function safeWriteCompleted(storageKey: string) {
  if (typeof window === 'undefined') return;
  const cookieName = cookieNameFromStorageKey(storageKey);
  writeCookie(cookieName, '1', COMPLETION_COOKIE_MAX_AGE_SECONDS);
  try {
    window.localStorage.setItem(storageKey, '1');
  } catch {}
}

function normalizeStartAt(definition: WalkthroughDefinition, startAt?: number | string): number {
  if (typeof startAt === 'number' && Number.isFinite(startAt)) {
    return Math.max(0, Math.min(definition.steps.length - 1, Math.floor(startAt)));
  }
  if (typeof startAt === 'string' && startAt.trim()) {
    const idx = definition.steps.findIndex((s) => s.id === startAt);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  const [state, setState] = useState<WalkthroughState>({
    active: false,
    definition: null,
    index: 0,
  });

  const lastPushedRouteRef = useRef<string | null>(null);

  const currentStep = useMemo(() => {
    if (!state.active || !state.definition) return null;
    return state.definition.steps[state.index] || null;
  }, [state.active, state.definition, state.index]);

  const progress = useMemo(() => {
    if (!state.active || !state.definition) return null;
    const total = state.definition.steps.length;
    return { index: Math.max(0, state.index), total: Math.max(0, total) };
  }, [state.active, state.definition, state.index]);

  const isCompleted = useCallback((walkthroughId: string, storageKeyOverride?: string) => {
    const key = storageKeyOverride || `dexextra:walkthrough:${walkthroughId}:completed`;
    return safeReadCompleted(key);
  }, []);

  const stop = useCallback((opts?: { markCompleted?: boolean }) => {
    setState((prev) => {
      const def = prev.definition;
      const shouldMark = Boolean(opts?.markCompleted);
      if (shouldMark && def) {
        safeWriteCompleted(resolveStorageKey(def));
      }
      return { active: false, definition: null, index: 0 };
    });
  }, []);

  const start = useCallback(
    (definition: WalkthroughDefinition, opts?: { startAt?: number | string; force?: boolean }) => {
      const storageKey = resolveStorageKey(definition);
      const completed = safeReadCompleted(storageKey);
      if (completed && !opts?.force) return;

      // Persist completion immediately when a tour starts so that closing it
      // mid-flight (X button → `stop()` without `markCompleted`) still
      // prevents the auto-start from showing it again on the next visit.
      // Manual restarts from FooterSupportPopup pass `force: true`, which
      // bypasses the cookie check above, so this doesn't lock out re-runs.
      safeWriteCompleted(storageKey);

      const idx = normalizeStartAt(definition, opts?.startAt);
      setState({ active: true, definition, index: idx });
    },
    []
  );

  const next = useCallback(() => {
    setState((prev) => {
      if (!prev.active || !prev.definition) return prev;
      const nextIndex = prev.index + 1;
      if (nextIndex >= prev.definition.steps.length) {
        safeWriteCompleted(resolveStorageKey(prev.definition));
        return { active: false, definition: null, index: 0 };
      }
      return { ...prev, index: nextIndex };
    });
  }, []);

  const prev = useCallback(() => {
    setState((prev) => {
      if (!prev.active || !prev.definition) return prev;
      return { ...prev, index: Math.max(0, prev.index - 1) };
    });
  }, []);

  const goTo = useCallback((indexOrId: number | string) => {
    setState((prev) => {
      if (!prev.active || !prev.definition) return prev;
      const total = prev.definition.steps.length;

      if (typeof indexOrId === 'number') {
        const idx = Math.max(0, Math.min(total - 1, Math.floor(indexOrId)));
        return { ...prev, index: idx };
      }

      const idx = prev.definition.steps.findIndex((s) => s.id === indexOrId);
      if (idx < 0) return prev;
      return { ...prev, index: idx };
    });
  }, []);

  // Route sync: if a step belongs to another route, push that route.
  useEffect(() => {
    if (!state.active || !state.definition) return;
    const step = state.definition.steps[state.index];
    const route = step?.route ? String(step.route) : '';
    if (!route) {
      lastPushedRouteRef.current = null;
      return;
    }
    if (pathname === route) {
      lastPushedRouteRef.current = null;
      return;
    }
    if (lastPushedRouteRef.current === route) return;
    lastPushedRouteRef.current = route;
    router.push(route);
  }, [pathname, router, state.active, state.definition, state.index]);

  const value = useMemo<WalkthroughContextValue>(
    () => ({
      state,
      currentStep,
      progress,
      start,
      stop,
      next,
      prev,
      goTo,
      isCompleted,
    }),
    [currentStep, goTo, isCompleted, next, prev, progress, start, state, stop]
  );

  return (
    <WalkthroughContext.Provider value={value}>
      {children}
      <WalkthroughLayer />
    </WalkthroughContext.Provider>
  );
}

export function useWalkthrough(): WalkthroughContextValue {
  const ctx = useContext(WalkthroughContext);
  if (!ctx) {
    throw new Error('useWalkthrough must be used within a WalkthroughProvider');
  }
  return ctx;
}

