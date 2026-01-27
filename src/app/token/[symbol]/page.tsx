'use client';

import { use, useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  TokenHeader, 
  TradingPanel, 
  TokenStats, 
  TransactionTable,
  ThreadPanel,
  MarketActivityTabs
} from '@/components/TokenView';
import { TradingViewChart } from '@/components/TradingView';
// Removed smart contract hooks - functionality disabled
import { TokenData } from '@/types/token';
import NetworkSelector from '@/components/NetworkSelector';
import CountdownTicker from '@/components/CountdownTicker/CountdownTicker';
import LoadingScreen from '@/components/LoadingScreen';
import CryptoMarketTicker from '@/components/CryptoMarketTicker/CryptoMarketTicker';
import { MarketDataProvider, useMarketData } from '@/contexts/MarketDataContext';
// Removed contractDeployment import
// Removed useVAMMSettlement hook
import { MetricLivePrice } from '@/components';
import SeriesMarketToggle from '@/components/Series/SeriesMarketToggle';
import { useActivePairByMarketId, useSeriesMarkets } from '@/hooks/useSeriesRouting';
import { SettlementInterface } from '@/components/SettlementInterface';
import { getMetricAIWorkerBaseUrl, runMetricAIWithPolling } from '@/lib/metricAiWorker';
import { getSupabaseClient } from '@/lib/supabase-browser';

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const isDeploying = searchParams.get('deploying') === '1';

  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'long' || action === 'short') {
      setTradingAction(action);
      
      // Log mock USDC address when action is 'long'
      if (action === 'long') {
        console.log('🏦 Mock USDC Address:', '0x194b4517a61D569aC8DBC47a22ed6F665B77a331');
      }
    }
  }, [searchParams]);
  return (
    <MarketDataProvider symbol={symbol} tickerEnabled={!isDeploying}>
      <TokenPageContent symbol={symbol} tradingAction={tradingAction} onSwitchNetwork={() => router.refresh()} />
    </MarketDataProvider>
  );
}

