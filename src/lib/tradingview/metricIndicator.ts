// src/lib/tradingview/metricIndicator.ts
// Custom TradingView indicator that displays metric data from ClickHouse as a line overlay
//
// This pulls the same scatter point data used by ScatterPlotChart and renders it
// as a smooth line (moving average style) on the TradingView chart.

export interface MetricIndicatorConfig {
  // The market UUID to fetch metric data for
  marketId: string;
  // The ClickHouse metric name (recommended: stable string used by writers)
  // If omitted, we fall back to `displayName`.
  metricName?: string;
  // Timeframe for the metric data (1m, 5m, 15m, 30m, 1h, 4h, 1d)
  timeframe?: string;
  // Line color (CSS color string)
  lineColor?: string;
  // Line width in pixels
  lineWidth?: number;
  // SMA smoothing length (number of metric points)
  smaLength?: number;
  // DEBUG: force the indicator to output a constant value (useful for scaling tests)
  metricConst?: number;
  // Display name for the indicator
  displayName?: string;
}

// Cache for metric data to avoid refetching on every bar
const metricDataCache = new Map<string, { data: Array<{ ts: number; y: number }>; fetchedAt: number }>();
const CACHE_TTL_MS = 30_000; // 30 seconds

/**
 * TradingView Charting Library doesn't always auto-recalculate a custom study after async init work.
 * If `main()` returned NaN during initial calculations (because data wasn't loaded yet),
 * the plot can remain blank until the next chart update (which might be minutes on higher TFs).
 *
 * These method names vary across Charting Library builds; we try a few safely.
 */
function requestStudyUpdate(context: any): void {
  try {
    if (!context) return;
    if (typeof context.requestUpdate === 'function') {
      context.requestUpdate();
      return;
    }
    if (typeof context.update === 'function') {
      context.update();
      return;
    }
    if (typeof context.recalculate === 'function') {
      context.recalculate();
      return;
    }
    if (typeof context.recalc === 'function') {
      context.recalc();
      return;
    }
  } catch {
    // noop
  }
}

function kickParentChartOnce(): void {
  try {
    if (typeof window === 'undefined') return;

    const invoke = (w: any) => {
      try {
        const fn = w?.__DEXEXTRA_TV_METRIC_OVERLAY_KICK__;
        if (typeof fn === 'function') fn();
      } catch {
        // noop
      }
    };

    // Prefer parent/top (the app page), fall back to local window (just in case).
    try {
      const parent = (window as any).parent;
      if (parent && parent !== window) invoke(parent);
    } catch {}

    try {
      const top = (window as any).top;
      if (top && top !== window) invoke(top);
    } catch {}

    invoke(window as any);
  } catch {
    // noop
  }
}

function getSearchParams(): URLSearchParams {
  // TradingView runs the chart inside a same-origin iframe (`/charting_library/sameorigin.html`).
  // In that frame, `window.location.search` often does NOT include the app page’s query string.
  // Prefer parent/top when accessible; fall back to document.referrer.
  try {
    if (typeof window === 'undefined') return new URLSearchParams();

    const tryParse = (search: string | undefined | null) => {
      try {
        const p = new URLSearchParams(search || '');
        return p;
      } catch {
        return new URLSearchParams();
      }
    };

    const local = tryParse(window.location?.search);
    if (local.size > 0) return local;

    try {
      const parent = (window as any).parent;
      if (parent && parent !== window) {
        const p = tryParse(parent.location?.search);
        if (p.size > 0) return p;
      }
    } catch {}

    try {
      const top = (window as any).top;
      if (top && top !== window) {
        const t = tryParse(top.location?.search);
        if (t.size > 0) return t;
      }
    } catch {}

    try {
      const ref = String(document?.referrer || '').trim();
      if (ref) {
        const u = new URL(ref, window.location?.origin || undefined);
        const r = tryParse(u.search);
        if (r.size > 0) return r;
      }
    } catch {}

    return local;
  } catch {
    return new URLSearchParams();
  }
}

