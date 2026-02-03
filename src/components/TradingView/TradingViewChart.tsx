'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createMarketUuidDatafeed } from '@/lib/tradingview/marketUuidDatafeed';
import {
  createCustomIndicatorsGetter,
  getMetricStudyName,
  type MetricIndicatorConfig,
} from '@/lib/tradingview/metricIndicator';

const ensureScript = (id: string, src: string, isReady: () => boolean) =>
  new Promise<void>((resolve, reject) => {
    if (typeof window === 'undefined') {
      reject(new Error('TradingView can only load in the browser.'));
      return;
    }

    if (isReady()) {
      resolve();
      return;
    }

    const existing = document.getElementById(id) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error(`Failed to load script: ${src}`)), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.id = id;
    script.src = src;
    script.async = true;

    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script: ${src}`));

    document.head.appendChild(script);
  });

const ensureChartingLibrary = () =>
  ensureScript(
    'tradingview-charting-library',
    // The cloned TradingView repo provides `charting_library.js` (not `.min.js`)
    '/charting_library/charting_library.js',
    () => Boolean((window as any).TradingView?.widget)
  );

const ensureUdfDatafeed = () =>
  ensureScript(
    'tradingview-udf-datafeed',
    '/charting_library/datafeeds/udf/dist/bundle.js',
    () => Boolean((window as any).Datafeeds?.UDFCompatibleDatafeed)
  );

export interface TradingViewChartProps {
  symbol: string;
  interval?: string;
  theme?: 'light' | 'dark';
  height?: number;
  width?: number;
  autosize?: boolean;
  locale?: string;
  timezone?: string;
  allowSymbolChange?: boolean;
  hideTopToolbar?: boolean;
  hideSideToolbar?: boolean;
  /**
   * If true, visually hides the main OHLC series so only overlays (like metricOverlay) show.
   *
   * If omitted, the chart will auto-enable this mode when `/api/tradingview/history` is serving
   * metric-derived bars (i.e. OHLC is missing, but metric-series exists).
   */
  metricOnly?: boolean;
  /**
   * If true (default), prevents TradingView from showing/creating any Volume study by default.
   * Volume can still be added explicitly by callers via `studies` (unless you also keep it removed in code).
   */
  hideVolumePanel?: boolean;
  studies?: string[];
  className?: string;
  onSymbolChange?: (symbol: string) => void;
  onIntervalChange?: (interval: string) => void;
  /**
   * Optional metric overlay config. When provided, displays the metric data
   * from ClickHouse as a line overlay on the chart (like a moving average).
   */
  metricOverlay?: {
    /** The market UUID to fetch metric data for */
    marketId: string;
    /**
     * The ClickHouse metric name to fetch (recommended: stable string used by writers).
     * If omitted, the indicator will fall back to `displayName`.
     */
    metricName?: string;
    /** Timeframe for metric data (1m, 5m, 15m, 30m, 1h, 4h, 1d). Default: 5m */
    timeframe?: string;
    /** Line color (CSS). Default: #A78BFA */
    lineColor?: string;
    /** Line width in pixels. Default: 1 */
    lineWidth?: number;
    /** SMA length (points). Default: 20 */
    smaLength?: number;
    /** Display name for the indicator. Default: Metric Value */
    displayName?: string;
    /** Whether the metric overlay is enabled. Default: true */
    enabled?: boolean;
    /** DEBUG: force a constant output value for the metric indicator */
    metricConst?: number;
  };
}

export default function TradingViewChart({
  symbol,
  interval = '15',
  theme = 'dark',
  height = 600,
  width,
  // Default to explicit height unless caller opts into autosize.
  // Autosize requires the *parent* to have an explicit height.
  autosize = false,
  locale = 'en',
  timezone = 'Etc/UTC',
  allowSymbolChange = true,
  hideTopToolbar = false,
  hideSideToolbar = false,
  metricOnly,
  // Most users expect the candle pane only; volume can be added explicitly as a study if desired.
  hideVolumePanel = true,
  studies = [],
  className = '',
  onSymbolChange,
  onIntervalChange,
  metricOverlay
}: TradingViewChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const metricStudyCreatedRef = useRef<boolean>(false);
  const [scriptReady, setScriptReady] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [debugStep, setDebugStep] = useState<string>('boot');
  const [hasWidget, setHasWidget] = useState(false);
  const [displaySymbol, setDisplaySymbol] = useState<string>(symbol);
  const [metricOnlyAuto, setMetricOnlyAuto] = useState<boolean>(false);

  // Expose a throttled "kick" function to the TradingView same-origin iframe.
  // Our custom indicator fetches data asynchronously, but the PineJS context has no public "requestUpdate".
  // So the study can remain blank until some UI interaction (like toggling visibility) forces a recalc.
  // We bridge that gap by letting the iframe call this function after its async fetch completes.
  const registerMetricOverlayKick = () => {
    const fn = () => {
      try {
        const w = widgetRef.current;
        if (!w) return;
        const chart = typeof w.activeChart === 'function' ? w.activeChart() : null;
        if (!chart) return;

        // IMPORTANT:
        // Do NOT call `resetCache()` / `resetData()` here.
        // Those can cause TradingView to tear down/recreate realtime subscriptions (unsubscribeBars),
        // which shows up as `[REALTIME] unsubscribing...` and can break realtime updates for some markets.
        //
        // Instead, force a lightweight recalculation by toggling the MetricOverlay study visibility.
        try {
          const studies = typeof chart.getAllStudies === 'function' ? chart.getAllStudies() : [];
          if (Array.isArray(studies) && studies.length) {
            const metricStudies = studies.filter((s: any) =>
              String(s?.name ?? s?.title ?? '')
                .toLowerCase()
                .includes('metricoverlay')
            );
            for (const s of metricStudies) {
              const id = (s as any)?.id;
              if (!id) continue;
              if (typeof chart.setEntityVisibility === 'function') {
                chart.setEntityVisibility(id, false);
                // next tick: re-show
                window.setTimeout(() => {
                  try {
                    chart.setEntityVisibility(id, true);
                  } catch {
                    // noop
                  }
                }, 0);
              }
            }
          }
        } catch {
          // noop
        }
      } catch {
        // noop
      }
    };

    // Throttle globally (important: avoid loops if resetData triggers re-init).
    (window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICK__ = () => {
      const now = Date.now();
      const last = Number((window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICKED_AT__ || 0);
      if (now - last < 10_000) return;
      (window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICKED_AT__ = now;
      fn();
    };
  };

  const studiesKey = useMemo(() => studies.join('|'), [studies]);

  // Memoize metric overlay config to avoid unnecessary re-renders
  const metricConfig = useMemo<MetricIndicatorConfig | null>(() => {
    if (!metricOverlay || metricOverlay.enabled === false || !metricOverlay.marketId) {
      return null;
    }
    // NOTE:
    // `metricConst` is a DEBUG-only override and should only be provided explicitly by the caller
    // (via `metricOverlay.metricConst`). We intentionally DO NOT read it from the URL here,
    // because stale query params can silently pin the study to 0 (or any prior value).
    const metricConst =
      typeof metricOverlay.metricConst === 'number' && Number.isFinite(metricOverlay.metricConst)
        ? metricOverlay.metricConst
        : undefined;

    // IMPORTANT:
    // Keep `metricName` (data key) decoupled from `displayName` (UI label).
    // This prevents accidental mismatches like:
    // - displayName = "BTC" but ClickHouse metric_name = "BITCOIN"
    // which would yield empty metric_series results and fall back to scatter.
    const metricName =
      typeof metricOverlay.metricName === 'string' && metricOverlay.metricName.trim()
        ? metricOverlay.metricName.trim()
        : undefined;

    const displayName =
      typeof metricOverlay.displayName === 'string' && metricOverlay.displayName.trim()
        ? metricOverlay.displayName.trim()
        : metricName || 'Metric Value';

    return {
      marketId: metricOverlay.marketId,
      metricName,
      timeframe: metricOverlay.timeframe || '5m',
      // Coordinated with candle colors + dark pane background.
      lineColor: metricOverlay.lineColor || '#A78BFA',
      // Keep the overlay subtle so it doesn't overpower candles.
      lineWidth: metricOverlay.lineWidth || 1,
      smaLength: metricOverlay.smaLength ?? 20,
      metricConst,
      displayName,
    };
  }, [
    metricOverlay?.marketId,
    metricOverlay?.metricName,
    metricOverlay?.timeframe,
    metricOverlay?.lineColor,
    metricOverlay?.lineWidth,
    metricOverlay?.smaLength,
    metricOverlay?.displayName,
    metricOverlay?.enabled,
    metricOverlay?.metricConst,
  ]);

  const metricConfigKey = useMemo(
    () => (metricConfig ? JSON.stringify(metricConfig) : ''),
    [metricConfig]
  );

  const metricOnlyResolved = typeof metricOnly === 'boolean' ? metricOnly : metricOnlyAuto;

  // Apply `metricOnlyResolved` without recreating the widget (recreating can drop realtime subs).
  useEffect(() => {
    const w = widgetRef.current;
    if (!w) return;
    const transparent = metricOnlyResolved ? 'rgba(0,0,0,0)' : undefined;
    const o: Record<string, any> = {
      'mainSeriesProperties.candleStyle.upColor': transparent ?? '#0d9980',
      'mainSeriesProperties.candleStyle.downColor': transparent ?? '#f23646',
      'mainSeriesProperties.candleStyle.borderUpColor': transparent ?? '#0d9980',
      'mainSeriesProperties.candleStyle.borderDownColor': transparent ?? '#f23646',
      'mainSeriesProperties.candleStyle.wickUpColor': transparent ?? '#0d9980',
      'mainSeriesProperties.candleStyle.wickDownColor': transparent ?? '#f23646',
    };
    try {
      if (typeof w.applyOverrides === 'function') w.applyOverrides(o);
    } catch {
      // noop
    }
    try {
      const chart = typeof w.activeChart === 'function' ? w.activeChart() : null;
      if (chart && typeof chart.applyOverrides === 'function') chart.applyOverrides(o);
    } catch {
      // noop
    }
  }, [metricOnlyResolved]);

  // Auto-enable metricOnly when the datafeed is forced to serve metric-derived bars (no OHLC available).
  // OPTIMIZATION: Defer this check until after the chart has loaded to avoid blocking initial render.
  // The history endpoint is already called by TradingView during widget init; we can detect metricOnly
  // from the response architecture header after the chart is ready, rather than making a duplicate request.
  useEffect(() => {
    if (typeof metricOnly === 'boolean') return; // explicit override
    if (!metricConfig?.marketId) return;
    // Only check after widget is ready to avoid blocking initial load
    if (!hasWidget) return;
    
    let cancelled = false;
    // Use a small delay to let TradingView's own history request complete first
    const timer = setTimeout(async () => {
      try {
        const to = Math.floor(Date.now() / 1000);
        const from = to - 24 * 60 * 60;
        const url =
          `/api/tradingview/history?symbol=${encodeURIComponent(metricConfig.marketId)}` +
          `&resolution=${encodeURIComponent(String(interval || '5'))}` +
          `&from=${encodeURIComponent(String(from))}` +
          `&to=${encodeURIComponent(String(to))}` +
          `&countback=50`;
        const res = await fetch(url, { cache: 'default' }); // Allow cache hit from TradingView's request
        const body = await res.json().catch(() => null);
        const arch = body?.meta?.architecture ? String(body.meta.architecture) : '';
        if (!cancelled) setMetricOnlyAuto(arch === 'metric_series_fallback');
      } catch {
        if (!cancelled) setMetricOnlyAuto(false);
      }
    }, 500); // Delay to avoid racing with TradingView's own request
    
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [metricOnly, metricConfig?.marketId, interval, hasWidget]);

  // If the incoming symbol is a market UUID, resolve to a human-friendly metric_id for display.
  // The datafeed will still use `ticker` (UUID) internally for history + realtime.
  // OPTIMIZATION: This is purely cosmetic and doesn't block chart functionality.
  // Defer until after widget init to avoid blocking the critical render path.
  useEffect(() => {
    const raw = String(symbol || '').trim();
    setDisplaySymbol(raw);
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw);
    if (!isUuid) return;
    // Only resolve after widget exists to avoid blocking initial load
    if (!hasWidget) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/tradingview/symbols?symbol=${encodeURIComponent(raw)}`);
        if (!res.ok) return;
        const info = await res.json();
        const metricId = info?.custom?.metric_id ? String(info.custom.metric_id) : null;
        if (!cancelled && metricId) setDisplaySymbol(metricId);
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, hasWidget]);

  useEffect(() => {
    let cancelled = false;

    setDebugStep('loading-library');
    Promise.all([ensureChartingLibrary(), ensureUdfDatafeed()])
      .then(() => {
        if (!cancelled) setScriptReady(true);
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setError(err.message || 'Failed to load TradingView library.');
        setIsLoading(false);
        setDebugStep('library-load-failed');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!scriptReady || !containerRef.current) return;
    setDebugStep('library-ready');
    if (!(window as any).TradingView?.widget) {
      setError('TradingView library not available. Ensure /public/charting_library exists.');
      setIsLoading(false);
      setDebugStep('no-window-tradingview');
      return;
    }

    setIsLoading(true);
    setError(null);
    setDebugStep('creating-widget');
    setHasWidget(false);
    metricStudyCreatedRef.current = false;

    // OPTIMIZATION: Reduced timeout from 60s to 15s for better UX
    // The chart usually loads within 5-10 seconds; 15s accounts for slow networks
    const readyTimeout = window.setTimeout(() => {
      // Timeout is non-fatal if the chart finishes later; keep it as a warning.
      setError('Chart is taking longer than expected. This may indicate limited data for this market.');
      setIsLoading(false);
      setDebugStep('timeout');
    }, 15_000);

    const disabledFeatures = [
      ...(hideTopToolbar ? ['header_widget'] : []),
      ...(hideSideToolbar ? ['left_toolbar'] : []),
      // Prevent TradingView from auto-creating the default "Volume" study/pane.
      // We'll also set `addVolume: false` on the widget options (below) as a belt-and-suspenders.
      ...(hideVolumePanel ? ['create_volume_indicator_by_default', 'create_volume_indicator_by_default_once'] : []),
      ...(!allowSymbolChange ? ['header_symbol_search'] : []),
      'use_localstorage_for_settings',
      'right_bar_stays_on_scroll'
    ];

    const udf =
      (window as any).Datafeeds?.UDFCompatibleDatafeed
        ? createMarketUuidDatafeed(
            new (window as any).Datafeeds.UDFCompatibleDatafeed('/api/tradingview', 30_000)
          )
        : null;

    // Build custom_indicators_getter if metric overlay is configured
    const customIndicatorsGetter = metricConfig
      ? createCustomIndicatorsGetter([metricConfig])
      : undefined;

    // Helpful runtime breadcrumbs for debugging indicator wiring.
    console.warn('[TradingViewChart] init', {
      symbol,
      displaySymbol,
      interval,
      metricOverlayEnabled: metricOverlay?.enabled !== false,
      metricConfig: metricConfig
        ? {
            marketId: metricConfig.marketId,
            timeframe: metricConfig.timeframe,
            displayName: metricConfig.displayName,
          }
        : null,
      hasCustomIndicatorsGetter: Boolean(customIndicatorsGetter),
    });

    const widgetOptions: any = {
      // Keep the widget symbol stable to avoid re-creating the TradingView widget (which drops realtime subs).
      // If callers pass a market UUID, the symbols endpoint will still provide a human `name`/`description`.
      symbol,
      datafeed: udf,
      interval,
      container: containerRef.current,
      library_path: '/charting_library/',
      locale,
      timezone,
      autosize,
      theme,
      // TradingView internal code checks this flag before creating Volume by default.
      // The d.ts in our repo doesn't expose it, but the runtime supports it.
      // We set it when `hideVolumePanel` is true to fully remove the volume indicator/pane.
      ...(hideVolumePanel ? { addVolume: false } : {}),
      disabled_features: disabledFeatures,
      // NOTE: `study_templates` requires a save/load adapter endpoint; enabling it without backend support
      // causes noisy 404s + unhandled promise rejections in the console.
      // IMPORTANT:
      // Do NOT enable `iframe_loading_same_origin` here.
      // TradingView may try to iframe the site origin (`/`) during init; if any deployment variant
      // serves `X-Frame-Options: DENY` (e.g. Vercel `?dpl=...` pinned deployments), the chart will fail
      // with "Refused to display ... in a frame".
      enabled_features: ['remove_library_container_border'],
      debug: true,
      loading_screen: {
        // NOTE: TradingView loading screen does not support gradients; use the start color.
        backgroundColor: theme === 'dark' ? '#18181a' : '#ffffff',
        foregroundColor: theme === 'dark' ? '#d1d5db' : '#374151'
      },
      overrides: {
        // Pane background
        // Keep this solid to avoid any gradient "flash"/race during init.
        'paneProperties.backgroundType': 'solid',
        'paneProperties.background': theme === 'dark' ? '#18181a' : '#ffffff',
        // Some builds still read gradient fields; set them to the same solid color for safety.
        'paneProperties.backgroundGradientStartColor': theme === 'dark' ? '#18181a' : '#ffffff',
        'paneProperties.backgroundGradientEndColor': theme === 'dark' ? '#18181a' : '#ffffff',
        'paneProperties.vertGridProperties.color': theme === 'dark' ? '#1f1f1f' : '#e5e7eb',
        'paneProperties.horzGridProperties.color': theme === 'dark' ? '#1f1f1f' : '#e5e7eb',
        'scalesProperties.textColor': theme === 'dark' ? '#d1d5db' : '#374151',
        // Keep scales aligned with the pane's primary background (prevents a "different colored strip").
        'scalesProperties.backgroundColor': theme === 'dark' ? '#18181a' : '#ffffff',
        // If metricOnly is enabled, make the candle series fully transparent so overlays can render alone.
        // (TradingView still needs a time series to compute `context.symbol.time` for studies.)
        'mainSeriesProperties.candleStyle.upColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#0d9980',
        'mainSeriesProperties.candleStyle.downColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#f23646',
        'mainSeriesProperties.candleStyle.borderUpColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#0d9980',
        'mainSeriesProperties.candleStyle.borderDownColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#f23646',
        'mainSeriesProperties.candleStyle.wickUpColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#0d9980',
        'mainSeriesProperties.candleStyle.wickDownColor': metricOnlyResolved ? 'rgba(0,0,0,0)' : '#f23646'
      },
      // Add custom indicators getter for metric overlay
      ...(customIndicatorsGetter ? { custom_indicators_getter: customIndicatorsGetter } : {})
    };

    if (!autosize) {
      widgetOptions.width = width;
      widgetOptions.height = height;
    }

    if (!udf) {
      window.clearTimeout(readyTimeout);
      setError(
        'UDF datafeed not loaded. Ensure /public/charting_library/datafeeds/udf/dist/bundle.js exists.'
      );
      setIsLoading(false);
      setDebugStep('no-udf-datafeed');
      return () => {};
    }

    try {
      widgetRef.current = new (window as any).TradingView.widget(widgetOptions);
      setHasWidget(true);
      registerMetricOverlayKick();
    } catch (e: any) {
      window.clearTimeout(readyTimeout);
      setError(`Failed to create TradingView widget: ${String(e?.message || e)}`);
      setIsLoading(false);
      setDebugStep('create-widget-threw');
      return () => {};
    }

    widgetRef.current.onChartReady(() => {
      console.warn('[TradingViewChart] onChartReady fired', {
        symbol,
        displaySymbol,
        interval,
        metricConfig: metricConfig
          ? {
              marketId: metricConfig.marketId,
              timeframe: metricConfig.timeframe,
              displayName: metricConfig.displayName,
            }
          : null,
      });
      window.clearTimeout(readyTimeout);
      setIsLoading(false);
      setDebugStep('ready');
      setError(null);

      const chart = widgetRef.current?.activeChart();

      // Make pane background deterministic.
      // In some Charting Library builds, the theme/defaults can be re-applied after widget creation,
      // which can overwrite our `paneProperties.*` overrides and leave a solid/black background.
      // Re-apply the same overrides once the chart is fully ready (and again shortly after).
      const applyChartOverrides = () => {
        const w = widgetRef.current;
        if (!w) return;
        const o = widgetOptions?.overrides;
        if (!o) return;
        try {
          if (typeof w.applyOverrides === 'function') w.applyOverrides(o);
        } catch {
          // noop
        }
        try {
          const c = typeof w.activeChart === 'function' ? w.activeChart() : null;
          if (c && typeof c.applyOverrides === 'function') c.applyOverrides(o);
        } catch {
          // noop
        }
      };
      applyChartOverrides();
      window.setTimeout(applyChartOverrides, 250);

      // Remove volume indicator/pane if requested (belt-and-suspenders).
      // Even with `create_volume_indicator_by_default` + `addVolume:false`, some saved templates/builds
      // can still render Volume asynchronously. We attempt removal a few times.
      const removeVolumeStudies = () => {
        if (!hideVolumePanel || !chart) return;
        try {
          const all = typeof chart.getAllStudies === 'function' ? chart.getAllStudies() : [];
          if (!Array.isArray(all)) return;
          for (const s of all) {
            const id = (s as any)?.id;
            const name = String((s as any)?.name ?? (s as any)?.title ?? '').toLowerCase();
            if (!id) continue;
            // "Volume" is the built-in default study name, but be tolerant.
            if (name === 'volume' || name.includes('volume')) {
              try {
                chart.removeEntity(id);
                console.warn(`[TradingViewChart] Removed volume study: ${name} (${id})`);
              } catch {
                // noop
              }
            }
          }
        } catch {
          // noop
        }
      };
      removeVolumeStudies();
      window.setTimeout(removeVolumeStudies, 750);
      window.setTimeout(removeVolumeStudies, 2500);

      // Add standard studies
      if (studies.length && chart) {
        studies.forEach(study => {
          try {
            chart.createStudy(study);
          } catch {
            // noop
          }
        });
      }

      // Auto-add metric overlay study if configured
      // OPTIMIZATION: Reduced retry attempts and using exponential backoff to minimize blocking time
      if (metricConfig && chart) {
        const studyName = getMetricStudyName(metricConfig.displayName || 'Metric Value');
        const tryCreateMetricStudy = (attempt: number) => {
          if (metricStudyCreatedRef.current) return;
          // TradingView loads custom studies asynchronously. Before calling `createStudy`,
          // ensure our custom study is actually present in the studies list; otherwise
          // the library throws `unexpected study id:<x>` (it resolves by description).
          try {
            const widget = widgetRef.current;
            const list: string[] | undefined =
              widget && typeof widget.getStudiesList === 'function' ? widget.getStudiesList() : undefined;

            // If the library exposes the list, wait until our custom study appears there.
            // Otherwise, fall back to trying `createStudy()` directly and use error-based retries.
            if (Array.isArray(list)) {
              const resolvedName =
                list.find((n) => n.toLowerCase() === studyName.toLowerCase()) ?? null;

              if (!resolvedName) {
                // OPTIMIZATION: Reduced from 20 to 10 attempts, using exponential backoff
                const maxAttempts = 10;
                if (attempt < maxAttempts) {
                  if (attempt === 1) {
                    const metricMatches = list.filter((n) =>
                      n.toLowerCase().includes('metricoverlay')
                    );
                    console.warn(
                      `[TradingViewChart] Metric study not in studies list yet: ${studyName}. ` +
                        `Total studies=${list.length} ` +
                        `MetricOverlay matches=${metricMatches.length}. Retrying…`
                    );
                  }
                  // Exponential backoff: 100ms, 200ms, 400ms, 800ms... (max ~5s total)
                  const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
                  window.setTimeout(() => tryCreateMetricStudy(attempt + 1), delay);
                  return;
                }
                console.warn(
                  `[TradingViewChart] Metric study never appeared in studies list: ${studyName}`
                );
                return;
              }

              // Force overlay so it renders on the main candle pane (MA-style).
              chart.createStudy(resolvedName, true, false);
              metricStudyCreatedRef.current = true;
              console.warn(`[TradingViewChart] Added metric overlay study (from list): ${resolvedName}`);
              return;
            }

            // If `getStudiesList()` isn't available, don't block creation on it.
            if (attempt === 1) {
              console.warn(
                `[TradingViewChart] getStudiesList() not available; attempting createStudy directly: ${studyName}`
              );
            }

          } catch (err: any) {
            // Fall through to legacy error-based retry below.
          }

          try {
            // Force overlay so it renders on the main candle pane (MA-style).
            chart.createStudy(studyName, true, false);
            metricStudyCreatedRef.current = true;
            console.warn(`[TradingViewChart] Added metric overlay study (direct): ${studyName}`);
            return;
          } catch (err: any) {
            const msg = String(err?.message || err || '');
            // Custom indicators sometimes load slightly after `onChartReady`.
            // Retry if the library can't find the study metainfo yet.
            // OPTIMIZATION: Reduced from 20 to 10 attempts with exponential backoff
            const maxAttempts = 10;
            if (attempt < maxAttempts && msg.toLowerCase().includes('unexpected study id')) {
              console.warn(
                `[TradingViewChart] Metric study not ready yet (attempt ${attempt}/${maxAttempts}): ${studyName}. Retrying…`
              );
              const delay = Math.min(100 * Math.pow(2, attempt - 1), 1000);
              window.setTimeout(() => tryCreateMetricStudy(attempt + 1), delay);
              return;
            }
            console.warn(`[TradingViewChart] Failed to add metric study: ${studyName}`, err);
          }
        };
        tryCreateMetricStudy(1);
      }

      if (onSymbolChange && chart) {
        chart.onSymbolChanged().subscribe(null, (symbolData: any) => {
          onSymbolChange(symbolData.ticker);
        });
      }

      if (onIntervalChange && chart) {
        chart.onIntervalChanged().subscribe(null, (newInterval: string) => {
          onIntervalChange(newInterval);
        });
      }
    });

    return () => {
      window.clearTimeout(readyTimeout);
      // Clean up bridge function so stale widgets can't be kicked.
      try {
        if ((window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICK__) {
          delete (window as any).__DEXEXTRA_TV_METRIC_OVERLAY_KICK__;
        }
      } catch {
        // noop
      }
      if (widgetRef.current) {
        try {
          widgetRef.current.remove();
        } catch {
          // noop
        }
        widgetRef.current = null;
      }
    };
  }, [
    scriptReady,
    symbol,
    interval,
    theme,
    autosize,
    height,
    width,
    locale,
    timezone,
    allowSymbolChange,
    hideTopToolbar,
    hideSideToolbar,
    hideVolumePanel,
    studiesKey,
    onSymbolChange,
    onIntervalChange,
    metricConfig,
    metricConfigKey
  ]);

  return (
    <div
      className={`relative tradingview-chart ${className} border border-gray-800 rounded-lg overflow-hidden`}
      style={{
        height: autosize ? '100%' : height,
        // Match TradingView's pane background (solid).
        background: theme === 'dark' ? '#18181a' : undefined,
      }}
    >
      {/* IMPORTANT: always mount the container so the widget can initialize */}
      <div ref={containerRef} className="w-full h-full" />

      {/* Overlays */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-gray-400">Loading chart…</div>
          <div className="absolute bottom-2 right-3 text-[10px] text-gray-600 select-none">{debugStep}</div>
        </div>
      )}

      {/* If the widget exists, show warning as a small non-blocking banner */}
      {error && !isLoading && hasWidget && (
        <div className="pointer-events-none absolute top-2 left-2 rounded bg-black/60 border border-gray-800 px-3 py-2">
          <div className="text-[11px] text-gray-300">{error}</div>
          <div className="text-[10px] text-gray-500">debug: {debugStep}</div>
        </div>
      )}

      {/* If widget never created, show blocking error */}
      {error && !isLoading && !hasWidget && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-center text-sm text-gray-400 px-4">{error}</div>
        </div>
      )}
    </div>
  );
}