function TokenPageContent({ symbol, tradingAction, onSwitchNetwork }: { symbol: string; tradingAction: 'long' | 'short' | null; onSwitchNetwork: () => void; }) {
  const md = useMarketData();
  const sp = useSearchParams();
  const isDeploying = sp.get('deploying') === '1';
  const metricDebug = sp.get('metricDebug') === '1' && process.env.NODE_ENV !== 'production';
  const [isSettlementView, setIsSettlementView] = useState(false);

  const tokenData = md.tokenData;
  // Prevent flicker: once we have initial data, keep rendering content even if background polling toggles isLoading
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  useEffect(() => {
    if (!hasLoadedOnce && !md.error && tokenData) {
      setHasLoadedOnce(true);
    }
  }, [hasLoadedOnce, md.error, tokenData]);
  const currentPrice = (md.markPrice ?? md.resolvedPrice) || 0;
  const markPrice = currentPrice;
  const fundingRate = 0;
  const priceChange24h = 0;
  const priceChangePercent24h = 0;
  const lastUpdated = md.lastUpdated || new Date().toISOString();

  const isNetworkError = !!(md.error && typeof (md.error as any) === 'string' && (
    (md.error as any).includes('Please switch your wallet to Polygon') ||
    (md.error as any).includes('This contract is deployed on Polygon Mainnet')
  ));

  const shouldShowLoading = useMemo(() => {
    // If we're navigating here during deployment, skip the full-screen loader.
    if (isDeploying) return false;
    // If there's an error, don't show loader; show the error UI below.
    if (md.error) return false;
    // Only show the loading screen before the first successful data load
    if (!hasLoadedOnce) {
      if (md.isLoading) return true;
      if (!tokenData) return true;
    }
    return false;
  }, [hasLoadedOnce, md.isLoading, tokenData, md.error, isDeploying]);

  const loadingMessage = "Loading Trading Interface...";
  const loadingSubtitle = `Fetching ${symbol} market data, mark price, and available margin`;

  // Series / Rollover UI hooks must be called unconditionally (before any early returns)
  const currentMarketId = (md.market as any)?.id as string | undefined;
  const currentSymbol = symbol;
  const { pair } = useActivePairByMarketId(currentMarketId);
  const { markets: seriesMkts } = useSeriesMarkets(pair?.seriesId);

  // Metric overlay config for TradingView charts
  const metricOverlay = useMemo(() => {
    if (!currentMarketId) return undefined;
    const metricId = (md.market as any)?.market_identifier || symbol;
    // IMPORTANT: metricName is the ClickHouse key. Use the route symbol by default so
    // `/token/BITCOIN` fetches metric_name=BITCOIN even if `market_identifier` is BTC.
    const metricName = String(symbol || '').toUpperCase();

    // For the "live metric tracker" we want the latest value, not a lagging long SMA.
    // Allow overriding via `?metricSma=<n>` for debugging/tuning.
    const smaRaw = Number(sp.get('metricSma') || '');
    const smaLength =
      Number.isFinite(smaRaw) && smaRaw >= 0 ? Math.max(1, Math.min(5000, Math.floor(smaRaw))) : 1;

    // DEBUG-only: allow forcing the plotted value via URL when metricDebug is enabled.
    // This is useful for quickly detecting price-scale vs data-mapping issues.
    // Example: /token/BITCOIN?metricDebug=1&metricConst=45000
    let metricConst: number | undefined = undefined;
    if (metricDebug) {
      const raw = sp.get('metricConst');
      if (raw !== null && String(raw).trim() !== '') {
        const n = Number(raw);
        if (Number.isFinite(n)) metricConst = n;
      }
    }
    return {
      marketId: currentMarketId,
      metricName,
      timeframe: '5m',
      lineColor: '#A78BFA',
      lineWidth: 1,
      smaLength,
      displayName: String(metricId).toUpperCase(),
      metricConst,
      enabled: true,
    };
  }, [currentMarketId, md.market, symbol, metricDebug, sp]);

  // Re-enable "on token view after downtime" metric ingestion:
  // - If ClickHouse metric-series is stale (or missing), resolve current metric via the Metric AI worker
  // - POST the value into ClickHouse metric_series_raw via /api/charts/metric
  useEffect(() => {
    const marketId = currentMarketId;
    const metricName = String(metricOverlay?.metricName || '').trim();
    if (!marketId || !metricName) return;

    // Ensure worker is configured; if not, silently skip.
    // NOTE: in local dev on localhost, getMetricAIWorkerBaseUrl() defaults to NEXT_PUBLIC_METRIC_AI_WORKER_URL_LOCAL
    // (or http://localhost:3001). If you aren't running the worker locally, set
    // NEXT_PUBLIC_METRIC_AI_WORKER_URL_LOCAL=https://metric-ai-worker.vercel.app
    try {
      void getMetricAIWorkerBaseUrl();
    } catch {
      return;
    }

    const ttlMsRaw = Number(
      (process as any)?.env?.NEXT_PUBLIC_METRIC_SERIES_INGEST_TTL_MS ||
        (globalThis as any)?.process?.env?.NEXT_PUBLIC_METRIC_SERIES_INGEST_TTL_MS
    );
    const ttlMs = Number.isFinite(ttlMsRaw) && ttlMsRaw > 0 ? Math.floor(ttlMsRaw) : 5 * 60_000; // 5 minutes

    const staleMsRaw = Number(
      (process as any)?.env?.NEXT_PUBLIC_METRIC_SERIES_STALE_MS ||
        (globalThis as any)?.process?.env?.NEXT_PUBLIC_METRIC_SERIES_STALE_MS
    );
    const staleMs = Number.isFinite(staleMsRaw) && staleMsRaw > 0 ? Math.floor(staleMsRaw) : 30 * 60_000; // 30 minutes

    const storageKey = `metric-series-ingest:last:${marketId}:${metricName}`;

    // Only run when the page is visible (avoid background tab spam).
    try {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    } catch {}

    let cancelled = false;

    const parseNumeric = (raw: unknown): number => {
      const s = String(raw ?? '').trim();
      if (!s) return NaN;
      // allow commas (e.g. "4,470.50")
      const n = Number(s.replace(/,/g, ''));
      return Number.isFinite(n) ? n : NaN;
    };

    const parseClickhouseTsMs = (input: any): number => {
      try {
        if (typeof input === 'number') return input > 1e12 ? input : input * 1000;
        const s = String(input || '').trim();
        // ClickHouse usually returns 'YYYY-MM-DD HH:MM:SS.mmm'
        const iso = s.includes('T') ? s : s.replace(' ', 'T');
        const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
        return Number.isFinite(ms) ? ms : 0;
      } catch {
        return 0;
      }
    };

    const resolveMetricUrl = async (): Promise<string | null> => {
      // 1) Try from md.market (some envs may include these fields)
      try {
        const aiLocator = (md?.market as any)?.market_config?.ai_source_locator || null;
        const fromLocator = aiLocator && (aiLocator.url || aiLocator.primary_source_url) ? String(aiLocator.url || aiLocator.primary_source_url) : '';
        const fromInit = (md?.market as any)?.initial_order?.metricUrl ? String((md?.market as any)?.initial_order?.metricUrl) : '';
        if (fromInit) return fromInit;
        if (fromLocator) return fromLocator;
      } catch {}

      // 2) Fallback: fetch from `markets` table (this is what `MetricLivePrice` does)
      try {
        const sb = getSupabaseClient();
        const { data, error } = await sb
          .from('markets')
          .select('market_config, initial_order')
          .eq('id', marketId)
          .maybeSingle();
        if (error || !data) return null;
        const initialOrderMetricUrl =
          (data as any)?.initial_order?.metricUrl ||
          (data as any)?.initial_order?.metric_url ||
          null;
        const loc = (data as any)?.market_config?.ai_source_locator || null;
        const locatorUrl = loc?.url || loc?.primary_source_url || null;
        return initialOrderMetricUrl || locatorUrl || null;
      } catch {
        return null;
      }
    };

    const run = async () => {
      try {
        const metricUrl = await resolveMetricUrl();
        if (!metricUrl) {
          if (metricDebug) console.warn('[MetricSeriesIngest] skip: no metricUrl', { marketId, metricName });
          return;
        }

        // TTL throttle per-market (only after we have a metricUrl).
        try {
          const last = Number.parseInt(String(localStorage.getItem(storageKey) || ''), 10) || 0;
          const now = Date.now();
          if (now - last < ttlMs) {
            if (metricDebug) console.warn('[MetricSeriesIngest] ttl skip', { marketId, metricName, ttlMs, last });
            return;
          }
          localStorage.setItem(storageKey, String(now));
        } catch {
          // If localStorage fails, continue with a best-effort single run.
        }

        // 1) Check ClickHouse freshness (metric-series)
        try {
          const checkUrl =
            `/api/charts/metric?marketId=${encodeURIComponent(marketId)}` +
            `&metricName=${encodeURIComponent(metricName)}` +
            `&timeframe=1m&agg=last&limit=1&sma=0`;
          const res = await fetch(checkUrl, { cache: 'no-store' });
          if (res.ok) {
            const body = await res.json().catch(() => null);
            const rows = Array.isArray(body?.data) ? body.data : [];
            const lastRow = rows.length > 0 ? rows[rows.length - 1] : null;
            const lastTsMs = parseClickhouseTsMs(lastRow?.ts);
            if (lastTsMs > 0 && Date.now() - lastTsMs < staleMs) {
              if (metricDebug) console.warn('[MetricSeriesIngest] skip: fresh', { lastTsMs, ageMs: Date.now() - lastTsMs, staleMs });
              return; // fresh enough; no need to call the worker
            }
          }
        } catch {
          // If freshness check fails, proceed (best effort) to worker fetch.
        }

        if (cancelled) return;

        // 2) Resolve current metric via worker
        const ai = await runMetricAIWithPolling(
          {
            metric: metricName,
            urls: [metricUrl],
            related_market_id: marketId,
            context: 'settlement',
          },
          { intervalMs: 1500, timeoutMs: 12_000 }
        ).catch(() => null);

        if (cancelled || !ai) {
          if (metricDebug) console.warn('[MetricSeriesIngest] worker returned no result');
          return;
        }

        const value = parseNumeric(ai.asset_price_suggestion ?? ai.value);
        if (!Number.isFinite(value)) {
          if (metricDebug) console.warn('[MetricSeriesIngest] worker returned non-numeric', { raw: ai.asset_price_suggestion ?? ai.value });
          return;
        }

        // 3) Insert into ClickHouse metric_series_raw via our API
        const nowMs = Date.now();
        const insertRes = await fetch('/api/charts/metric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          cache: 'no-store',
          body: JSON.stringify({
            marketId,
            metricName,
            source: 'metric_ai_worker',
            version: nowMs % 2_147_483_647,
            points: { ts: nowMs, value },
          }),
        });
        if (!insertRes.ok) {
          // best-effort; keep quiet unless in debug
          if (metricDebug) {
            const t = await insertRes.text().catch(() => '');
            console.warn('[MetricSeriesIngest] insert failed', { status: insertRes.status, t });
          }
        } else {
          if (metricDebug) console.warn('[MetricSeriesIngest] inserted', { marketId, metricName, value, ts: nowMs });
        }
      } catch (e) {
        if (metricDebug) console.warn('[MetricSeriesIngest] failed', e);
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [currentMarketId, metricOverlay?.metricName, md?.market, metricDebug]);

  // Dev-only helper: seed ClickHouse scatter data so the metric overlay has something to draw.
  const [scatterInfo, setScatterInfo] = useState<{ loading: boolean; count?: number; error?: string } | null>(null);
  const metricTimeframe = metricOverlay?.timeframe || '5m';

  const refreshScatterInfo = useCallback(async () => {
    if (!metricDebug || !currentMarketId) return;
    setScatterInfo({ loading: true });
    try {
      const res = await fetch(
        `/api/charts/scatter?marketId=${encodeURIComponent(currentMarketId)}&timeframe=${encodeURIComponent(metricTimeframe)}&limit=5`,
        { cache: 'no-store' }
      );
      const body = await res.json().catch(() => null);
      const count = Number(body?.meta?.count ?? (Array.isArray(body?.data) ? body.data.length : 0));
      setScatterInfo({ loading: false, count: Number.isFinite(count) ? count : 0 });
    } catch (e: any) {
      setScatterInfo({ loading: false, error: String(e?.message || e || 'Failed to check scatter') });
    }
  }, [metricDebug, currentMarketId, metricTimeframe]);

  const seedScatter = useCallback(async () => {
    if (!metricDebug || !currentMarketId) return;
    setScatterInfo({ loading: true });
    try {
      const tfSeconds: Record<string, number> = {
        '1m': 60,
        '5m': 300,
        '15m': 900,
        '30m': 1800,
        '1h': 3600,
        '4h': 14400,
        '1d': 86400,
      };
      const sec = tfSeconds[metricTimeframe] || 300;
      const now = Date.now();
      const pointsCount = 2 * 24 * (60 / (sec / 60)); // ~2 days worth
      const n = Math.max(50, Math.min(3000, Math.floor(pointsCount)));
      const startMs = now - n * sec * 1000;

      // Seed values near current BTC price so it actually overlays on the candle price scale.
      const base = Number(currentPrice || 0) || 65000;
      const amp = Math.max(50, base * 0.0025); // ~0.25% wiggle (min $50)

      const points = Array.from({ length: n }, (_, i) => {
        const ts = startMs + i * sec * 1000;
        const idx = Math.floor(ts / (sec * 1000));
        const wave = Math.sin(i / 10) + 0.5 * Math.sin(i / 33);
        const drift = (i / n - 0.5) * amp * 0.5;
        const y = base + wave * amp + drift;
        return { ts, x: idx, y };
      });

      const payload = {
        marketId: currentMarketId,
        timeframe: metricTimeframe,
        metricName: String((md.market as any)?.name || symbol || ''),
        source: 'dev_seed',
        version: 1,
        points,
      };

      const res = await fetch('/api/charts/scatter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        cache: 'no-store',
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Seed failed: ${res.status} ${t}`);
      }
      await refreshScatterInfo();
    } catch (e: any) {
      setScatterInfo({ loading: false, error: String(e?.message || e || 'Seed failed') });
    }
  }, [metricDebug, currentMarketId, metricTimeframe, currentPrice, md.market, symbol, refreshScatterInfo]);

  useEffect(() => {
    if (!metricDebug || !currentMarketId) return;
    void refreshScatterInfo();
  }, [metricDebug, currentMarketId, refreshScatterInfo]);

  if (shouldShowLoading) {
    return (
      <LoadingScreen 
        message={loadingMessage}
        subtitle={loadingSubtitle}
      />
    );
  }

  if (!isDeploying && (md.error || !tokenData)) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
          {isNetworkError ? (
            <>
              <div className="text-yellow-500 text-xl font-semibold">⚠️ Wrong Network</div>
              <div className="text-gray-300 text-sm mb-4">
                Please switch your wallet to Polygon to access this market.
              </div>
              <div className="bg-gray-900 p-6 rounded-xl border border-gray-700 w-full max-w-md">
                <div className="text-white text-lg font-medium mb-4">Switch to Polygon</div>
                <NetworkSelector compact={false} onNetworkChange={onSwitchNetwork} />
              </div>
              <div className="text-gray-500 text-xs">
                Error: {String(md.error)}
              </div>
            </>
          ) : (
            <>
              <div className="text-red-500 text-lg">Market Not Found</div>
              <div className="text-gray-400 text-sm">
                {String(md.error || `No market found for symbol: ${symbol}`)}
              </div>
              <div className="mt-4">
                <a 
                  href="/create-market" 
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Create {symbol} Market
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="token-page min-h-screen bg-black text-white">
      <CryptoMarketTicker className="border-b border-gray-800" />
      <div className="px-1 pb-8 pt-1">
        <div className="relative overflow-x-hidden overflow-y-visible">
          {/* Main trading content (unchanged layout) */}
          <div className={`transition-transform duration-500 ease-in-out ${isSettlementView ? '-translate-x-4' : 'translate-x-0'}`}>
            {/* Rollover toggle (if active pair exists) */}
            {pair && seriesMkts && seriesMkts.length >= 2 && (
              <div className="mb-1">
                <SeriesMarketToggle
                  seriesSlug={pair.seriesSlug}
                  markets={seriesMkts
                    .filter(m => m.marketId === pair.fromMarketId || m.marketId === pair.toMarketId)
                    .map(m => ({
                      marketId: m.marketId,
                      symbol: m.symbol,
                      isActive: m.symbol === currentSymbol,
                      isPrimary: m.isPrimary,
                      role: m.marketId === pair.fromMarketId ? 'front' : 'next'
                    }))}
                />
              </div>
            )}
            <div className="flex md:hidden flex-col gap-1">
              <div className="w-full mt-1 h-[70svh] min-h-[520px] relative">
                {currentMarketId ? (
                  <TradingViewChart
                    symbol={symbol}
                    autosize
                    className="h-full"
                    interval="5"
                    metricOverlay={metricOverlay}
                  />
                ) : (
                  <div className="w-full h-[399px] rounded-md border border-gray-800 bg-[#0F0F0F] flex items-center justify-center text-xs text-gray-400">
                    Loading market…
                  </div>
                )}
                {metricDebug && currentMarketId && (
                  <div className="absolute top-2 right-2 z-10 rounded border border-gray-800 bg-black/70 px-3 py-2 text-[11px] text-gray-200">
                    <div className="font-medium">Metric overlay debug</div>
                    <div className="text-[10px] text-gray-400">tf: {metricTimeframe}</div>
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded border border-gray-700 px-2 py-1 hover:border-gray-500"
                        onClick={() => void seedScatter()}
                        disabled={scatterInfo?.loading}
                      >
                        Seed scatter
                      </button>
                      <button
                        className="rounded border border-gray-700 px-2 py-1 hover:border-gray-500"
                        onClick={() => void refreshScatterInfo()}
                        disabled={scatterInfo?.loading}
                      >
                        Refresh
                      </button>
                    </div>
                    <div className="mt-2 text-[10px] text-gray-400">
                      {scatterInfo?.loading
                        ? 'checking…'
                        : scatterInfo?.error
                          ? `error: ${scatterInfo.error}`
                          : `ClickHouse points: ${scatterInfo?.count ?? '—'}`}
                    </div>
                    <div className="mt-2 text-[10px] text-gray-500">
                      After seeding, reload to force the indicator to refetch.
                    </div>
                  </div>
                )}
              </div>
              <div className="w-full">
                <MarketActivityTabs symbol={symbol} className="h-[320px]" />
              </div>
              <div className="w-full">
                {tokenData ? (
                  <TradingPanel 
                    tokenData={tokenData} 
                    initialAction={tradingAction}
                    marketData={{
                      markPrice: Number(markPrice || 0),
                      fundingRate: Number(fundingRate || 0),
                      currentPrice: Number(currentPrice || 0),
                      priceChange24h: Number(priceChange24h || 0),
                      priceChangePercent24h: Number(priceChangePercent24h || 0),
                      dataSource: 'contract',
                      lastUpdated: String(lastUpdated || '')
                    }}
                  />
                ) : (
                  <div className="w-full h-64 rounded-md border border-gray-800 bg-[#0F0F0F] flex items-center justify-center text-xs text-gray-400">
                    {isDeploying ? 'Setting up market…' : 'Loading data…'}
                  </div>
                )}
              </div>
            </div>

            <div className="hidden md:flex gap-1" style={{ height: 'calc(100vh - 96px - 40px - 1rem - 1.5rem + 27px)' }}>
              <div className="flex-1 flex flex-col gap-0.5 h-full overflow-hidden">
                <div className="flex-1 min-h-0 overflow-hidden relative">
                  {currentMarketId ? (
                    <TradingViewChart
                      symbol={symbol}
                      autosize
                      className="h-full"
                      interval="5"
                      metricOverlay={metricOverlay}
                    />
                  ) : (
                    <div className="w-full h-full rounded-md border border-gray-800 bg-[#0F0F0F] flex items-center justify-center text-xs text-gray-400">
                      Loading market…
                    </div>
                  )}
                  {metricDebug && currentMarketId && (
                    <div className="absolute top-2 right-2 z-10 rounded border border-gray-800 bg-black/70 px-3 py-2 text-[11px] text-gray-200">
                      <div className="font-medium">Metric overlay debug</div>
                      <div className="text-[10px] text-gray-400">tf: {metricTimeframe}</div>
                      <div className="mt-2 flex gap-2">
                        <button
                          className="rounded border border-gray-700 px-2 py-1 hover:border-gray-500"
                          onClick={() => void seedScatter()}
                          disabled={scatterInfo?.loading}
                        >
                          Seed scatter
                        </button>
                        <button
                          className="rounded border border-gray-700 px-2 py-1 hover:border-gray-500"
                          onClick={() => void refreshScatterInfo()}
                          disabled={scatterInfo?.loading}
                        >
                          Refresh
                        </button>
                      </div>
                      <div className="mt-2 text-[10px] text-gray-400">
                        {scatterInfo?.loading
                          ? 'checking…'
                          : scatterInfo?.error
                            ? `error: ${scatterInfo.error}`
                            : `ClickHouse points: ${scatterInfo?.count ?? '—'}`}
                      </div>
                      <div className="mt-2 text-[10px] text-gray-500">
                        After seeding, reload to force the indicator to refetch.
                      </div>
                    </div>
                  )}
                </div>
                <div className="min-h-[240px] h-[320px] max-h-[40%] overflow-hidden">
                  <MarketActivityTabs symbol={symbol} className="h-full" />
                </div>
              </div>
              <div className="w-[280px] h-full shrink-0">
                <TransactionTable 
                  marketId={(md.market as any)?.id}
                  marketIdentifier={(md.market as any)?.market_identifier || symbol}
                  orderBookAddress={(md as any)?.orderBookAddress || (md.market as any)?.market_address || undefined}
                  height="100%"
                />
              </div>
              <div className="w-80 flex flex-col gap-1 h-full">
                <div className="flex-shrink-0">
                  {(() => {
                    const locator = ((md.market as any)?.market_config?.ai_source_locator) || null;
                    const url = locator?.url || locator?.primary_source_url || null;
                    const cssSel = locator?.css_selector || null;
                    const xpath = locator?.xpath || null;
                    const jsx = locator?.js_extractor || null;
                    const htmlSnippet = locator?.html_snippet || null;
                    return (
                      <MetricLivePrice
                        value={Number(markPrice || currentPrice || 0)}
                        prefix="$"
                        isLive={Boolean(((md.market as any)?.market_status === 'ACTIVE') && Number(markPrice || currentPrice) > 0)}
                        className="w-full"
                        marketIdentifier={symbol}
                        url={url || undefined}
                        cssSelector={cssSel || undefined}
                        xpath={xpath || undefined}
                        jsExtractor={jsx || undefined}
                        htmlSnippet={htmlSnippet || undefined}
                        pollIntervalMs={10000}
                        onOpenSettlement={() => setIsSettlementView(true)}
                        // This card is primarily to show the source URL; live worker is optional.
                        enableLiveMetric={false}
                      />
                    );
                  })()}
                </div>
                <div className="flex-shrink-0 max-h-80 overflow-hidden">
                  <TokenHeader symbol={symbol} />
                </div>
                <div className="flex-1 min-h-0 overflow-hidden">
                  {tokenData ? (
                    <TradingPanel 
                      tokenData={tokenData} 
                      initialAction={tradingAction}
                      marketData={{
                        markPrice: Number(markPrice || 0),
                        fundingRate: Number(fundingRate || 0),
                        currentPrice: Number(currentPrice || 0),
                        priceChange24h: Number(priceChange24h || 0),
                        priceChangePercent24h: Number(priceChangePercent24h || 0),
                        dataSource: 'contract',
                        lastUpdated: String(lastUpdated || '')
                      }}
                    />
                  ) : (
                    <div className="w-full h-full rounded-md border border-gray-800 bg-[#0F0F0F] flex items-center justify-center text-xs text-gray-400">
                      {isDeploying ? 'Setting up market…' : 'Loading data…'}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
          {/* Settlement overlay (no layout shift) */}
          <div
            className={`token-page absolute inset-0 z-20 bg-black/95 backdrop-blur transition-transform duration-500 ease-in-out ${isSettlementView ? 'translate-x-0' : 'translate-x-full'}`}
          >
            <div className="h-full overflow-y-auto scrollbar-none px-1 pt-1">
              <div className="mx-auto max-w-5xl">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Settlement Window</h4>
                  <button
                    onClick={() => setIsSettlementView(false)}
                    className="text-xs text-[#9CA3AF] hover:text-white border border-[#222222] hover:border-[#333333] rounded px-2 py-1 transition-all duration-200"
                    title="Back to trading"
                  >
                    Back
                  </button>
                </div>
                <div className="space-y-1 pb-4">
                  <SettlementInterface
                    market={md.market as any}
                    onChallengeSaved={async () => {
                      if (typeof md.refetchMarket === 'function') {
                        await md.refetchMarket();
                      }
                    }}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}