function devSeedRequested(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const qs = getSearchParams();
    // Align with the datafeed’s opt-in, but also allow explicitly requesting metric seeding.
    if (qs.get('tvSeed') === '1') return true;
    if (qs.get('metricDebug') === '1') return true;
    if ((window as any).TV_SEED === true) return true;
    try {
      if (window.localStorage?.getItem('tvSeed') === '1') return true;
      if (window.localStorage?.getItem('metricDebug') === '1') return true;
    } catch {}
    return false;
  } catch {
    return false;
  }
}

/**
 * Fetch metric scatter data from ClickHouse API
 */
async function fetchMetricData(
  params: { marketId: string; metricName: string; timeframe: string; smaLength: number }
): Promise<Array<{ ts: number; y: number }>> {
  const { marketId, metricName, timeframe, smaLength } = params;
  const cacheKey = `${marketId}:${metricName}:${timeframe}:sma=${smaLength}`;
  const cached = metricDataCache.get(cacheKey);
  
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.data;
  }

  try {
    const baseUrl =
      `/api/charts/metric?marketId=${encodeURIComponent(marketId)}` +
      `&metricName=${encodeURIComponent(metricName)}` +
      `&timeframe=${encodeURIComponent(timeframe)}` +
      `&agg=last` +
      `&limit=2000` +
      (smaLength > 0 ? `&sma=${encodeURIComponent(String(smaLength))}` : ``);

    // 1) Fetch metric series (+ optional server-side SMA)
    const res1 = await fetch(baseUrl, { cache: 'no-store' });
    if (!res1.ok) {
      console.warn(`[MetricIndicator] Failed to fetch metric data: ${res1.status}`);
      return cached?.data || [];
    }

    const body1 = await res1.json();
    const rows1 = Array.isArray(body1?.data) ? body1.data : [];
    const metaCount1 = Number(body1?.meta?.count ?? rows1.length ?? 0);
    // NOTE: Some TradingView builds stringify console args oddly; log as a single string for readability.
    // eslint-disable-next-line no-console
    {
      const msg = `[MetricIndicator] /api/charts/metric meta.count ${JSON.stringify({
        marketId,
        metricName,
        timeframe,
        smaLength,
        count: Number.isFinite(metaCount1) ? metaCount1 : rows1.length,
        source: body1?.meta?.source ?? null,
        metricDebug: body1?.meta?.metricDebug ?? 0,
      })}`;
      // In dev/debug sessions, prefer debug (avoid Next.js dev overlay, which treats console.error as an "error").
      if (devSeedRequested()) console.debug(msg);
      else console.warn(msg);
    }

    // 2) If empty and we're in a dev-seed session, auto-trigger seeding on the metric endpoint and re-fetch.
    // This keeps BTC debugging ergonomic: the first time the indicator runs, it can bootstrap its own data.
    let rows = rows1;
    if ((rows1.length === 0 || metaCount1 === 0) && devSeedRequested()) {
      try {
        const seedUrl = `${baseUrl}&metricDebug=1`;
        const res2 = await fetch(seedUrl, { cache: 'no-store' });
        if (res2.ok) {
          const body2 = await res2.json();
          const rows2 = Array.isArray(body2?.data) ? body2.data : [];
          const metaCount2 = Number(body2?.meta?.count ?? rows2.length ?? 0);
          console.warn(
            `[MetricIndicator] /api/charts/metric meta.count (after seed) ${JSON.stringify({
              marketId,
              metricName,
              timeframe,
              smaLength,
              count: Number.isFinite(metaCount2) ? metaCount2 : rows2.length,
              source: body2?.meta?.source ?? null,
              metricDebug: body2?.meta?.metricDebug ?? 1,
              seeded: 1,
            })}`
          );
          rows = rows2;
        } else {
          console.warn(`[MetricIndicator] Seed fetch failed: ${res2.status}`);
        }
      } catch (e) {
        console.warn('[MetricIndicator] Seed fetch threw:', e);
      }
    }
    
    const data = rows
      .map((r: any) => {
        const ts = parseTimestamp(r?.ts);
        // Prefer server-side plotted value (`y`), then SMA, then raw value.
        const y = Number(r?.y ?? r?.sma ?? r?.v ?? 0);
        return { ts, y };
      })
      .filter((p: { ts: number; y: number }) => Number.isFinite(p.ts) && Number.isFinite(p.y))
      .sort((a: { ts: number }, b: { ts: number }) => a.ts - b.ts);

    if (data.length > 0) {
      const msg = `[MetricIndicator] loaded metric points ${JSON.stringify({
        cacheKey,
        n: data.length,
        yMin: Math.min(...data.map((p: { y: number }) => p.y)),
        yMax: Math.max(...data.map((p: { y: number }) => p.y)),
        first: data[0],
        last: data[data.length - 1],
      })}`;
      // Avoid console.error here; it triggers a noisy dev overlay in Next.js.
      if (devSeedRequested()) console.debug(msg);
      else console.warn(msg);
    }

    metricDataCache.set(cacheKey, { data, fetchedAt: Date.now() });
    return data;
  } catch (err) {
    console.error('[MetricIndicator] Error fetching metric data:', err);
    return cached?.data || [];
  }
}

