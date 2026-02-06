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

function safeReadCompleted(storageKey: string): boolean {
  try {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(storageKey) === '1';
  } catch {
    return false;
  }
}

function safeWriteCompleted(storageKey: string) {
  try {
    if (typeof window === 'undefined') return;
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

