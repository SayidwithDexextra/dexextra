'use client';

import React from 'react';
import { useMetricLivePrice } from '../../hooks/useMetricLivePrice';
import { getSupabaseClient } from '../../lib/supabase-browser';
import { useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import { getReadProvider } from '@/lib/network';
import { MarketLifecycleFacetABI } from '@/lib/contracts';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

export interface MetricLivePriceProps {
  marketId?: string;
  token?: string;
  marketIdentifier?: string; // legacy prop alias for token
  className?: string;
  label?: string;            // legacy UI label
  prefix?: string;           // display prefix, e.g. '$'
  suffix?: string;           // display suffix
  isLive?: boolean;          // legacy flag for UI badge
  compact?: boolean;         // compact spacing
  value?: number | string;   // initial fallback value to display
  isSettlementWindow?: boolean; // optional override: when true, show settlement UI
  onOpenSettlement?: () => void; // optional callback to trigger settlement slide-in
  url?: string;              // optional metric source url (legacy props for compatibility)
  cssSelector?: string;
  xpath?: string;
  jsExtractor?: string;
  htmlSnippet?: string;
  pollIntervalMs?: number;
  /**
   * When true, attempts to subscribe to live metric values and start the worker.
   * Default false because most UIs only need to display the source URL.
   */
  enableLiveMetric?: boolean;
}

export function MetricLivePrice(props: MetricLivePriceProps) {
  const {
    marketId,
    token,
    marketIdentifier,
    className = '',
    label = 'Metric Info',
    prefix = '',
    suffix = '',
    isLive = true,
    compact = true,
    value: initialValue,
    isSettlementWindow,
    onOpenSettlement,
    enableLiveMetric = false,
  } = props;

  const router = useRouter();
  const supabase = getSupabaseClient();
  const [resolvedId, setResolvedId] = React.useState<string | null>(marketId || null);
  const [sourceUrl, setSourceUrl] = React.useState<string | null>(null);
  const [settlementExpiresAt, setSettlementExpiresAt] = React.useState<string | null>(null);
  // On-chain status (null = unknown)
  const [isSettlementActiveOnChain, setIsSettlementActiveOnChain] = React.useState<boolean | null>(null);
  // DB-derived fallback (for legacy behavior)
  const [isSettlementActiveDb, setIsSettlementActiveDb] = React.useState<boolean>(false);
  // Market (diamond) address to call lifecycle facet on
  const [marketAddress, setMarketAddress] = React.useState<string | null>(null);
  const handleOpenSettlement = React.useCallback(() => {
    if (onOpenSettlement) {
      onOpenSettlement();
      return;
    }
    router.push('/settlement');
  }, [onOpenSettlement, router]);

  React.useEffect(() => {
    let cancelled = false;
    const resolve = async () => {
      if (marketId) { setResolvedId(marketId); return; }
      const t = token || marketIdentifier;
      if (!t) { setResolvedId(null); return; }
      try {
        console.log('[MetricLivePrice] resolving marketId from token', t);
        const { data, error } = await supabase
          .from('markets')
          .select('id')
          .or(`market_identifier.eq.${t},symbol.eq.${t}`)
          .maybeSingle();
        if (!cancelled) {
          if (error) {
            console.log('[MetricLivePrice] resolve error', error.message);
            setResolvedId(null);
          } else {
            console.log('[MetricLivePrice] resolved id', data?.id);
            setResolvedId(data?.id ?? null);
          }
        }
      } catch {
        if (!cancelled) setResolvedId(null);
      }
    };
    resolve();
    return () => { cancelled = true; };
  }, [supabase, marketId, token, marketIdentifier]);

  const live = useMetricLivePrice(resolvedId || '', { enabled: Boolean(enableLiveMetric && resolvedId) });
  const { value: liveValue, updatedAt, isLoading, error, retryStartWorker } = live;
  const [retrying, setRetrying] = React.useState(false);

  const displayValue = React.useMemo(() => {
    const v = liveValue as any;
    const n = typeof v === 'number' ? v : (v != null ? Number(v) : NaN);
    if (Number.isFinite(n)) return n;
    return null;
  }, [liveValue]);

  const fallbackValue = React.useMemo(() => {
    const v = initialValue as any;
    const n = typeof v === 'number' ? v : (v != null ? Number(v) : NaN);
    return Number.isFinite(n) ? n : null;
  }, [initialValue]);

  const valueToShow = displayValue ?? fallbackValue;

  const formattedValue = React.useMemo(() => {
    if (valueToShow == null) return '—';
    const abs = Math.abs(valueToShow);
    const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
    return `${valueToShow.toFixed(decimals)}`;
  }, [valueToShow]);

  const valueText = React.useMemo(() => {
    return formattedValue === '—' ? '—' : `${prefix}${formattedValue}${suffix}`;
  }, [formattedValue, prefix, suffix]);

  // Load locator URL for fallback display when no live value yet
  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!resolvedId) { setSourceUrl(null); return; }
      try {
        const { data, error } = await supabase
          .from('markets')
          .select('market_config, initial_order, proposed_settlement_value, settlement_window_expires_at, market_address, chain_id')
          .eq('id', resolvedId)
          .maybeSingle();
        if (cancelled) return;
        if (error) { setSourceUrl(null); return; }
        // Check for metric URL in initial_order first (primary source)
        const initialOrderMetricUrl = (data as any)?.initial_order?.metricUrl || (data as any)?.initial_order?.metric_url || null;
        if (initialOrderMetricUrl) {
          setSourceUrl(initialOrderMetricUrl);
        } else {
          // Fallback to market_config.ai_source_locator
          const loc = (data as any)?.market_config?.ai_source_locator || null;
          const url = loc?.url || loc?.primary_source_url || null;
          setSourceUrl(url || null);
        }

        // Store market address for on-chain reads (preferred source of truth)
        const addr = (data as any)?.market_address as string | undefined;
        if (addr && typeof addr === 'string' && addr.startsWith('0x') && addr.length === 42) {
          setMarketAddress(addr);
        } else {
          // Fallback to in-memory contract config mapping if available by symbol
          const t = (token || marketIdentifier || '').toString().toUpperCase();
          if (t && (CONTRACT_ADDRESSES as any).MARKET_INFO && (CONTRACT_ADDRESSES as any).MARKET_INFO[t]?.orderBook) {
            const ob = (CONTRACT_ADDRESSES as any).MARKET_INFO[t].orderBook as string;
            if (ob && ob.startsWith('0x') && ob.length === 42) setMarketAddress(ob);
          } else {
            setMarketAddress(null);
          }
        }

        // Legacy DB-derived settlement window (used as a fallback if chain read fails)
        const proposed = (data as any)?.proposed_settlement_value;
        const expiresAt = (data as any)?.settlement_window_expires_at || null;
        setSettlementExpiresAt(expiresAt);
        if (proposed != null && expiresAt) {
          try {
            const active = new Date(expiresAt).getTime() > Date.now();
            setIsSettlementActiveDb(Boolean(active));
          } catch {
            setIsSettlementActiveDb(false);
          }
        } else {
          setIsSettlementActiveDb(false);
        }
      } catch { setSourceUrl(null); }
    };
    load();
    return () => { cancelled = true; };
  }, [supabase, resolvedId]);

  // On-chain lifecycle facet read (preferred)
  React.useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const run = async () => {
      if (!marketAddress) {
        setIsSettlementActiveOnChain(null);
        return;
      }
      try {
        const provider = getReadProvider();
        const lifecycle = new ethers.Contract(marketAddress, MarketLifecycleFacetABI, provider);
        const [inChallenge, settlementTs] = await Promise.all([
          lifecycle.isInSettlementChallengeWindow(),
          lifecycle.getSettlementTimestamp(),
        ]);
        if (cancelled) return;
        const active = Boolean(inChallenge);
        setIsSettlementActiveOnChain(active);
        // settlementTs is bigint (seconds)
        if (typeof settlementTs === 'bigint' && settlementTs > 0n) {
          const asMs = Number(settlementTs) * 1000;
          if (Number.isFinite(asMs)) {
            setSettlementExpiresAt(new Date(asMs).toISOString());
          }
        }
      } catch (e) {
        if (!cancelled) {
          // If chain read fails, keep previous value; do not crash UI
          setIsSettlementActiveOnChain(null);
        }
      }
    };
    void run();
    // Re-check periodically to keep UI accurate near window boundaries
    timer = setInterval(run, 30000);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [marketAddress]);

  const hasError = Boolean(enableLiveMetric && error);
  const isUsingFallback = displayValue == null && fallbackValue != null;
  const handleRetry = async () => {
    if (!resolvedId) return;
    if (!enableLiveMetric) return;
    setRetrying(true);
    try {
      await retryStartWorker();
    } finally {
      setRetrying(false);
    }
  };

  // Compute conditional rendering precedence:
  // 1) Explicit prop override (if provided)
  // 2) On-chain facet read (authoritative)
  // 3) DB-derived fallback (legacy)
  const settlementUIActive = (typeof isSettlementWindow === 'boolean')
    ? isSettlementWindow
    : (isSettlementActiveOnChain ?? isSettlementActiveDb);

  return (
    <div
      className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 ${className}`}
      title={updatedAt || undefined}
    >
      <div className={`flex items-center justify-between ${compact ? 'p-2' : 'p-2.5'}`}>
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            isLoading
              ? 'bg-blue-400 animate-pulse'
              : hasError
                ? 'bg-red-400'
              : settlementUIActive
                ? 'bg-yellow-400'
                : (isLive ? 'bg-green-400' : 'bg-[#404040]')
          }`} />
          <span className="text-[11px] font-medium text-[#808080] leading-none">{label}</span>
        </div>
        <div className="flex items-center gap-2 h-5">
          {settlementUIActive ? (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-yellow-300 leading-none">
                Settlement window active
              </span>
              <button
                onClick={handleOpenSettlement}
                className="h-5 w-5 box-border flex items-center justify-center rounded-md hover:bg-yellow-500/10 border border-yellow-500/30 text-yellow-300 hover:text-yellow-200 transition-all"
                title={settlementExpiresAt ? `Go to settlement (window ends ${new Date(settlementExpiresAt).toLocaleString()})` : 'Go to settlement'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            </div>
          ) : valueToShow != null ? (
            <span
              className={`text-[10px] font-mono leading-none ${isUsingFallback ? 'text-[#CBD5E1]' : 'text-white'}`}
              title={isUsingFallback ? 'Showing fallback price (live metric unavailable)' : undefined}
            >
              {valueText}
            </span>
          ) : (
            <span className="text-[9px] text-[#8a8a8a] leading-none truncate max-w-[180px]">
              {sourceUrl ? (
                <a href={sourceUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  {(() => { try { const u = new URL(sourceUrl); return u.hostname; } catch { return sourceUrl.length > 48 ? sourceUrl.slice(0,48) + '…' : sourceUrl; } })()}
                </a>
              ) : '—'}
            </span>
          )}

          {hasError && !settlementUIActive && (
            <>
              <span
                className="text-[10px] text-red-400 leading-none"
                title={error || 'Live metric unavailable'}
              >
                ⚠
              </span>
              <button
                onClick={handleRetry}
                disabled={retrying}
                className={`h-5 w-5 box-border flex items-center justify-center rounded-md border transition-all ${
                  retrying
                    ? 'border-blue-400/30 text-blue-300 bg-blue-500/10'
                    : 'border-[#333333] text-[#CBD5E1] hover:text-white hover:bg-[#1A1A1A]'
                }`}
                title={retrying ? 'Retrying…' : 'Retry live metric worker'}
              >
                <span className={`text-[11px] ${retrying ? 'animate-spin' : ''}`}>⟳</span>
              </button>
            </>
          )}

          {isLoading && !settlementUIActive && (
            <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
              <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
            </div>
          )}
        </div>
      </div>
      <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
        <div className={`${compact ? 'px-2' : 'px-2.5'} pb-2 border-t border-[#1A1A1A]`}>
          <div className="text-[9px] pt-1.5">
            <span className="text-[#606060]">
              {hasError
                ? `Live metric unavailable — showing fallback.`
                : (updatedAt ? `Updated ${new Date(updatedAt).toLocaleString()}` : 'No update yet')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default MetricLivePrice;


