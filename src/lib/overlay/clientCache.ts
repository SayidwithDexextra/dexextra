'use client';

/**
 * Liquidity Overlay — client cache + distribution.
 *
 * A tiny singleton that holds the latest overlay values on the client and
 * distributes them to (a) React components via hooks and (b) non-React code
 * (e.g. P&L math in usePositions) via synchronous getters. This keeps the
 * overlay's platform-wide reach possible with one-line edits at each consumer
 * instead of threading a context everywhere.
 *
 * Two data paths feed the cache:
 *   1. `useMarketOverlay(symbol)` pushes a full per-market payload (book+tape).
 *   2. A batch poller fetches mark prices for all "registered" symbols so
 *      list/portfolio surfaces get the overlaid price cheaply.
 *
 * Entries are stored under BOTH the uppercase symbol and the market uuid, so
 * lookups work whether the caller has a symbol or a market id.
 */

import { isOverlayEnabledClient, OVERLAY_CONFIG } from './config';
import type { MarketOverlayPayload } from './types';

type Listener = () => void;

class OverlayClientCache {
  /** key (UPPER symbol OR market uuid) -> latest payload */
  private entries = new Map<string, MarketOverlayPayload>();
  private listeners = new Set<Listener>();
  /** symbols we want batch mark-price updates for */
  private interest = new Set<string>();
  private batchTimer: ReturnType<typeof setInterval> | null = null;
  private version = 0;

  // --- subscription (for useSyncExternalStore) ---
  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getVersion = (): number => this.version;

  private emit() {
    this.version += 1;
    this.listeners.forEach((l) => {
      try {
        l();
      } catch {
        /* ignore listener errors */
      }
    });
  }

  private keyFor(k: string | null | undefined): string {
    return String(k || '').toUpperCase();
  }

  // --- reads ---
  getEntry(key: string | null | undefined): MarketOverlayPayload | null {
    const e = this.entries.get(this.keyFor(key));
    return e && e.enabled ? e : null;
  }

  getMarkPrice(key: string | null | undefined): number | null {
    const e = this.getEntry(key);
    return e && typeof e.markPrice === 'number' ? e.markPrice : null;
  }

  /** Overlay price if enabled + present, else the provided real price. */
  applyPrice(key: string | null | undefined, realPrice: number): number {
    if (!isOverlayEnabledClient()) return realPrice;
    const p = this.getMarkPrice(key);
    return p != null && p > 0 ? p : realPrice;
  }

  // --- writes ---
  setPayload(payload: MarketOverlayPayload) {
    if (!payload) return;
    const symKey = this.keyFor(payload.symbol);
    let changed = false;

    const prev = this.entries.get(symKey);
    if (!prev || prev.updatedAt !== payload.updatedAt || prev.markPrice !== payload.markPrice) {
      this.entries.set(symKey, payload);
      changed = true;
    }
    if (payload.marketId) {
      const idKey = this.keyFor(payload.marketId);
      const prevId = this.entries.get(idKey);
      if (!prevId || prevId.updatedAt !== payload.updatedAt || prevId.markPrice !== payload.markPrice) {
        this.entries.set(idKey, payload);
        changed = true;
      }
    }
    if (changed) this.emit();
  }

  /** Merge a batch of {symbol: markPrice} without disturbing full payloads. */
  setMarkPrices(prices: Record<string, number>) {
    let changed = false;
    for (const [sym, price] of Object.entries(prices || {})) {
      if (!Number.isFinite(price) || price <= 0) continue;
      const key = this.keyFor(sym);
      const prev = this.entries.get(key);
      if (prev && prev.markPrice === price) continue;
      const merged: MarketOverlayPayload = prev
        ? { ...prev, markPrice: price, enabled: true, updatedAt: Date.now() }
        : {
            enabled: true,
            symbol: key,
            marketId: null,
            markPrice: price,
            basePrice: null,
            bids: [],
            asks: [],
            trades: [],
            updatedAt: Date.now(),
          };
      this.entries.set(key, merged);
      changed = true;
    }
    if (changed) this.emit();
  }

  // --- batch interest / polling ---
  registerInterest(symbol: string | null | undefined) {
    const sym = this.keyFor(symbol);
    if (!sym) return;
    if (!this.interest.has(sym)) {
      this.interest.add(sym);
      // Kick a fetch soon so the new symbol resolves quickly.
      this.fetchBatch();
    }
    this.ensureBatchPoller();
  }

  unregisterInterest(symbol: string | null | undefined) {
    this.interest.delete(this.keyFor(symbol));
  }

  private ensureBatchPoller() {
    if (this.batchTimer || typeof window === 'undefined') return;
    if (!isOverlayEnabledClient()) return;
    this.batchTimer = setInterval(() => this.fetchBatch(), OVERLAY_CONFIG.clientBatchPollMs);
  }

  private async fetchBatch() {
    if (typeof window === 'undefined' || !isOverlayEnabledClient()) return;
    const symbols = [...this.interest];
    if (!symbols.length) return;
    try {
      const res = await fetch(`/api/overlay?symbols=${encodeURIComponent(symbols.join(','))}`);
      const json = await res.json();
      if (json?.enabled && json?.prices) {
        this.setMarkPrices(json.prices);
      }
    } catch {
      /* transient network error — try again next interval */
    }
  }
}

export const overlayCache = new OverlayClientCache();

// Expose for debugging / manual toggling in the browser console.
if (typeof window !== 'undefined') {
  (window as any).__overlayCache = overlayCache;
}
