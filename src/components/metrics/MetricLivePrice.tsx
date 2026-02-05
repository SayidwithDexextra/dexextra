'use client';

import React from 'react';
import { getSupabaseClient } from '../../lib/supabase-browser';

export interface MetricLivePriceProps {
  marketId?: string;
  token?: string;
  marketIdentifier?: string; // legacy prop alias for token
  className?: string;
  label?: string;            // legacy UI label
  prefix?: string;           // legacy (ignored) — kept for compatibility
  suffix?: string;           // legacy (ignored) — kept for compatibility
  isLive?: boolean;          // legacy (ignored) — kept for compatibility
  compact?: boolean;         // legacy (ignored) — kept for compatibility
  value?: number | string;   // legacy (ignored) — kept for compatibility
  isSettlementWindow?: boolean; // legacy (ignored) — kept for compatibility
  onOpenSettlement?: () => void; // legacy (ignored) — kept for compatibility
  url?: string;              // optional metric source url (legacy props for compatibility)
  cssSelector?: string;
  xpath?: string;
  jsExtractor?: string;
  htmlSnippet?: string;
  pollIntervalMs?: number;
  enableLiveMetric?: boolean; // legacy (ignored) — kept for compatibility
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
    // Keep `source` in sync with `props.url`.
    if (url) {
      stopPollingRef.current = true; // parent-provided url is authoritative; don't poll.
      setSourceIfChanged({ kind: 'url', value: url, url });
    } else {
      stopPollingRef.current = false;
      setSource((prev) => (prev.kind === 'url' ? { kind: 'none', value: null, url: null } : prev));
    }
  }, [url, setSourceIfChanged]);

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
        // Prefer DB view if present (encodes our intended fallback order).
        // If it doesn't exist in an env, we'll fall back to reading `markets` directly.
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
              // Script-kind has no navigable URL.
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

        let query = supabase.from('markets').select('market_config, initial_order');
        query = marketId ? query.eq('id', marketId) : query.or(`market_identifier.eq.${t},symbol.eq.${t}`);

        const { data, error } = await query.maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setSourceIfChanged({ kind: 'none', value: null, url: null });
          return;
        }

        const cfg = (data as any)?.market_config || null;
        const initial = (data as any)?.initial_order || null;

        const clean = (v: any) => {
          const s = String(v ?? '').trim();
          return s ? s : null;
        };

        // Required resolution:
        // 1) Prefer `market_config.source_url`
        // 2) Fall back to `initial_order.metricUrl`
        // In current Supabase data, `source_url` may live nested under `wayback_snapshot.source_url`
        // (and/or `ai_source_locator.url`). We treat those as equivalent "source_url" inputs.
        const marketConfigSourceUrl = clean(
          cfg?.source_url ??
            cfg?.sourceUrl ??
            cfg?.sourceURL ??
            cfg?.wayback_snapshot?.source_url ??
            cfg?.wayback_snapshot?.sourceUrl ??
            cfg?.ai_source_locator?.url ??
            cfg?.ai_source_locator?.primary_source_url
        );
        const initialOrderMetricUrl = clean(initial?.metricUrl ?? initial?.metric_url ?? initial?.metricurl);

        const resolvedUrl = marketConfigSourceUrl || initialOrderMetricUrl;
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

  return (
    <div
      className={`bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 ${className}`}
    >
      <div className="flex items-center justify-between p-2">
        <span className="text-[11px] font-medium text-[#808080] leading-none">{label}</span>
        <span
          className="text-[9px] text-[#8a8a8a] leading-none truncate max-w-[180px]"
          title={source.value || undefined}
        >
          {source.kind === 'url' && source.url ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="group inline-flex items-center gap-1 underline"
            >
              <span>{displayText}</span>
              <svg
                aria-hidden="true"
                viewBox="0 0 24 24"
                className="h-3 w-3 text-[#6B7280] opacity-80 transition-opacity group-hover:opacity-100"
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
            <span>{displayText}</span>
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  );
}

export default MetricLivePrice;
