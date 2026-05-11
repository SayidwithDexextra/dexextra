'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useWalkthrough, type WalkthroughDefinition } from '@/contexts/WalkthroughContext';
import { makeGetStartedWalkthrough } from '@/walkthroughs/getStarted';
import { tokenPageWalkthrough } from '@/walkthroughs/tokenPage';
import { useWallet } from '@/hooks/useWallet';
import WalkthroughStartPrompt from './WalkthroughStartPrompt';

const HOME_TOUR_ID = 'home';
const TOKEN_TOUR_ID = 'token';

// Wait this long after a route lands before showing the prompt.
// We just want the page to settle visually first so the prompt isn't the
// first thing the user sees mid-paint. The walkthrough layer's selector
// polling (12s) is independent of this delay.
const PROMPT_DELAY_MS = 1200;

type PendingTour = {
  /** Stable id used to match the in-session "already prompted" guard. */
  tourId: string;
  /** The tour definition to start when the user accepts. */
  definition: WalkthroughDefinition;
  /** Header copy for the prompt. */
  title: string;
  /** Body copy describing what the tour will cover. */
  description: string;
  /** Duration chip shown next to the "Product tour" label. */
  durationLabel?: string;
};

export default function WalkthroughAutoStart() {
  const pathname = usePathname();
  const walkthrough = useWalkthrough();
  const { walletData } = useWallet();

  // Keep a stable ref to the walkthrough context so the timer below can
  // re-read the latest `state.active` / `start` / `isCompleted` without
  // re-running every time the context value changes (which is once per
  // walkthrough step).
  const walkthroughRef = useRef(walkthrough);
  walkthroughRef.current = walkthrough;

  // Track which auto-tour we've already attempted in this session, so
  // dismissing the prompt doesn't immediately re-trigger on the same path
  // (the cookie persists across sessions; this ref guards the in-memory
  // case where the cookie write hasn't been read back yet).
  const attemptedRef = useRef<Set<string>>(new Set());

  const [pendingTour, setPendingTour] = useState<PendingTour | null>(null);

  const isConnected = walletData.isConnected;
  const isDisabledByRegion = walkthrough.isDisabledByRegion;

  // If the user becomes geo-restricted while the prompt is showing, hide
  // the prompt — the geo-block modal owns the screen at that point.
  useEffect(() => {
    if (isDisabledByRegion && pendingTour) {
      setPendingTour(null);
    }
  }, [isDisabledByRegion, pendingTour]);

  // Hide the prompt the moment a tour actually starts (e.g. the user
  // accepted, or another flow kicked off a tour) so the prompt doesn't
  // hover over the live overlay.
  useEffect(() => {
    if (walkthrough.state.active && pendingTour) {
      setPendingTour(null);
    }
  }, [walkthrough.state.active, pendingTour]);

  useEffect(() => {
    if (!pathname) return;
    if (typeof window === 'undefined') return;

    // Restricted regions get the geo-block modal on landing — skip the
    // tour timer entirely so we don't queue an overlay that races the
    // restriction modal.
    if (isDisabledByRegion) return;

    const isHome = pathname === '/';
    const isTokenPage = pathname.startsWith('/token/') && pathname !== '/token';
    if (!isHome && !isTokenPage) return;

    const wt = walkthroughRef.current;

    // Don't interrupt an active walkthrough or an already-pending prompt.
    if (wt.state.active) return;

    const tourId = isHome ? HOME_TOUR_ID : TOKEN_TOUR_ID;
    if (attemptedRef.current.has(tourId)) return;

    const definition = isHome
      ? makeGetStartedWalkthrough({ includeWalletConnectSteps: !isConnected })
      : tokenPageWalkthrough;

    if (wt.isCompleted(definition.id, definition.storageKey)) {
      attemptedRef.current.add(tourId);
      return;
    }

    attemptedRef.current.add(tourId);

    const promptCopy: Omit<PendingTour, 'tourId' | 'definition'> = isHome
      ? {
          title: 'New here? Take a quick tour.',
          description:
            "We'll walk you through search, your portfolio, the watchlist, and how to spin up a new market.",
          durationLabel: '~60 sec',
        }
      : {
          title: 'First time on a market page?',
          description:
            "We'll show you the chart, market activity, the trading panel, and where the metric value comes from.",
          durationLabel: '~45 sec',
        };

    const timer = window.setTimeout(() => {
      const latest = walkthroughRef.current;
      if (latest.state.active) return;
      if (latest.isDisabledByRegion) return;
      if (latest.isCompleted(definition.id, definition.storageKey)) return;
      setPendingTour({ tourId, definition, ...promptCopy });
    }, PROMPT_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, isConnected, isDisabledByRegion]);

  const handleAccept = useCallback(() => {
    if (!pendingTour) return;
    const wt = walkthroughRef.current;
    setPendingTour(null);
    // `force: true` because the user explicitly opted in — we want the
    // tour to run even if `start()`'s default completion-check would
    // bail (it shouldn't here, since we already cookie-checked above,
    // but `force` keeps this safe against future cookie changes).
    wt.start(pendingTour.definition, { force: true });
  }, [pendingTour]);

  const handleDismiss = useCallback(() => {
    if (!pendingTour) return;
    const wt = walkthroughRef.current;
    // Persist the dismissal the same way completing a tour would —
    // otherwise the prompt would pop up again on every page load and
    // become exactly the kind of "thrown into it" UX the user wanted
    // to fix. Manual restarts from the Footer Support menu still work
    // because they pass `force: true` to `start()`.
    wt.markCompleted(pendingTour.definition);
    setPendingTour(null);
  }, [pendingTour]);

  const promptElement = useMemo(() => {
    if (!pendingTour) return null;
    return (
      <WalkthroughStartPrompt
        title={pendingTour.title}
        description={pendingTour.description}
        durationLabel={pendingTour.durationLabel}
        onAccept={handleAccept}
        onDismiss={handleDismiss}
      />
    );
  }, [handleAccept, handleDismiss, pendingTour]);

  return promptElement;
}
