'use client';

import { useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useWalkthrough } from '@/contexts/WalkthroughContext';
import { makeGetStartedWalkthrough } from '@/walkthroughs/getStarted';
import { tokenPageWalkthrough } from '@/walkthroughs/tokenPage';
import { useWallet } from '@/hooks/useWallet';

const HOME_TOUR_ID = 'home';
const TOKEN_TOUR_ID = 'token';

// Wait this long after a route lands before kicking off the auto-tour.
// The walkthrough layer itself polls for selectors for up to ~12s, so this
// just gives the page a beat to mount its primary content first.
const AUTO_START_DELAY_MS = 1200;

export default function WalkthroughAutoStart() {
  const pathname = usePathname();
  const walkthrough = useWalkthrough();
  const { walletData } = useWallet();

  // Keep a stable ref to the walkthrough context so the effect below can
  // re-read the latest `state.active` / `start` / `isCompleted` without
  // re-running every time the context value changes (which is once per
  // walkthrough step).
  const walkthroughRef = useRef(walkthrough);
  walkthroughRef.current = walkthrough;

  // Track which auto-tour we've already attempted in this session, so a
  // single user-driven dismissal (X button) doesn't immediately re-trigger
  // on the same path. The cookie persists across sessions; this ref guards
  // the in-memory case.
  const attemptedRef = useRef<Set<string>>(new Set());

  const isConnected = walletData.isConnected;
  const isDisabledByRegion = walkthrough.isDisabledByRegion;

  useEffect(() => {
    if (!pathname) return;
    if (typeof window === 'undefined') return;

    // Restricted regions get the geo-block modal on landing — skip the
    // tour timer entirely so we don't queue an overlay that races the
    // restriction modal. The provider would no-op `start()` anyway, but
    // bailing here also prevents the 1.2s timer from firing in the
    // background.
    if (isDisabledByRegion) return;

    const isHome = pathname === '/';
    const isTokenPage = pathname.startsWith('/token/') && pathname !== '/token';
    if (!isHome && !isTokenPage) return;

    const wt = walkthroughRef.current;

    // Don't interrupt an active walkthrough.
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

    const timer = window.setTimeout(() => {
      const latest = walkthroughRef.current;
      if (latest.state.active) return;
      if (latest.isDisabledByRegion) return;
      if (latest.isCompleted(definition.id, definition.storageKey)) return;
      latest.start(definition);
    }, AUTO_START_DELAY_MS);

    return () => window.clearTimeout(timer);
  }, [pathname, isConnected, isDisabledByRegion]);

  return null;
}
