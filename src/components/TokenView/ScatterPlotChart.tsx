'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Chart } from 'chart.js/auto';
import { useMarketData } from '@/contexts/MarketDataContext';
import { runMetricAIWithPolling } from '@/lib/metricAiWorker';
import supabaseClient from '@/lib/supabase-browser';

type ScatterPoint = { x: number; y: number; ts?: number };

interface ScatterPlotChartProps {
  symbol: string;
  width?: string | number;
  height?: string | number;
  className?: string;
  data?: ScatterPoint[];
  pointColor?: string;
}

const timeframes = [
  { label: '1m', value: '1m', interval: 60 },
  { label: '5m', value: '5m', interval: 300 },
  { label: '15m', value: '15m', interval: 900 },
  { label: '30m', value: '30m', interval: 1800 },
  { label: '1h', value: '1h', interval: 3600 },
  { label: '4h', value: '4h', interval: 14400 },
  { label: '1d', value: '1d', interval: 86400 }
];

function hashStringToNumber(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function parseClickhouseTs(input: string | number | Date | undefined): number {
  try {
    if (typeof input === 'number') return input > 1e12 ? input : input * 1000;
    if (input instanceof Date) return input.getTime();
    const s = String(input || '').trim();
    // ClickHouse usually returns 'YYYY-MM-DD HH:MM:SS.mmm'
    // Convert to ISO-like and force UTC
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const ms = Date.parse(iso.endsWith('Z') ? iso : `${iso}Z`);
    return Number.isFinite(ms) ? ms : Date.now();
  } catch {
    return Date.now();
  }
}

export default function ScatterPlotChart({
  symbol,
  width = '100%',
  height = 350,
  className = '',
  data,
  pointColor = 'rgba(255, 255, 255, 0.5)'
}: ScatterPlotChartProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart | null>(null);
  const [selectedTimeframe, setSelectedTimeframe] = useState<'1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d'>('5m');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const md = useMarketData();
  const [remoteData, setRemoteData] = useState<ScatterPoint[] | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [fetchError, setFetchError] = useState<string | null>(null);

  const containerIsNumberHeight = typeof height === 'number';

  // Map timeframe to seconds for indexing
  const tfSeconds = useMemo<Record<'1m' | '5m' | '15m' | '30m' | '1h' | '4h' | '1d', number>>(
    () => ({
      '1m': 60,
      '5m': 300,
      '15m': 900,
      '30m': 1800,
      '1h': 3600,
      '4h': 14400,
      '1d': 86400
    }),
    []
  );

  const formatTimeLabel = (tsMs: number): string => {
    const d = new Date(tsMs);
    if (selectedTimeframe === '1d' || selectedTimeframe === '4h') {
      return d.toLocaleDateString();
    }
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const displayName = useMemo(() => {
    const m = (md?.market as any) || null;
    const tokenName = md?.tokenData?.name;
    const fromMarket =
      (m && (m.name || m.market_identifier)) ? String(m.name || m.market_identifier).replace(/_/g, ' ') : null;
    return (fromMarket || tokenName || symbol).toString();
  }, [md?.market, md?.tokenData?.name, symbol]);

  const displayData = useMemo(() => {
    if (remoteData && remoteData.length > 0) return remoteData;
    if (data && data.length > 0) return data;
    return [];
  }, [remoteData, data]);

  const activePoint = useMemo(() => {
    if (!displayData || displayData.length === 0) return null;
    if (hoveredIndex !== null && hoveredIndex >= 0 && hoveredIndex < displayData.length) {
      return displayData[hoveredIndex];
    }
    return displayData[displayData.length - 1];
  }, [displayData, hoveredIndex]);

  // Background ingestion: while this chart is mounted and a market is resolved,
  // periodically fetch the metric via the worker and insert a scatter point into ClickHouse.
  useEffect(() => {
    const marketId: string | undefined = (md?.market as any)?.id;
    const aiLocator = (md?.market as any)?.market_config?.ai_source_locator || null;
    const metricUrl: string | null =
      (aiLocator && (aiLocator.url || aiLocator.primary_source_url)) ||
      (md?.market as any)?.initial_order?.metricUrl ||
      null;
    const workerUrl =
      (process as any)?.env?.NEXT_PUBLIC_METRIC_AI_WORKER_URL ||
      (globalThis as any)?.process?.env?.NEXT_PUBLIC_METRIC_AI_WORKER_URL ||
      '';
    if (!marketId || !metricUrl || !workerUrl) {
      try {
        console.log('[ScatterIngest] prerequisites missing', {
          marketId,
          hasMetricUrl: Boolean(metricUrl),
          hasWorker: Boolean(workerUrl),
        });
      } catch {}
      return;
    }
    let cancelled = false;
    const postedIndexRef = { current: -1 as number };
    // Defaults: run at most once per view per timeframe every 5 minutes; wait up to 10s for worker
    const ttlMsEnv = 300000; // 5 minutes
    const workerTimeoutMs = 10000; // 10 seconds
    const storageKey = `ai-ingest:last:${marketId}:${selectedTimeframe}`;
    try {
      console.log('[ScatterIngest] candidate', { marketId, tf: selectedTimeframe, metricUrl, ttlMs: ttlMsEnv, storageKey });
    } catch {}

    const ingestOnce = async () => {
      try {
        // Optional: gate by active viewers in metric_subscriptions
        // Always gate by recent viewers; if none in last 2 minutes, skip
        try {
          const supabase = supabaseClient;
          const viewerWindowMs =
            Number.parseInt(
              String(
                (process as any)?.env?.NEXT_PUBLIC_VIEWER_WINDOW_MS ||
                  (globalThis as any)?.process?.env?.NEXT_PUBLIC_VIEWER_WINDOW_MS ||
                  ''
              ),
              10
            ) || 120000; // default 2 minutes
          const sinceIso = new Date(Date.now() - viewerWindowMs).toISOString();
          const { data, error } = await supabase
            .from('metric_subscriptions')
            .select('client_id, last_seen_at')
            .eq('market_id', marketId)
            .gt('last_seen_at', sinceIso);
          if (!error) {
            try { console.log('[ScatterIngest] gating check', { viewers: Array.isArray(data) ? data.length : 0, windowMs: viewerWindowMs }); } catch {}
          }
          if (!error && Array.isArray(data) && data.length === 0) {
            try { console.log('[ScatterIngest] skip: no active viewers in window'); } catch {}
            return; // no active viewers -> skip ingestion
          }
        } catch {
          // If select fails due to RLS or network, conservatively skip to avoid unwanted calls
          try { console.log('[ScatterIngest] gating error, skipping ingestion'); } catch {}
          return;
        }
        try { console.log('[ScatterIngest] start', { marketId, tf: selectedTimeframe, metricUrl }); } catch {}
        // Resolve current metric value via worker (short budget)
        try { console.log('[ScatterIngest] calling worker'); } catch {}
        const res = await runMetricAIWithPolling(
          {
            metric: String((md?.market as any)?.market_identifier || symbol || '').toUpperCase(),
            urls: [metricUrl],
            related_market_id: marketId,
            context: 'settlement',
          },
          { intervalMs: 1500, timeoutMs: workerTimeoutMs }
        ).catch(() => null);
        if (!res) {
          try { console.log('[ScatterIngest] worker returned no result (timeout/failure)'); } catch {}
          return;
        }
        const numeric = Number(res.asset_price_suggestion || res.value);
        if (!Number.isFinite(numeric)) return;
        // Compute index for the selected timeframe to reduce duplicates
        const nowMs = Date.now();
        const tf = selectedTimeframe;
        const sec = tfSeconds[tf] || 300;
        const idx = Math.floor(nowMs / (sec * 1000));
        if (postedIndexRef.current === idx) return; // already posted this slot
        // Insert into ClickHouse via our API
        const payload = {
          marketId,
          timeframe: tf,
          metricName: String((md?.market as any)?.name || symbol || ''),
          source: 'worker',
          version: 1,
          points: {
            ts: nowMs,
            x: idx,
            y: Number(numeric),
          },
        };
        const resSave = await fetch('/api/charts/scatter', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          cache: 'no-store',
        });
        if (resSave.ok) {
          postedIndexRef.current = idx;
          // Optimistically append to current series so the chart reflects immediately
          setRemoteData(prev => {
            const arr = Array.isArray(prev) ? prev.slice() : [];
            arr.push({ x: nowMs, y: Number(numeric), ts: nowMs });
            if (arr.length > 2000) arr.shift();
            return arr;
          });
          try { console.log('[ScatterIngest] scatter point inserted', { marketId, tf, idx, y: Number(numeric) }); } catch {}
        } else {
          try { console.log('[ScatterIngest] scatter insert failed', { status: resSave.status }); } catch {}
        }
      } catch {
        // Swallow failures; chart will still operate on existing data
        try { console.log('[ScatterIngest] ingest error (caught)'); } catch {}
      }
    };

    // One-shot ingestion per view with TTL throttle
    try {
      const last = Number.parseInt(String(localStorage.getItem(storageKey) || ''), 10) || 0;
      const now = Date.now();
      if (now - last >= ttlMsEnv) {
        try { console.log('[ScatterIngest] ttl pass, starting ingest', { last, now }); } catch {}
        localStorage.setItem(storageKey, String(now));
        void ingestOnce();
      } else {
        try { console.log('[ScatterIngest] ttl skip', { last, now, ttlMs: ttlMsEnv }); } catch {}
      }
    } catch {
      // If localStorage not available, still attempt a one-shot
      try { console.log('[ScatterIngest] localStorage unavailable, starting ingest fallback'); } catch {}
      void ingestOnce();
    }

    return () => {
      cancelled = true;
    };
  }, [md?.market, symbol, selectedTimeframe, tfSeconds]);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    chartRef.current = new Chart(ctx, {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: `${displayName} Scatter`,
            data: displayData,
            showLine: false,
            pointRadius: 2,
            pointHoverRadius: 3,
            pointBorderWidth: 0,
            pointBackgroundColor: pointColor,
            pointBorderColor: 'rgba(255,255,255,0.12)'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        parsing: false,
        layout: {
          padding: {
            top: 6,
            right: 6,
            bottom: 6,
            left: 6
          }
        },
        elements: {
          point: {
            hitRadius: 6,
            hoverRadius: 3
          }
        },
        interaction: {
          mode: 'nearest',
          intersect: false
        },
        animation: {
          duration: 800,
          easing: 'easeOutCubic'
        },
        animations: {
          y: {
            type: 'number',
            duration: 800,
            easing: 'easeOutCubic',
            from: (ctx: any) => {
              const chart = ctx.chart;
              // Start from the bottom of the plotting area for a slide-up effect
              return chart?.chartArea?.bottom ?? 0;
            },
            delay: (ctx: any) => {
              // Subtle cascading effect per point
              return ctx.type === 'data' && ctx.mode === 'default' ? Math.min(ctx.dataIndex * 5, 250) : 0;
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          tooltip: {
            enabled: true,
            backgroundColor: 'rgba(17,17,17,0.9)',
            titleColor: '#9CA3AF',
            bodyColor: '#FFFFFF',
            borderColor: '#333333',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: (ctx) => {
                const p = ctx.parsed as any;
                const when = Number.isFinite(p?.x) ? formatTimeLabel(Number(p.x)) : '';
                return when ? `${when} — ${p.y}` : `y: ${p.y}`;
              }
            }
          }
        },
        scales: {
          x: {
            type: 'linear',
            border: {
              display: false
            },
            grid: {
              color: 'rgba(255,255,255,0.06)',
              drawTicks: false
            },
            ticks: {
              display: true,
              color: '#808080',
              maxTicksLimit: 6,
              callback: (value) => {
                const v = Number(value);
                return Number.isFinite(v) ? formatTimeLabel(v) : '';
              }
            }
          },
          y: {
            type: 'linear',
            border: {
              display: false
            },
            grid: {
              color: 'rgba(255,255,255,0.06)',
              drawTicks: false
            },
            ticks: {
              display: false,
              color: '#808080',
              maxTicksLimit: 5
            }
          }
        }
      }
    });

    const handlePointerMove = (evt: MouseEvent) => {
      if (!chartRef.current) return;
      const els = chartRef.current.getElementsAtEventForMode(
        evt as unknown as Event,
        'nearest',
        { intersect: false, axis: 'xy' },
        true
      );
      if (els && els.length > 0) {
        const idx = (els[0] as any).index as number;
        setHoveredIndex(idx);
      } else {
        setHoveredIndex(null);
      }
    };
    const handlePointerLeave = () => setHoveredIndex(null);

    canvasRef.current.addEventListener('mousemove', handlePointerMove);
    canvasRef.current.addEventListener('mouseleave', handlePointerLeave);

    const handleResize = () => {
      chartRef.current?.resize();
    };
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (canvasRef.current) {
        canvasRef.current.removeEventListener('mousemove', handlePointerMove);
        canvasRef.current.removeEventListener('mouseleave', handlePointerLeave);
      }
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [symbol, displayData, pointColor]);

  // Fetch from ClickHouse API
  useEffect(() => {
    let aborted = false;
    const marketId = (md?.market as any)?.id as string | undefined;
    if (!marketId) {
      // Wait for market to resolve; keep loading state
      setIsFetching(true);
      return () => { aborted = true; };
    }
    setIsFetching(true);
    setFetchError(null);
    setRemoteData(null);
    const tf = selectedTimeframe;
    const url = `/api/charts/scatter?marketId=${encodeURIComponent(marketId)}&timeframe=${encodeURIComponent(tf)}&limit=1200`;
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const body = await res.json();
        const rows = Array.isArray(body?.data) ? body.data : [];
        const pts: ScatterPoint[] = rows.map((r: any, i: number) => {
          const t = parseClickhouseTs(r?.ts);
          return {
            x: Number.isFinite(t) ? t : Number(i),
            y: Number(r?.y ?? 0),
            ts: Number.isFinite(t) ? t : undefined
          };
        }).filter((p: ScatterPoint) => Number.isFinite(p.x) && Number.isFinite(p.y));
        if (!aborted) {
          setRemoteData(pts);
        }
      })
      .catch((e) => {
        if (!aborted) {
          setFetchError(String(e?.message || e));
          setRemoteData(null);
        }
      })
      .finally(() => {
        if (!aborted) setIsFetching(false);
      });
    return () => { aborted = true; };
  }, [symbol, selectedTimeframe]);

  return (
    <div
      className={`group relative bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 w-full ${containerIsNumberHeight ? '' : 'h-full'} ${className} flex flex-col overflow-hidden`}
      style={{
        ...(containerIsNumberHeight ? { height: height as number } : {}),
        width
      }}
    >
      {/* Header with legend + timeframe controls */}
      <div className="flex items-center justify-between px-2 py-1 border-b border-[#1A1A1A]">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            {String(displayName || symbol).toUpperCase()}
          </h4>
          <span className="text-white text-sm font-medium">
            {activePoint ? `$${activePoint.y.toFixed(2)}` : '—'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          {timeframes.map((tf) => (
            <button
              key={tf.value}
              onClick={() => setSelectedTimeframe(tf.value as any)}
              className={`px-2 py-1 text-[10px] font-medium rounded transition-all duration-200 ${
                selectedTimeframe === tf.value
                  ? 'text-white bg-[#1A1A1A] border border-[#333333]'
                  : 'text-[#808080] hover:text-white hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333]'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {isFetching && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-4 max-w-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      Loading chart data…
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {!isFetching && !fetchError && displayData.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-4 max-w-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      No data available
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        {fetchError && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-4 max-w-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-400" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-red-400">
                      Failed to load
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
        <canvas ref={canvasRef} className="w-full h-full" />
      </div>
    </div>
  );
}


