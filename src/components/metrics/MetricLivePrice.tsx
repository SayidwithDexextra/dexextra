'use client';

import React from 'react';
import { getSupabaseClient } from '../../lib/supabase-browser';

export interface MetricLivePriceProps {
  marketId?: string;
  token?: string;
  marketIdentifier?: string;
  className?: string;
  label?: string;
  prefix?: string;
  suffix?: string;
  isLive?: boolean;
  compact?: boolean;
  value?: number | string;
  isSettlementWindow?: boolean;
  onOpenSettlement?: () => void;
  url?: string;
  cssSelector?: string;
  xpath?: string;
  jsExtractor?: string;
  htmlSnippet?: string;
  pollIntervalMs?: number;
  enableLiveMetric?: boolean;
}

export function MetricLivePrice(props: MetricLivePriceProps) {
  const {
    marketId,
    token,
    marketIdentifier,
    className = '',
    label = 'Metric Source',
    url,
    pollIntervalMs,
    onOpenSettlement,
  } = props;

  const supabase = getSupabaseClient();
  const [source, setSource] = React.useState<{
    kind: 'url' | 'script' | 'none';
    value: string | null;
    url: string | null;
  }>(() => ({
    kind: url ? 'url' : 'none',
    value: url || null,
    url: url || null,
  }));

  const [settlementActive, setSettlementActive] = React.useState(false);

  const stopPollingRef = React.useRef<boolean>(false);

  const pollMs = React.useMemo(() => {
    const raw = Number(pollIntervalMs);
    if (!Number.isFinite(raw) || raw <= 0) return null;
    // Safety clamp: avoid extreme spam or accidental multi-minute waits.
    return Math.max(2000, Math.min(120_000, Math.floor(raw)));
  }, [pollIntervalMs]);

  const setSourceIfChanged = React.useCallback(
    (next: { kind: 'url' | 'script' | 'none'; value: string | null; url: string | null }) => {
      setSource((prev) => {
        if (prev.kind === next.kind && prev.value === next.value && prev.url === next.url) return prev;
        return next;
      });
    },
    []
  );

  React.useEffect(() => {
    if (url) {
      stopPollingRef.current = true;
      setSourceIfChanged({ kind: 'url', value: url, url });
    } else {
      stopPollingRef.current = false;
      setSource((prev) => (prev.kind === 'url' ? { kind: 'none', value: null, url: null } : prev));
    }
  }, [url, setSourceIfChanged]);

  // When url is provided as a prop the main load effect is skipped,
  // so we need a dedicated fetch for settlement status.
  React.useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const t = token || marketIdentifier;
    if (!marketId && !t) return;

    (async () => {
      try {
        let q = supabase.from('markets').select('market_status');
        q = marketId ? q.eq('id', marketId) : q.or(`market_identifier.eq.${t},symbol.eq.${t}`);
        const { data } = await q.maybeSingle();
        if (!cancelled && data) {
          setSettlementActive(String((data as any)?.market_status ?? '') === 'SETTLEMENT_REQUESTED');
        }
      } catch { /* non-fatal */ }
    })();

    return () => { cancelled = true; };
  }, [supabase, url, marketId, token, marketIdentifier]);

  // If `url` is not provided, attempt to load it from the `markets` table.
  React.useEffect(() => {
    if (url) return;
    let cancelled = false;

    const load = async () => {
      const t = token || marketIdentifier;
      if (!marketId && !t) {
        setSourceIfChanged({ kind: 'none', value: null, url: null });
        return;
      }

      try {
        // Always fetch market_status for settlement detection.
        try {
          let statusQ = supabase.from('markets').select('market_status');
          statusQ = marketId ? statusQ.eq('id', marketId) : statusQ.or(`market_identifier.eq.${t},symbol.eq.${t}`);
          const { data: statusRow } = await statusQ.maybeSingle();
          if (!cancelled && statusRow) {
            setSettlementActive(String((statusRow as any)?.market_status ?? '') === 'SETTLEMENT_REQUESTED');
          }
        } catch { /* non-fatal */ }

        // Prefer DB view if present (encodes our intended fallback order).
        try {
          let q = supabase
            .from('market_metric_source_display')
            .select('display_kind, display_value, source_url');
          q = marketId ? q.eq('id', marketId) : q.or(`market_identifier.eq.${t},symbol.eq.${t}`);
          const { data: vRow, error: vErr } = await q.maybeSingle();
          if (!cancelled && !vErr && vRow) {
            const kind = String((vRow as any)?.display_kind || '').toLowerCase();
            const displayValue = String((vRow as any)?.display_value ?? '').trim();
            const sourceUrl = String((vRow as any)?.source_url ?? '').trim();
            if (kind === 'script' && displayValue) {
              setSourceIfChanged({ kind: 'script', value: displayValue, url: null });
              stopPollingRef.current = true;
              return;
            }
            if (kind === 'url') {
              const resolved = sourceUrl || displayValue;
              if (resolved) {
                setSourceIfChanged({ kind: 'url', value: resolved, url: resolved });
                stopPollingRef.current = true;
                return;
              }
            }
            if (kind === 'none') {
              // Continue to fallback below (some envs may have stale view definition).
            }
          }
        } catch {
          // non-fatal; fallback to markets query below
        }

        let query = supabase.from('markets').select('ai_source_locator, market_config, initial_order, market_status');
        query = marketId ? query.eq('id', marketId) : query.or(`market_identifier.eq.${t},symbol.eq.${t}`);

        const { data, error } = await query.maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setSourceIfChanged({ kind: 'none', value: null, url: null });
          return;
        }

        const status = String((data as any)?.market_status ?? '');
        if (!cancelled) setSettlementActive(status === 'SETTLEMENT_REQUESTED');

        const cfg = (data as any)?.market_config || null;
        const initial = (data as any)?.initial_order || null;

        const clean = (v: any) => {
          const s = String(v ?? '').trim();
          return s ? s : null;
        };

        const aiLocator = (data as any)?.ai_source_locator || null;
        const locatorUrl = clean(aiLocator?.url ?? aiLocator?.primary_source_url);

        const marketConfigSourceUrl = clean(
          cfg?.source_url ??
            cfg?.sourceUrl ??
            cfg?.sourceURL ??
            cfg?.wayback_snapshot?.source_url ??
            cfg?.wayback_snapshot?.sourceUrl
        );
        const initialOrderMetricUrl = clean(initial?.metricUrl ?? initial?.metric_url ?? initial?.metricurl);

        const resolvedUrl = locatorUrl || marketConfigSourceUrl || initialOrderMetricUrl;
        if (resolvedUrl) {
          setSourceIfChanged({ kind: 'url', value: resolvedUrl, url: resolvedUrl });
          stopPollingRef.current = true;
        } else {
          setSourceIfChanged({ kind: 'none', value: null, url: null });
        }
      } catch {
        if (!cancelled) setSourceIfChanged({ kind: 'none', value: null, url: null });
      }
    };

    // Initial load + optional polling:
    // When markets are created, the deployment pipeline may populate source_url later.
    // Poll until the source becomes available, then stop.
    stopPollingRef.current = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      await load();
      if (cancelled) return;
      if (!pollMs) return;
      if (stopPollingRef.current) return;
      timer = setTimeout(() => {
        void tick();
      }, pollMs);
    };

    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [supabase, url, marketId, token, marketIdentifier, pollMs, setSourceIfChanged]);

  const displayText = React.useMemo(() => {
    if (!source.value) return '—';
    if (source.kind === 'script') return source.value;
    // url-kind
    try {
      return new URL(source.value).hostname;
    } catch {
      return source.value.length > 64 ? `${source.value.slice(0, 64)}…` : source.value;
    }
  }, [source.kind, source.value]);

  const hasSource = source.kind !== 'none' && !!source.value;

  return (
    <div
      className={`relative rounded-md border transition-all duration-300 overflow-hidden ${
        settlementActive
          ? 'border-yellow-500/40 bg-[#0F0F0F]'
          : hasSource
            ? 'border-red-500/25 bg-gradient-to-r from-[#0F0F0F] to-[#130B0B] hover:border-red-500/40 hover:shadow-[0_0_12px_rgba(239,68,68,0.08)]'
            : 'border-[#222222] bg-[#0F0F0F] hover:border-[#333333]'
      } ${className}`}
    >
      {hasSource && !settlementActive && (
        <div className="absolute inset-0 bg-gradient-to-r from-red-500/[0.03] via-transparent to-red-500/[0.02] pointer-events-none" />
      )}
      <div className="relative flex items-center justify-between p-2">
        <div className="flex items-center gap-1.5">
          {hasSource && (
            <div className="relative flex items-center justify-center w-2 h-2">
              <div className="absolute w-2 h-2 rounded-full bg-red-500/30 animate-ping" />
              <div className="w-1.5 h-1.5 rounded-full bg-red-500" />
            </div>
          )}
          <span className={`text-[11px] font-medium leading-none ${hasSource ? 'text-[#c0c0c0]' : 'text-[#808080]'}`}>
            {label}
          </span>
        </div>
        <span
          className="text-[9px] leading-none truncate max-w-[180px]"
          title={source.value || undefined}
        >
          {source.kind === 'url' && source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1 text-red-400/80 hover:text-red-300 transition-colors duration-200"
            >
              <span className="underline underline-offset-2 decoration-red-500/30 group-hover:decoration-red-400/60">
                {displayText}
              </span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3 w-3 opacity-60 transition-opacity group-hover:opacity-100"
                fill="none"
              >
                <path
                  d="M14 3h7v7m0-7L10 14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M10 7H7a4 4 0 0 0-4 4v6a4 4 0 0 0 4 4h6a4 4 0 0 0 4-4v-3"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </a>
          ) : source.kind === 'script' && source.value ? (
            <span className="text-red-400/70">{displayText}</span>
          ) : (
            <span className="text-[#555]">—</span>
          )}
        </span>
      </div>
      {settlementActive && onOpenSettlement && (
        <button
          onClick={onOpenSettlement}
          className="w-full flex items-center justify-between px-2 py-1.5 border-t border-yellow-500/20 bg-yellow-500/5 hover:bg-yellow-500/10 transition-colors duration-200 group"
        >
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
            <span className="text-[10px] font-medium text-yellow-300/90">Settlement Requested</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-yellow-400/60 group-hover:text-yellow-400/90 transition-colors">
              Open
            </span>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              className="h-3 w-3 text-yellow-400/50 group-hover:text-yellow-400/80 transition-colors"
              fill="none"
            >
              <path
                d="M9 5l7 7-7 7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </button>
      )}
    </div>
  );
}

export default MetricLivePrice;
