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
  } = props;

  const supabase = getSupabaseClient();
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(url || null);

  React.useEffect(() => {
    // Keep `sourceUrl` in sync with `props.url`.
    setSourceUrl(url || null);
  }, [url]);

  // If `url` is not provided, attempt to load it from the `markets` table.
  React.useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (url) return;

      const t = token || marketIdentifier;
      if (!marketId && !t) {
        setSourceUrl(null);
        return;
      }

      try {
        let query = supabase.from('markets').select('market_config, initial_order');
        query = marketId ? query.eq('id', marketId) : query.or(`market_identifier.eq.${t},symbol.eq.${t}`);

        const { data, error } = await query.maybeSingle();
        if (cancelled) return;
        if (error || !data) {
          setSourceUrl(null);
          return;
        }

        // Prefer initial_order metric url (if present), fallback to ai_source_locator url.
        const initialOrderMetricUrl =
          (data as any)?.initial_order?.metricUrl ||
          (data as any)?.initial_order?.metric_url ||
          null;

        const loc = (data as any)?.market_config?.ai_source_locator || null;
        const locatorUrl = loc?.url || loc?.primary_source_url || null;

        setSourceUrl(initialOrderMetricUrl || locatorUrl || null);
      } catch {
        if (!cancelled) setSourceUrl(null);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [supabase, url, marketId, token, marketIdentifier]);

  const displayText = React.useMemo(() => {
    if (!sourceUrl) return '—';
    try {
      return new URL(sourceUrl).hostname;
    } catch {
      return sourceUrl.length > 64 ? `${sourceUrl.slice(0, 64)}…` : sourceUrl;
    }
  }, [sourceUrl]);

  return (
    <div
      className={`bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 ${className}`}
    >
      <div className="flex items-center justify-between p-2">
        <span className="text-[11px] font-medium text-[#808080] leading-none">{label}</span>
        <span className="text-[9px] text-[#8a8a8a] leading-none truncate max-w-[180px]" title={sourceUrl || undefined}>
          {sourceUrl ? (
            <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
              {displayText}
            </a>
          ) : (
            '—'
          )}
        </span>
      </div>
    </div>
  );
}

export default MetricLivePrice;