function parseTimestamp(input: string | number | Date | undefined): number {
  try {
    if (typeof input === 'number') return input > 1e12 ? input : input * 1000;
    if (input instanceof Date) return input.getTime();
    const s = String(input || '').trim();
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isFinite(ms) ? ms : 0;
  } catch {
    return 0;
  }
}

/**
 * Find the metric value for a given bar time using binary search + interpolation
 */
function getMetricValueForTime(
  data: Array<{ ts: number; y: number }>,
  barTimeMs: number
): number | null {
  if (!data || data.length === 0) return null;

  // Binary search for the closest point
  let left = 0;
  let right = data.length - 1;

  // If bar time is before all data, return null
  if (barTimeMs < data[0].ts) return null;
  
  // If bar time is after all data, return the last value
  if (barTimeMs >= data[right].ts) return data[right].y;

  // Binary search
  while (left < right) {
    const mid = Math.floor((left + right) / 2);
    if (data[mid].ts <= barTimeMs && (mid === data.length - 1 || data[mid + 1].ts > barTimeMs)) {
      left = mid;
      break;
    }
    if (data[mid].ts < barTimeMs) {
      left = mid + 1;
    } else {
      right = mid;
    }
  }

  // Prefer linear interpolation between adjacent points so the line looks like an MA
  // (rather than a step function) when chart resolution < metric timeframe.
  const i = left;
  const a = data[i];
  const b = data[i + 1];
  if (!b) return a.y;
  const dt = b.ts - a.ts;
  if (!Number.isFinite(dt) || dt <= 0) return a.y;
  const t = (barTimeMs - a.ts) / dt;
  const y = a.y + (b.y - a.y) * Math.max(0, Math.min(1, t));
  return Number.isFinite(y) ? y : a.y;
}

/**
 * Compute a simple moving average (SMA) of the metric series at a given bar time.
 * We average the last N metric points up to the current bar time.
 */
function getSmaMetricValueForTime(
  data: Array<{ ts: number; y: number }>,
  barTimeMs: number,
  length: number,
  stepMs: number
): number | null {
  // NOTE:
  // We intentionally compute SMA over *sampled* values (using interpolation) rather than
  // averaging the last N raw metric points. That makes the line move smoothly on
  // higher-resolution charts (like a typical SMA overlay).
  if (!data || data.length === 0) return null;
  const n = Math.max(1, Math.floor(Number(length) || 1));

  // Best-effort step: sample once per metric timeframe bucket.
  // Even if the chart is 1m and the metric timeframe is 5m, sampling points
  // shift by 1m each bar, and interpolation yields a smooth SMA curve.
  const step = Number.isFinite(stepMs) && stepMs > 0 ? stepMs : 60_000;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const t = barTimeMs - i * step;
    const v = getMetricValueForTime(data, t);
    if (v === null || !Number.isFinite(v)) continue;
    sum += v;
    count++;
  }
  if (count === 0) return null;
  const avg = sum / count;
  return Number.isFinite(avg) ? avg : null;
}

function timeframeToMs(tf: string): number {
  const s = String(tf || '').trim().toLowerCase();
  const m = s.match(/^(\d+)\s*(m|h|d|w|mo)$/);
  if (!m) return 5 * 60_000;
  const n = Math.max(1, Math.min(10_000, parseInt(m[1], 10)));
  const unit = m[2];
  switch (unit) {
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 60 * 60_000;
    case 'd':
      return n * 24 * 60 * 60_000;
    case 'w':
      return n * 7 * 24 * 60 * 60_000;
    case 'mo':
      return n * 30 * 24 * 60 * 60_000;
    default:
      return 5 * 60_000;
  }
}

