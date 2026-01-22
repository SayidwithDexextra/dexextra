// src/lib/tradingview/marketUuidDatafeed.ts
// Client-side TradingView datafeed wrapper:
// - Delegates historical + symbol resolution to UDFCompatibleDatafeed (/api/tradingview/*)
// - Overrides subscribeBars to stream realtime 1m candles via Pusher and roll them up to any resolution
//
// NOTE: This module is intended to run in the browser ("use client" components).

import type { ChartDataEvent } from '@/lib/pusher-server';
import { PusherClientService } from '@/lib/pusher-client';

type TvResolution = string; // e.g. '1', '5', '60', '1D', '1W', '1M'

type TvBar = {
  time: number; // ms epoch
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

type TvSymbolInfo = {
  ticker: string;
  name: string;
  description?: string;
  // ... charting library provides many more fields; we only use ticker
};

type SubscribeBarsFn = (
  symbolInfo: TvSymbolInfo,
  resolution: TvResolution,
  onRealtimeCallback: (bar: TvBar) => void,
  subscriberUID: string,
  onResetCacheNeededCallback: () => void
) => void;

type UnsubscribeBarsFn = (subscriberUID: string) => void;

type UdfCompatibleDatafeed = {
  onReady: (cb: (conf: any) => void) => void;
  searchSymbols: (...args: any[]) => void;
  resolveSymbol: (...args: any[]) => void;
  getBars: (...args: any[]) => void;
  subscribeBars?: SubscribeBarsFn;
  unsubscribeBars?: UnsubscribeBarsFn;
  getServerTime?: (cb: (time: number) => void) => void;
};

// Singleton Pusher client (avoid reconnecting per widget recreation)
let pusherSingleton: PusherClientService | null = null;
function getPusher(): PusherClientService | null {
  if (pusherSingleton) return pusherSingleton;
  try {
    pusherSingleton = new PusherClientService();
    return pusherSingleton;
  } catch (e) {
    // If Pusher isn't configured, disable realtime rather than crashing the chart.
    // eslint-disable-next-line no-console
    console.warn('[TradingViewDatafeed] Pusher disabled:', (e as any)?.message || String(e));
    return null;
  }
}

function toMs(ts: number): number {
  // Accept seconds or ms
  return ts > 1e12 ? ts : ts * 1000;
}

function startOfUtcDay(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0);
}

function startOfUtcWeekMonday(ms: number): number {
  // ISO week start (Mon 00:00 UTC)
  const d = new Date(ms);
  const day = d.getUTCDay(); // 0..6, Sun=0
  const deltaToMonday = (day + 6) % 7; // Mon=0, Tue=1,... Sun=6
  const dayStart = startOfUtcDay(ms);
  return dayStart - deltaToMonday * 24 * 60 * 60 * 1000;
}

function startOfUtcMonth(ms: number): number {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1, 0, 0, 0, 0);
}

function bucketStartMsForResolution(resolution: TvResolution, ms: number): number {
  // Intraday resolutions are in minutes as strings.
  if (/^\d+$/.test(resolution)) {
    const minutes = parseInt(resolution, 10);
    const intervalMs = Math.max(1, minutes) * 60 * 1000;
    return Math.floor(ms / intervalMs) * intervalMs;
  }
  const r = resolution.toUpperCase();
  if (r === '1D' || r === 'D') return startOfUtcDay(ms);
  if (r === '1W' || r === 'W') return startOfUtcWeekMonday(ms);
  if (r === '1M' || r === 'M') return startOfUtcMonth(ms);
  // Fallback: treat as 1m
  return Math.floor(ms / 60000) * 60000;
}

function mergeBar(prev: TvBar | null, incoming: TvBar): TvBar {
  if (!prev) return incoming;
  if (incoming.time > prev.time) return incoming;
  if (incoming.time < prev.time) return prev;
  // Same bucket: rollup update (NOTE: assumes `incoming.volume` is incremental).
  return {
    time: prev.time,
    open: prev.open,
    high: Math.max(prev.high, incoming.high),
    low: Math.min(prev.low, incoming.low),
    close: incoming.close,
    volume: prev.volume + incoming.volume,
  };
}

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

