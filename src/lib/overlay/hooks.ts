'use client';

/**
 * Liquidity Overlay — React hooks over the client cache.
 *
 * These are the ergonomic entry points UI code uses to read overlay values.
 * They re-render on cache updates via `useSyncExternalStore`.
 */

import { useEffect, useSyncExternalStore } from 'react';
import { overlayCache } from './clientCache';
import { isOverlayEnabledClient } from './config';
import type { MarketOverlayPayload } from './types';

/** Whether the overlay is enabled on the client (stable within a render). */
export function useOverlayEnabled(): boolean {
  return isOverlayEnabledClient();
}

/** Full overlay payload for a symbol or market id (null if none/disabled). */
export function useOverlayEntry(key: string | null | undefined): MarketOverlayPayload | null {
  return useSyncExternalStore(
    overlayCache.subscribe,
    () => overlayCache.getEntry(key),
    () => null
  );
}

/** Overlay mark price for a symbol or market id (null if none/disabled). */
export function useOverlayMarkPrice(key: string | null | undefined): number | null {
  return useSyncExternalStore(
    overlayCache.subscribe,
    () => overlayCache.getMarkPrice(key),
    () => null
  );
}

/**
 * Returns the overlaid price if present, otherwise the real price. Also lazily
 * registers batch-interest in the symbol so list/portfolio surfaces get live
 * platform-wide prices with a single call site.
 */
export function useApplyOverlayPrice(
  key: string | null | undefined,
  realPrice: number
): number {
  useEffect(() => {
    if (key && isOverlayEnabledClient()) overlayCache.registerInterest(key);
  }, [key]);

  const overlayPrice = useSyncExternalStore(
    overlayCache.subscribe,
    () => overlayCache.getMarkPrice(key),
    () => null
  );

  if (!isOverlayEnabledClient()) return realPrice;
  return overlayPrice != null && overlayPrice > 0 ? overlayPrice : realPrice;
}

/** Register batch-interest in one or more symbols (for platform-wide surfaces). */
export function useRegisterOverlayInterest(symbols: Array<string | null | undefined>): void {
  const key = symbols.filter(Boolean).join('|').toUpperCase();
  useEffect(() => {
    if (!isOverlayEnabledClient()) return;
    for (const s of symbols) {
      if (s) overlayCache.registerInterest(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}
