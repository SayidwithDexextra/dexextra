'use client';

import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import WalkthroughLayer from '@/components/walkthrough/WalkthroughLayer';
import { useGeoRestriction } from '@/hooks/useGeoRestriction';

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

  /**
   * Mobile-specific overrides. When the walkthrough renders on a mobile
   * viewport (matches `(max-width: 767px)`), these values replace the
   * desktop-only versions. Anything left undefined falls back to the
   * desktop value, so it's safe to override only what changes on mobile.
   *
   * - `mobileSelector` is useful when the desktop element is hidden on
   *   mobile and a different node carries the equivalent semantic meaning.
   * - `mobilePlacement` lets you dodge tight spaces (left/right rarely fit
   *   on phones — `top`/`bottom`/`auto` are usually safer).
   * - `mobileEnterEvents` runs *instead of* `enterEvents` on mobile so a
   *   step can drive different UI context (e.g. open the mobile menu
   *   instead of just changing focus).
   * - `mobileTitle`/`mobileDescription` shorten copy for small screens.
   * - `skipOnMobile` removes the step entirely on mobile when there's no
   *   sensible mobile equivalent.
   * - `mobilePaddingPx`/`mobileRadiusPx`/`mobileGapPx` tweak the spotlight
   *   to play nicely with denser mobile layouts.
   */
  mobileSelector?: string;
  mobilePlacement?: WalkthroughPlacement;
  mobileEnterEvents?: Array<{ name: string; detail?: any }>;
  mobileTitle?: string;
  mobileDescription?: string;
  mobileNextLabel?: string;
  mobilePaddingPx?: number;
  mobileRadiusPx?: number;
  mobileGapPx?: number;
  skipOnMobile?: boolean;
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

export const WALKTHROUGH_MOBILE_MEDIA_QUERY = '(max-width: 767px)';

export function isWalkthroughMobileViewport(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  try {
    return window.matchMedia(WALKTHROUGH_MOBILE_MEDIA_QUERY).matches;
  } catch {
    return false;
  }
}

/**
 * Returns the steps that should actually be presented for the current
 * viewport. Steps marked `skipOnMobile: true` are filtered out on mobile
 * so users don't get stranded on a target that isn't rendered on phones.
 *
 * The shape is preserved (we still return `WalkthroughStep[]`); the
 * step-level mobile field merging is performed by `resolveStepForViewport`
 * in the layer at render time so the underlying definitions stay readable.
 */
function visibleStepsForViewport(definition: WalkthroughDefinition, mobile: boolean): WalkthroughStep[] {
  if (!mobile) return definition.steps;
  return definition.steps.filter((s) => !s.skipOnMobile);
}

/**
 * Apply any `mobile*` overrides to a step when rendered on a mobile
 * viewport. Returns the step unchanged on desktop. The result is the
 * shape the rendering layer should consume — desktop callers can keep
 * reading the original fields without branching.
 */
export function resolveWalkthroughStepForViewport(step: WalkthroughStep, mobile: boolean): WalkthroughStep {
  if (!mobile) return step;
  return {
    ...step,
    selector: step.mobileSelector ?? step.selector,
    placement: step.mobilePlacement ?? step.placement,
    enterEvents: step.mobileEnterEvents ?? step.enterEvents,
    title: step.mobileTitle ?? step.title,
    description: step.mobileDescription ?? step.description,
    nextLabel: step.mobileNextLabel ?? step.nextLabel,
    paddingPx: step.mobilePaddingPx ?? step.paddingPx,
    radiusPx: step.mobileRadiusPx ?? step.radiusPx,
    gapPx: step.mobileGapPx ?? step.gapPx,
  };
}

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
  /**
   * Persist the same "completed" cookie the tour itself writes, but
   * without ever opening the overlay. Use when the user has explicitly
   * declined to start a tour (e.g. dismissing the auto-start prompt) so
   * we don't re-prompt on every page load.
   */
  markCompleted: (definition: WalkthroughDefinition) => void;
  /**
   * True when the platform has decided this user is in a region where
   * product tours are disabled (currently driven by the same `geo-blocked`
   * cookie used for deposit blocking). Surface this in any UI that exposes
   * tour controls so users understand why the option is hidden / disabled
   * rather than guessing.
   */
  isDisabledByRegion: boolean;
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