export function createMarketUuidDatafeed(udf: UdfCompatibleDatafeed): UdfCompatibleDatafeed {
  // IMPORTANT:
  // TradingView's UDFCompatibleDatafeed is a class instance with prototype methods.
  // Do NOT spread it into a new object (that drops prototype methods and breaks the widget).
  const udfAny: any = udf as any;

  // subscriberUID -> unsubscribe + lastBar cache
  const subs = new Map<
    string,
    {
      unsubscribe: () => void;
      lastBar: TvBar | null;
      resolution: TvResolution;
      ticker: string;
      // Track 1m bars inside the current requested-resolution bucket to avoid double-counting
      minuteBars: Map<number, TvBar>;
      currentBucketMs: number | null;
    }
  >();

  // Dev-only helper: optionally seed OHLCV + scatter for empty markets so debugging is possible
  // on charts like /token/BITCOIN without needing a configured upstream feed.
  const devSeeded = new Set<string>(); // marketUuid
  function devSeedEnabled(): boolean {
    try {
      if (typeof window === 'undefined') return false;
      // Opt-in toggles:
      // - URL: ?tvSeed=1
      // - localStorage: tvSeed=1
      // - global: window.TV_SEED = true
      const qs = new URLSearchParams(window.location.search);
      if (qs.get('tvSeed') === '1') return true;
      if ((window as any).TV_SEED === true) return true;
      try {
        if (window.localStorage?.getItem('tvSeed') === '1') return true;
      } catch {}
      return false;
    } catch {
      return false;
    }
  }

  const originalGetBars = typeof udfAny.getBars === 'function' ? udfAny.getBars.bind(udfAny) : null;
  if (originalGetBars) {
    udfAny.getBars = async (
      symbolInfo: TvSymbolInfo,
      resolution: TvResolution,
      periodParams: any,
      onHistoryCallback: (bars: any[], meta?: any) => void,
      onErrorCallback: (error: any) => void
    ) => {
      const ticker = String((symbolInfo as any)?.ticker || '');
      const customMarketId = (symbolInfo as any)?.custom?.market_id
        ? String((symbolInfo as any).custom.market_id)
        : '';
      const marketUuid = looksLikeUuid(ticker) ? ticker : (looksLikeUuid(customMarketId) ? customMarketId : '');

      const first = Boolean(periodParams?.firstDataRequest);
      if (first && marketUuid && devSeedEnabled() && !devSeeded.has(marketUuid)) {
        devSeeded.add(marketUuid);
        try {
          const from = periodParams?.from;
          const to = periodParams?.to;
          const countback = periodParams?.countBack ?? periodParams?.countback;

          // Seed OHLCV via history endpoint (debugSeed=1 inserts synthetic ticks + returns ok once MV catches up).
          const historyUrl =
            `/api/tradingview/history?symbol=${encodeURIComponent(marketUuid)}` +
            `&resolution=${encodeURIComponent(String(resolution))}` +
            `&from=${encodeURIComponent(String(from ?? ''))}` +
            `&to=${encodeURIComponent(String(to ?? ''))}` +
            (countback ? `&countback=${encodeURIComponent(String(countback))}` : '') +
            `&debugSeed=1`;

          // Seed metric series used by the TradingView metric overlay.
          // Keep this aligned with `src/lib/tradingview/metricIndicator.ts` which reads `/api/charts/metric`.
          const metricNameSeedRaw = String(
            (symbolInfo as any)?.custom?.metric_id || (symbolInfo as any)?.name || (symbolInfo as any)?.ticker || ''
          ).trim();
          const metricNameSeed = metricNameSeedRaw ? metricNameSeedRaw.toUpperCase() : 'BITCOIN';
          const metricUrl =
            `/api/charts/metric?marketId=${encodeURIComponent(marketUuid)}` +
            `&metricName=${encodeURIComponent(metricNameSeed)}` +
            `&timeframe=5m&agg=last&limit=500&sma=20&metricDebug=1`;

          // eslint-disable-next-line no-console
          console.warn('[TradingViewDatafeed] Dev seed enabled; seeding BTC candles+metric', {
            marketUuid,
            resolution,
          });

          await Promise.allSettled([fetch(historyUrl, { cache: 'no-store' }), fetch(metricUrl, { cache: 'no-store' })]);
        } catch (e) {
          // eslint-disable-next-line no-console
          console.warn('[TradingViewDatafeed] Dev seed failed:', (e as any)?.message || String(e));
        }
      }

      return originalGetBars(symbolInfo, resolution, periodParams, onHistoryCallback, onErrorCallback);
    };
  }

  const subscribeBars: SubscribeBarsFn = (symbolInfo, resolution, onRealtimeCallback, subscriberUID) => {
    const ticker = String(symbolInfo?.ticker || '');
    // Prefer canonical UUID in `ticker` (we return this from /api/tradingview/symbols).
    // Fall back to custom.market_id if present; then to whatever ticker is.
    const customMarketId = (symbolInfo as any)?.custom?.market_id
      ? String((symbolInfo as any).custom.market_id)
      : '';
    const idForRealtime = looksLikeUuid(ticker) ? ticker : (customMarketId || ticker);
    if (!idForRealtime) return;

    // Always subscribe to 1m channel and roll up to requested resolution.
    const pusher = getPusher();
    if (!pusher) return;

    // Optional debug: set `window.PUSHER_DBG = true` to see subscription + payloads.
    try {
      if (typeof window !== 'undefined' && (window as any).PUSHER_DBG) {
        // eslint-disable-next-line no-console
        console.log('[TradingViewDatafeed] subscribeBars', { ticker, customMarketId, idForRealtime, resolution, subscriberUID });
      }
    } catch {}

    // Robust realtime routing:
    // - Prefer UUID channel (canonical)
    // - Also subscribe to human symbol channel as a fallback (some server paths may still broadcast by symbol)
    const humanCandidateRaw =
      String((symbolInfo as any)?.custom?.metric_id || symbolInfo?.name || '').trim();
    const humanCandidate = humanCandidateRaw ? humanCandidateRaw.toUpperCase() : '';

    const realtimeKeys = new Set<string>();
    realtimeKeys.add(idForRealtime);
    if (humanCandidate && !looksLikeUuid(humanCandidate) && humanCandidate !== idForRealtime) {
      realtimeKeys.add(humanCandidate);
    }

    const onEvt = (evt: ChartDataEvent) => {
      const tsMs = toMs(Number((evt as any).timestamp || Date.now()));
      const minuteMs = bucketStartMsForResolution('1', tsMs);
      const bucketMs = bucketStartMsForResolution(resolution, tsMs);

      const incoming1m: TvBar = {
        time: minuteMs,
        open: Number(evt.open),
        high: Number(evt.high),
        low: Number(evt.low),
        close: Number(evt.close),
        volume: Number(evt.volume),
      };

      const entry = subs.get(subscriberUID);
      if (!entry) return;

      try {
        if (typeof window !== 'undefined' && (window as any).PUSHER_DBG) {
          // eslint-disable-next-line no-console
          console.log('[TradingViewDatafeed] chart-update', { idForRealtime, resolution, minuteMs, bucketMs, evt });
        }
      } catch {}

      // 1) If the chart is on 1m, treat incoming as a snapshot for that minute.
      // This avoids volume double-counting when we receive multiple updates for the same minute.
      if (/^1$/.test(String(resolution))) {
        entry.lastBar = incoming1m;
        onRealtimeCallback(entry.lastBar);
        return;
      }

      // 2) Higher resolutions: aggregate from the latest snapshot per-minute within the current bucket.
      if (entry.currentBucketMs !== bucketMs) {
        entry.currentBucketMs = bucketMs;
        entry.minuteBars.clear();
      }

      entry.minuteBars.set(minuteMs, incoming1m);

      // Compute aggregate bar from all minutes we have for this bucket.
      const minutes = Array.from(entry.minuteBars.keys()).sort((a, b) => a - b);
      if (minutes.length === 0) return;
      const first = entry.minuteBars.get(minutes[0])!;
      const last = entry.minuteBars.get(minutes[minutes.length - 1])!;
      let high = -Infinity;
      let low = Infinity;
      let volume = 0;
      for (const k of minutes) {
        const b = entry.minuteBars.get(k)!;
        if (b.high > high) high = b.high;
        if (b.low < low) low = b.low;
        volume += b.volume;
      }

      const aggregated: TvBar = {
        time: bucketMs,
        open: first.open,
        high,
        low,
        close: last.close,
        volume,
      };

      entry.lastBar = aggregated;
      onRealtimeCallback(entry.lastBar);
    };

    const unsubscribers: Array<() => void> = [];
    for (const key of realtimeKeys) {
      unsubscribers.push(pusher.subscribeToChartData(key, '1m', onEvt));
    }
    const unsubscribe = () => {
      for (const fn of unsubscribers) fn();
    };

    subs.set(subscriberUID, {
      unsubscribe,
      lastBar: null,
      resolution,
      ticker: idForRealtime,
      minuteBars: new Map(),
      currentBucketMs: null,
    });
  };

  const unsubscribeBars: UnsubscribeBarsFn = (subscriberUID) => {
    const entry = subs.get(subscriberUID);
    if (!entry) return;
    entry.unsubscribe();
    subs.delete(subscriberUID);
  };

  udfAny.subscribeBars = subscribeBars;
  udfAny.unsubscribeBars = unsubscribeBars;
  return udfAny as UdfCompatibleDatafeed;
}