/**
 * Normalize a display name into a valid TradingView study ID slug
 * TradingView lowercases study names when looking them up
 */
function normalizeStudySlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Creates the custom indicator definition for TradingView's custom_indicators_getter
 */
export function createMetricIndicatorDefinition(config: MetricIndicatorConfig) {
  const {
    marketId,
    metricName: metricNameProp,
    timeframe = '5m',
    // Coordinated with Dexextra candle colors + dark pane background.
    lineColor = '#A78BFA',
    lineWidth = 1,
    smaLength = 20,
    metricConst,
    displayName = 'Metric Value',
  } = config;
  const metricName = metricNameProp || displayName;

  // Create a normalized slug for the study ID that matches TradingView's lookup
  const studySlug = normalizeStudySlug(displayName);
  const studyName = `MetricOverlay_${studySlug}`;
  const studyId = `${studyName}@tv-basicstudies-1`;

  return {
    name: studyName,
    metainfo: {
      _metainfoVersion: 52,
      id: studyId,
      name: studyName,
      // IMPORTANT:
      // TradingView's `createStudy(<x>)` resolves studies by matching `<x>` against `metainfo.description`
      // (case-insensitive). If this doesn't match, the library throws "unexpected study id:<x>".
      // So we set `description` to the exact string we pass to `createStudy(...)` (i.e., `studyName`).
      description: studyName,
      // Display label in the chart legend (user-facing)
      shortDescription: `Live Metric Tracker (${smaLength}) ${displayName}`,
      format: {
        type: 'price',
        // Keep higher precision so SMA lines don't look "flat" for small deltas
        precision: 6,
      },
      is_hidden_study: false,
      is_price_study: true, // Overlay on main chart
      linkedToSeries: true,
      plots: [
        {
          id: 'plot_0',
          type: 'line',
        },
      ],
      defaults: {
        styles: {
          plot_0: {
            linestyle: 0,
            linewidth: lineWidth,
            plottype: 0, // Line
            trackPrice: false,
            transparency: 0,
            visible: true,
            color: lineColor,
          },
        },
        inputs: {},
      },
      styles: {
        plot_0: {
          title: `Live Metric Tracker (${smaLength}) ${displayName}`,
          histogramBase: 0,
        },
      },
      inputs: [],
    },

    constructor: function (this: any) {
      this._metricData = [] as Array<{ ts: number; y: number }>;
      this._dataLoaded = false;
      this._kickedParent = false as boolean;
      this._marketId = marketId;
      this._metricName = metricName;
      this._timeframe = timeframe;
      this._smaLength = smaLength;
      // IMPORTANT:
      // Avoid coercing "unset" into a number (e.g. Number(null) === 0), which can silently
      // pin the indicator to a constant value.
      this._metricConst = typeof metricConst === 'number' && Number.isFinite(metricConst) ? metricConst : NaN;
      this._lastFetchMs = 0 as number;
      this._fetchInFlight = null as Promise<void> | null;
      this._warnedEmpty = false as boolean;
      this._debugMainLogged = false as boolean;

      this.init = async function (context: any, inputCallback: any) {
        this._context = context;
        // Fetch metric data on init (and periodically thereafter).
        // Note: studies are long-lived; metric data is constantly evolving.
        const doFetch = async () => {
          try {
            const pts = await fetchMetricData({
              marketId: this._marketId,
              metricName: this._metricName,
              timeframe: this._timeframe,
              smaLength: this._smaLength,
            });
            this._metricData = pts;
            this._dataLoaded = true;
            this._lastFetchMs = Date.now();
            if (pts.length === 0 && !this._warnedEmpty) {
              this._warnedEmpty = true;
              // warn so it shows up even when console filters out info logs
              console.warn(
                `[MetricIndicator] No metric points yet for marketId=${this._marketId} metricName=${this._metricName} timeframe=${this._timeframe}`
              );
            }
            // Force an immediate repaint/recalc so the study renders on first load.
            requestStudyUpdate(this._context);
            // TradingView has no public "requestUpdate" in PineJS context; visibility toggles force a recalc.
            // So we "kick" the parent widget once after first successful load to trigger a redraw.
            if (!this._kickedParent && pts.length > 0) {
              this._kickedParent = true;
              kickParentChartOnce();
            }
          } catch (err) {
            console.error('[MetricIndicator] Failed to load metric data:', err);
            this._metricData = [];
            this._dataLoaded = true;
            this._lastFetchMs = Date.now();
            // Even on error, request an update so the chart doesn't remain in a stale NaN-only state.
            requestStudyUpdate(this._context);
          }
        };

        this._fetchInFlight = doFetch().finally(() => {
          this._fetchInFlight = null;
        });
      };

      this.main = function (context: any, inputCallback: any) {
        // Refresh in the background when cache TTL is exceeded
        const now = Date.now();
        if (now - (this._lastFetchMs || 0) > CACHE_TTL_MS && !this._fetchInFlight) {
          this._fetchInFlight = (async () => {
            try {
              const pts = await fetchMetricData({
                marketId: this._marketId,
                metricName: this._metricName,
                timeframe: this._timeframe,
                smaLength: this._smaLength,
              });
              this._metricData = pts;
              this._dataLoaded = true;
              this._lastFetchMs = Date.now();
              if (pts.length > 0) this._warnedEmpty = false;
              // If the series changed, ensure the study is recalculated without waiting for the next tick.
              requestStudyUpdate(this._context);
            } catch {
              // keep last data
              this._lastFetchMs = Date.now();
            }
          })().finally(() => {
            this._fetchInFlight = null;
          });
        }

        // DEBUG: allow forcing a constant output so we can detect whether the
        // Charting Library expects study values in some scaled unit.
        // NOTE: We only allow this via the React-side config (metricOverlay.metricConst).
        // We intentionally do NOT read metricConst from the URL to avoid stale query params.
        if (Number.isFinite(this._metricConst)) {
          if (!this._debugMainLogged) {
            this._debugMainLogged = true;
            // eslint-disable-next-line no-console
            console.warn(`[MetricIndicator] main forced metricConst=${this._metricConst} (config)`);
          }
          return [this._metricConst];
        }

        if (!this._dataLoaded || this._metricData.length === 0) {
          return [NaN];
        }

        // Get the current bar's time.
        // Depending on Charting Library build, this may come in seconds or milliseconds.
        const rawTime = context?.symbol?.time ?? this._context?.symbol?.time;
        if (!rawTime) return [NaN];
        const n = Number(rawTime);
        if (!Number.isFinite(n)) return [NaN];
        const barTimeMs = n > 1e12 ? n : n * 1000;
        // The /api/charts/metric endpoint can compute SMA server-side (and we prefer that),
        // so we only need to interpolate the returned series for per-bar plotting.
        const value = getMetricValueForTime(this._metricData, barTimeMs);

        // Debug-only: TradingView calls `main` a *lot*; avoid logging (and avoid `console.error`)
        // unless explicitly opted in via `metricDebug=1` / localStorage.
        if (!this._debugMainLogged && devSeedRequested() && Number.isFinite(value as any)) {
          this._debugMainLogged = true;
          // eslint-disable-next-line no-console
          console.debug(
            `[MetricIndicator] main firstValue ${JSON.stringify({
              marketId: this._marketId,
              metricName: this._metricName,
              timeframe: this._timeframe,
              smaLength: this._smaLength,
              barTimeMs,
              value,
            })}`
          );
        }

        return [value !== null ? value : NaN];
      };
    },
  };
}

/**
 * Creates the custom_indicators_getter function for TradingView widget options
 */
export function createCustomIndicatorsGetter(configs: MetricIndicatorConfig[]) {
  return function (): Promise<any[]> {
    const indicators = configs.map((config) => createMetricIndicatorDefinition(config));
    return Promise.resolve(indicators);
  };
}

/**
 * Get the study name for a metric indicator (used with createStudy)
 * Must match the name used in createMetricIndicatorDefinition
 */
export function getMetricStudyName(displayName: string): string {
  const studySlug = normalizeStudySlug(displayName);
  return `MetricOverlay_${studySlug}`;
}

// Export for testing
export { normalizeStudySlug };