function normalizeStartAtAgainst(steps: WalkthroughStep[], startAt?: number | string): number {
  const total = steps.length;
  if (total <= 0) return 0;
  if (typeof startAt === 'number' && Number.isFinite(startAt)) {
    return Math.max(0, Math.min(total - 1, Math.floor(startAt)));
  }
  if (typeof startAt === 'string' && startAt.trim()) {
    const idx = steps.findIndex((s) => s.id === startAt);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

export function WalkthroughProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();

  // Geo-restricted users see the dedicated "Deposits restricted in your
  // region" modal as soon as they land. Auto-starting a walkthrough on top
  // of that produces stacked overlays where the spotlight darkens the
  // restriction modal and the tour bubble blocks its dismiss button.
  // Treating restriction as a hard "tours off" switch keeps the page
  // readable and avoids the overlap entirely.
  const { isRestricted: isDisabledByRegion } = useGeoRestriction();

  const [state, setState] = useState<WalkthroughState>({
    active: false,
    definition: null,
    index: 0,
  });

  // Mobile flag is reactive so the steps list (which can drop entries via
  // `skipOnMobile`) stays in sync if the viewport changes mid-tour.
  const [isMobile, setIsMobile] = useState<boolean>(() => isWalkthroughMobileViewport());
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(WALKTHROUGH_MOBILE_MEDIA_QUERY);
    const update = () => setIsMobile(mq.matches);
    update();
    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', update);
      return () => mq.removeEventListener('change', update);
    }
    // Safari < 14 fallback
    mq.addListener(update);
    return () => mq.removeListener(update);
  }, []);

  const lastPushedRouteRef = useRef<string | null>(null);

  const visibleSteps = useMemo<WalkthroughStep[]>(() => {
    if (!state.active || !state.definition) return [];
    return visibleStepsForViewport(state.definition, isMobile);
  }, [isMobile, state.active, state.definition]);

  const currentStep = useMemo(() => {
    if (!state.active || !state.definition) return null;
    return visibleSteps[state.index] || null;
  }, [state.active, state.definition, state.index, visibleSteps]);

  const progress = useMemo(() => {
    if (!state.active || !state.definition) return null;
    const total = visibleSteps.length;
    return { index: Math.max(0, state.index), total: Math.max(0, total) };
  }, [state.active, state.definition, state.index, visibleSteps]);

  const isCompleted = useCallback((walkthroughId: string, storageKeyOverride?: string) => {
    const key = storageKeyOverride || `dexextra:walkthrough:${walkthroughId}:completed`;
    return safeReadCompleted(key);
  }, []);

  const markCompleted = useCallback((definition: WalkthroughDefinition) => {
    safeWriteCompleted(resolveStorageKey(definition));
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

  // Keep a ref of the latest visible-steps list so the imperative callbacks
  // (`next`, `prev`, `goTo`, `start`) can clamp/look up against it without
  // having to be recreated on every step change.
  const visibleStepsRef = useRef<WalkthroughStep[]>(visibleSteps);
  useEffect(() => {
    visibleStepsRef.current = visibleSteps;
  }, [visibleSteps]);

  // `start()` reads the latest restriction flag through a ref so we don't
  // have to recreate the callback every time the cookie poll runs. A stale
  // closure here would let auto-start fire a tour during the same render
  // pass that the geo cookie flips on.
  const isDisabledByRegionRef = useRef<boolean>(isDisabledByRegion);
  useEffect(() => {
    isDisabledByRegionRef.current = isDisabledByRegion;
  }, [isDisabledByRegion]);

  const start = useCallback(
    (definition: WalkthroughDefinition, opts?: { startAt?: number | string; force?: boolean }) => {
      // Hard gate: never start a tour while the user is geo-restricted —
      // the restriction modal owns the screen and a tour overlay on top of
      // it stacks two competing modals.
      if (isDisabledByRegionRef.current) return;

      const storageKey = resolveStorageKey(definition);
      const completed = safeReadCompleted(storageKey);
      if (completed && !opts?.force) return;

      // Persist completion immediately when a tour starts so that closing it
      // mid-flight (X button → `stop()` without `markCompleted`) still
      // prevents the auto-start from showing it again on the next visit.
      // Manual restarts from FooterSupportPopup pass `force: true`, which
      // bypasses the cookie check above, so this doesn't lock out re-runs.
      safeWriteCompleted(storageKey);

      // Resolve the start index against the *visible* steps so a `startAt`
      // string id that targets a desktop-only step on mobile lands at 0
      // instead of throwing the user into the wrong step.
      const visible = visibleStepsForViewport(definition, isWalkthroughMobileViewport());
      const idx = normalizeStartAtAgainst(visible, opts?.startAt);
      setState({ active: true, definition, index: idx });
    },
    []
  );

  // If the user becomes geo-restricted mid-tour (cookie flips on after a
  // VPN drop or a fresh middleware decision), stop the active tour so the
  // restriction modal isn't fighting the walkthrough overlay for the
  // viewport. We don't mark completed because the user didn't actually
  // finish — they should see the tour again once they're back in a
  // supported region.
  useEffect(() => {
    if (isDisabledByRegion && state.active) {
      setState({ active: false, definition: null, index: 0 });
    }
  }, [isDisabledByRegion, state.active]);

  const next = useCallback(() => {
    setState((prev) => {
      if (!prev.active || !prev.definition) return prev;
      const total = visibleStepsRef.current.length;
      const nextIndex = prev.index + 1;
      if (nextIndex >= total) {
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
      const visible = visibleStepsRef.current;
      const total = visible.length;

      if (typeof indexOrId === 'number') {
        const idx = Math.max(0, Math.min(total - 1, Math.floor(indexOrId)));
        return { ...prev, index: idx };
      }

      const idx = visible.findIndex((s) => s.id === indexOrId);
      if (idx < 0) return prev;
      return { ...prev, index: idx };
    });
  }, []);

  // Route sync: if a step belongs to another route, push that route.
  useEffect(() => {
    if (!state.active || !state.definition) return;
    const step = visibleSteps[state.index];
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
  }, [pathname, router, state.active, state.definition, state.index, visibleSteps]);

  // If the viewport flips mid-tour and the new visible list is shorter,
  // clamp the active index so we don't end up past the end (which would
  // leave `currentStep` null and the tour stuck).
  useEffect(() => {
    if (!state.active) return;
    if (visibleSteps.length === 0) {
      setState({ active: false, definition: null, index: 0 });
      return;
    }
    if (state.index >= visibleSteps.length) {
      setState((prev) => ({ ...prev, index: visibleSteps.length - 1 }));
    }
  }, [state.active, state.index, visibleSteps]);

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
      markCompleted,
      isDisabledByRegion,
    }),
    [
      currentStep,
      goTo,
      isCompleted,
      isDisabledByRegion,
      markCompleted,
      next,
      prev,
      progress,
      start,
      state,
      stop,
    ]
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

