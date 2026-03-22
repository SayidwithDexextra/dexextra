'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient } from '@/lib/supabase-browser';
import { publicClient } from '@/lib/viemClient';

interface SettlementMarket {
  id: string;
  symbol: string;
  market_identifier: string;
  market_status?: string;
  market_address?: string;
  proposed_settlement_value: number;
  proposed_settlement_at: string;
  settlement_window_expires_at: string;
  proposed_settlement_by: string;
  alternative_settlement_value?: number;
  alternative_settlement_at?: string;
  alternative_settlement_by?: string;
  settlement_disputed: boolean;
  ai_source_locator?: {
    url?: string;
    primary_source_url?: string;
    [key: string]: unknown;
  } | null;
  market_config?: {
    settlement_wayback_url?: string;
    settlement_wayback_page_url?: string;
    settlement_screenshot_url?: string;
  };
}

interface OnChainSettlementState {
  lifecycleState: number;
  challengeBondAmount: number;
  slashRecipient: string;
  challengeActive: boolean;
  challenger: string;
  challengedPrice: number;
  bondEscrowed: number;
  challengeResolved: boolean;
  challengerWon: boolean;
  evidenceHash: string;
  evidenceUrl: string;
}

const LIFECYCLE_LABELS: Record<number, string> = {
  0: 'Unsettled',
  1: 'Rollover',
  2: 'Challenge Window',
  3: 'Settled',
};

const LIFECYCLE_STATE_ABI = [{ type: 'function' as const, name: 'getLifecycleState' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint8', name: '' }] }] as const;
const CHALLENGE_BOND_CONFIG_ABI = [{ type: 'function' as const, name: 'getChallengeBondConfig' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'uint256', name: 'bondAmount' }, { type: 'address', name: 'slashRecipient' }] }] as const;
const ACTIVE_CHALLENGE_ABI = [{ type: 'function' as const, name: 'getActiveChallengeInfo' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'bool', name: 'active' }, { type: 'address', name: 'challengerAddr' }, { type: 'uint256', name: 'challengedPriceVal' }, { type: 'uint256', name: 'bondEscrowed' }, { type: 'bool', name: 'resolved' }, { type: 'bool', name: 'won' }] }] as const;
const PROPOSED_EVIDENCE_ABI = [{ type: 'function' as const, name: 'getProposedEvidence' as const, stateMutability: 'view' as const, inputs: [], outputs: [{ type: 'bytes32', name: 'evidenceHash' }, { type: 'string', name: 'evidenceUrl' }] }] as const;

interface SettlementInterfaceProps {
  market?: SettlementMarket;
  className?: string;
  onChallengeSaved?: () => void;
}

const formatAddress = (addr?: string | null) => {
  if (!addr || typeof addr !== 'string') return '—';
  return addr.length <= 10 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

export function SettlementInterface({
  market,
  className = '',
  onChallengeSaved,
}: SettlementInterfaceProps) {
  const { walletData } = useWallet();
  const supabase = getSupabaseClient();
  const [challengePrice, setChallengePrice] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState<string>('');
  const walletLabel = walletData?.address ? formatAddress(walletData.address) : 'Connect wallet';
  const [challengeNotice, setChallengeNotice] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [onChain, setOnChain] = useState<OnChainSettlementState | null>(null);
  const [onChainError, setOnChainError] = useState(false);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchOnChainState = useCallback(async (addr: `0x${string}`) => {
    try {
      const [lcRaw, bcRaw, acRaw, evRaw] = await Promise.all([
        publicClient.readContract({ address: addr, abi: LIFECYCLE_STATE_ABI, functionName: 'getLifecycleState', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: CHALLENGE_BOND_CONFIG_ABI, functionName: 'getChallengeBondConfig', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: ACTIVE_CHALLENGE_ABI, functionName: 'getActiveChallengeInfo', args: [] }).catch(() => null),
        publicClient.readContract({ address: addr, abi: PROPOSED_EVIDENCE_ABI, functionName: 'getProposedEvidence', args: [] }).catch(() => null),
      ]);

      if (lcRaw == null && bcRaw == null && acRaw == null && evRaw == null) {
        setOnChainError(true);
        return;
      }

      const lc = lcRaw as any;
      const bc = bcRaw as any;
      const ac = acRaw as any;
      const ev = evRaw as any;

      setOnChain({
        lifecycleState: lc != null ? Number(lc) : 0,
        challengeBondAmount: bc ? Number(bc[0] ?? 0n) / 1e6 : 0,
        slashRecipient: bc ? String(bc[1] || '') : '',
        challengeActive: ac ? Boolean(ac[0]) : false,
        challenger: ac ? String(ac[1] || '') : '',
        challengedPrice: ac ? Number(ac[2] ?? 0n) / 1e6 : 0,
        bondEscrowed: ac ? Number(ac[3] ?? 0n) / 1e6 : 0,
        challengeResolved: ac ? Boolean(ac[4]) : false,
        challengerWon: ac ? Boolean(ac[5]) : false,
        evidenceHash: ev ? String(ev[0] || '') : '',
        evidenceUrl: ev ? String(ev[1] || '') : '',
      });
      setOnChainError(false);
    } catch {
      setOnChainError(true);
    }
  }, []);

  useEffect(() => {
    const addr = market?.market_address;
    if (!addr || typeof addr !== 'string' || !addr.startsWith('0x') || addr.length !== 42) return;

    let cancelled = false;
    const poll = async () => {
      await fetchOnChainState(addr as `0x${string}`);
      if (!cancelled) {
        pollRef.current = setTimeout(poll, 15_000);
      }
    };
    void poll();
    return () => {
      cancelled = true;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [market?.market_address, fetchOnChainState]);

  useEffect(() => {
    if (!market?.settlement_window_expires_at) return;
    const updateTimer = () => {
      const expires = new Date(market.settlement_window_expires_at).getTime();
      const diff = expires - Date.now();
      if (diff <= 0) {
        setTimeRemaining('Expired');
        return;
      }
      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);
      setTimeRemaining(`${hours}h ${minutes}m ${seconds}s`);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [market?.settlement_window_expires_at]);

  const handleChallenge = async () => {
    if (!challengePrice) return;
    const price = Number(challengePrice);
    if (price <= 0 || !Number.isFinite(price)) {
      setChallengeNotice({ type: 'error', text: 'Enter a valid positive price.' });
      return;
    }
    if (!walletData?.address) {
      setChallengeNotice({ type: 'error', text: 'Connect a wallet to submit a challenge.' });
      return;
    }
    if (!market?.id) {
      setChallengeNotice({ type: 'error', text: 'Market unavailable.' });
      return;
    }
    if (isExpired) {
      setChallengeNotice({ type: 'error', text: 'Settlement window already expired.' });
      return;
    }

    try {
      setIsSubmitting(true);
      setChallengeNotice(null);
      const nowIso = new Date().toISOString();
      const updateData = {
        alternative_settlement_value: price,
        alternative_settlement_at: nowIso,
        alternative_settlement_by: walletData.address,
        settlement_disputed: true,
        updated_at: nowIso,
      };
      const { error } = await supabase
        .from('markets')
        .update(updateData)
        .eq('id', market.id)
        .select('id')
        .single();
      if (error) {
        setChallengeNotice({ type: 'error', text: error.message || 'Failed to save challenge.' });
        return;
      }
      setChallengePrice('');
      setChallengeNotice({ type: 'success', text: 'Alternative price saved to Supabase.' });
      onChallengeSaved?.();
    } finally {
      setIsSubmitting(false);
    }
  };

  const isExpired = Boolean(
    market?.settlement_window_expires_at &&
      new Date(market.settlement_window_expires_at).getTime() <= Date.now(),
  );

  const sourceUrl =
    market?.ai_source_locator?.url ||
    market?.ai_source_locator?.primary_source_url;

  const settlementWaybackUrl = market?.market_config?.settlement_wayback_url || null;
  const settlementWaybackPageUrl = market?.market_config?.settlement_wayback_page_url || null;
  const settlementScreenshotUrl = market?.market_config?.settlement_screenshot_url || null;
  const [screenshotExpanded, setScreenshotExpanded] = useState(false);

  const formattedProposed = useMemo(() => {
    if (typeof market?.proposed_settlement_value === 'number') {
      return market.proposed_settlement_value.toFixed(4);
    }
    if (market?.proposed_settlement_value == null) {
      return '0.0000';
    }
    const value = Number(market.proposed_settlement_value);
    return Number.isFinite(value) ? value.toFixed(4) : '0.0000';
  }, [market?.proposed_settlement_value]);

  const formattedChallenge = useMemo(() => {
    if (typeof market?.alternative_settlement_value === 'number') {
      return market.alternative_settlement_value.toFixed(4);
    }
    if (market?.alternative_settlement_value == null) {
      return null;
    }
    const value = Number(market.alternative_settlement_value);
    return Number.isFinite(value) ? value.toFixed(4) : null;
  }, [market?.alternative_settlement_value]);

  const baseChallengeHelper = !walletData?.address
    ? 'Connect a wallet to post a challenge with UMA collateral.'
    : isSubmitting
      ? 'Submitting challenge...'
      : 'Submit an alternative USDC price (6 decimals) before the window closes.';

  const helperText = challengeNotice?.text ?? baseChallengeHelper;
  const helperColor =
    challengeNotice?.type === 'error'
      ? 'text-red-400'
      : challengeNotice?.type === 'success'
        ? 'text-[#9CA3AF]'
        : 'text-[#606060]';

  const sourceHost = useMemo(() => {
    if (!sourceUrl) return null;
    try {
      const url = new URL(sourceUrl);
      return url.hostname;
    } catch {
      return sourceUrl.replace(/^https?:\/\//, '');
    }
  }, [sourceUrl]);

  if (!market) {
    return (
      <div className={`min-h-[60vh] flex items-center justify-center ${className}`}>
        <div className="w-full max-w-sm rounded-2xl border border-white/10 bg-[#0A0A0A] p-5">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            <div className="text-[11px] font-medium uppercase tracking-[0.3em] text-[#7E7E7E]">
              Loading settlement data
            </div>
          </div>
          <p className="mt-3 text-sm text-[#9CA3AF]">
            Fetching current settlement window, proposals, and archived sources.
          </p>
        </div>
      </div>
    );
  }

  const isSettled = market?.market_status === 'SETTLED';

  const statusDotClass = isSettled
    ? 'bg-blue-400'
    : isExpired
      ? 'bg-red-400'
      : market?.settlement_disputed
        ? 'bg-yellow-400'
        : 'bg-green-400';

  return (
    <div className={`space-y-1 ${className}`}>
      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="flex items-center justify-between p-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusDotClass}`} />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[11px] font-medium text-[#9CA3AF] uppercase tracking-wide">
                {isSettled ? 'Settlement Result' : 'Settlement Window'}
              </span>
              <span className="text-[10px] text-[#606060]">•</span>
              <span className="text-[10px] text-white font-mono truncate">{market.symbol}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className={`text-[10px] bg-[#1A1A1A] px-1.5 py-0.5 rounded ${isSettled ? 'text-blue-400' : 'text-[#606060]'}`}>
              {isSettled ? 'Finalized' : isExpired ? 'Expired' : timeRemaining || '—'}
            </div>
            <div className={`w-1.5 h-1.5 rounded-full ${statusDotClass}`} />
          </div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5 text-[#606060]">
              Market ID: <span className="text-white font-mono">{market.market_identifier}</span>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-1 md:grid-cols-2">
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">{isSettled ? 'Final Price' : 'Proposed Settlement'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white font-mono">${formattedProposed}</span>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                Primary
              </div>
            </div>
          </div>
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                <div className="flex justify-between">
                  <span>Submitted</span>
                  <span className="text-white font-mono">
                    {market.proposed_settlement_at
                      ? new Date(market.proposed_settlement_at).toLocaleString()
                      : '—'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span>Window Expires</span>
                  <span className="text-white font-mono">
                    {market.settlement_window_expires_at
                      ? new Date(market.settlement_window_expires_at).toLocaleString()
                      : 'Awaiting activation'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Evidence Source</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {sourceUrl && (
                <a
                  href={sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-400 hover:text-blue-300 underline truncate max-w-[120px]"
                >
                  {sourceHost}
                </a>
              )}
              {settlementWaybackUrl && (
                <a
                  href={settlementWaybackUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-emerald-400/80 hover:text-emerald-300 flex items-center gap-1"
                  title="Archived screenshot on Wayback Machine"
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M2 13h12M3 3h10M4 3v10M12 3v10M8 3v10M2 8h12M5.5 3v10M10.5 3v10" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <span className="underline">Snapshot</span>
                </a>
              )}
              {settlementWaybackPageUrl && (
                <a
                  href={settlementWaybackPageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-amber-400/70 hover:text-amber-300 flex items-center gap-1"
                  title="Archived source page on Wayback Machine"
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M3 2h7l3 3v9H3V2z" stroke="currentColor" strokeWidth="1" strokeLinejoin="round"/>
                    <path d="M10 2v3h3M5 8h6M5 10.5h6" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
                  </svg>
                  <span className="underline">Page</span>
                </a>
              )}
              {settlementScreenshotUrl && (
                <button
                  onClick={() => setScreenshotExpanded(!screenshotExpanded)}
                  className="text-[10px] text-[#9CA3AF] hover:text-white flex items-center gap-1 transition-colors"
                >
                  <svg className="w-3 h-3" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <rect x="2" y="3" width="12" height="10" rx="1" stroke="currentColor" strokeWidth="1"/>
                    <circle cx="5.5" cy="6.5" r="1" stroke="currentColor" strokeWidth="0.75"/>
                    <path d="M2 11l3-3 2 2 3-4 4 5" stroke="currentColor" strokeWidth="0.75" strokeLinejoin="round"/>
                  </svg>
                  <span>{screenshotExpanded ? 'Hide' : 'View'}</span>
                </button>
              )}
            </div>
          </div>

          {settlementScreenshotUrl && screenshotExpanded && (
            <div className="px-2.5 pb-2.5 border-t border-[#1A1A1A]">
              <a
                href={settlementScreenshotUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block mt-2 rounded overflow-hidden border border-[#222222] hover:border-[#444444] transition-colors"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={settlementScreenshotUrl}
                  alt="Settlement metric source screenshot"
                  className="w-full h-auto"
                  loading="lazy"
                />
              </a>
              <div className="text-[9px] text-[#606060] mt-1.5">
                Screenshot captured by AI at settlement time. Click to open full size.
              </div>
            </div>
          )}

          {!screenshotExpanded && (
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-0.5">
                {settlementWaybackUrl && (
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-1 rounded-full bg-emerald-400/60" />
                    Screenshot archived to Wayback Machine at settlement time.
                  </div>
                )}
                {settlementWaybackPageUrl && (
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-1 rounded-full bg-amber-400/60" />
                    Original source page archived to Wayback Machine.
                  </div>
                )}
                {settlementScreenshotUrl && !settlementWaybackUrl && !settlementWaybackPageUrl && (
                  <div className="flex items-center gap-1">
                    <div className="w-1 h-1 rounded-full bg-blue-400/60" />
                    AI screenshot available. Click View to inspect.
                  </div>
                )}
                {!settlementWaybackUrl && !settlementWaybackPageUrl && !settlementScreenshotUrl && sourceUrl && (
                  <div>Live metric source. No archive available.</div>
                )}
                {!settlementWaybackUrl && !settlementWaybackPageUrl && !settlementScreenshotUrl && !sourceUrl && (
                  <div>No primary source attached.</div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {formattedChallenge && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Challenge Proposal</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-white font-mono">${formattedChallenge}</span>
              <div className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">Disputed</div>
            </div>
          </div>
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                <div className="flex justify-between">
                  <span>Challenged By</span>
                  <span className="text-white font-mono">{formatAddress(market.alternative_settlement_by)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Timestamp</span>
                  <span className="text-white font-mono">
                    {market.alternative_settlement_at
                      ? new Date(market.alternative_settlement_at).toLocaleString()
                      : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* On-Chain Verification State */}
      {onChain && !onChainError && (
        <div className="grid gap-1 md:grid-cols-2">
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${onChain.lifecycleState === 3 ? 'bg-blue-400' : onChain.lifecycleState === 2 ? 'bg-yellow-400' : 'bg-green-400'}`} />
                <span className="text-[11px] font-medium text-[#808080]">On-Chain Lifecycle</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white font-mono">
                  {LIFECYCLE_LABELS[onChain.lifecycleState] ?? `State ${onChain.lifecycleState}`}
                </span>
                <div className="text-[10px] text-purple-400/80 bg-purple-500/10 px-1.5 py-0.5 rounded">On-Chain</div>
              </div>
            </div>
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                {onChain.challengeBondAmount > 0 && (
                  <div className="flex justify-between">
                    <span>Challenge Bond Required</span>
                    <span className="text-white font-mono">${onChain.challengeBondAmount.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC</span>
                  </div>
                )}
                {onChain.slashRecipient && onChain.slashRecipient !== '0x0000000000000000000000000000000000000000' && (
                  <div className="flex justify-between">
                    <span>Slash Recipient</span>
                    <span className="text-white font-mono">{formatAddress(onChain.slashRecipient)}</span>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${onChain.evidenceHash && onChain.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? 'bg-emerald-400' : 'bg-[#404040]'}`} />
                <span className="text-[11px] font-medium text-[#808080]">Evidence Commitment</span>
              </div>
              <div className="text-[10px] text-purple-400/80 bg-purple-500/10 px-1.5 py-0.5 rounded">On-Chain</div>
            </div>
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
                {onChain.evidenceHash && onChain.evidenceHash !== '0x0000000000000000000000000000000000000000000000000000000000000000' ? (
                  <>
                    <div className="flex justify-between">
                      <span>Hash</span>
                      <span className="text-white font-mono text-[8px] truncate max-w-[180px]" title={onChain.evidenceHash}>
                        {onChain.evidenceHash.slice(0, 10)}...{onChain.evidenceHash.slice(-8)}
                      </span>
                    </div>
                    {onChain.evidenceUrl && (
                      <div className="flex justify-between items-center">
                        <span>Archived Source</span>
                        <a
                          href={onChain.evidenceUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate max-w-[180px]"
                        >
                          Wayback Archive
                        </a>
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-[#404040]">No evidence committed on-chain yet.</div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* On-Chain Active Challenge */}
      {onChain && onChain.challengeActive && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-red-500/30 hover:border-red-500/50 transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400 animate-pulse" />
              <span className="text-[11px] font-medium text-[#808080]">On-Chain Challenge</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-red-400 font-mono">
                ${onChain.challengedPrice.toLocaleString(undefined, { minimumFractionDigits: 4 })}
              </span>
              <div className="text-[10px] text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                {onChain.challengeResolved ? (onChain.challengerWon ? 'Won' : 'Slashed') : 'Active'}
              </div>
            </div>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5 text-[#606060] space-y-1">
              <div className="flex justify-between">
                <span>Challenger</span>
                <span className="text-white font-mono">{formatAddress(onChain.challenger)}</span>
              </div>
              <div className="flex justify-between">
                <span>Bond Escrowed</span>
                <span className="text-white font-mono">${onChain.bondEscrowed.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC</span>
              </div>
              {onChain.challengeResolved && (
                <div className="flex justify-between">
                  <span>Outcome</span>
                  <span className={`font-mono ${onChain.challengerWon ? 'text-green-400' : 'text-red-400'}`}>
                    {onChain.challengerWon ? 'Bond refunded' : 'Bond slashed'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <div className={`grid gap-1 ${isSettled ? 'md:grid-cols-1' : 'md:grid-cols-2'}`}>
        {!isSettled && (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-[#808080]">Challenge Settlement</span>
                </div>
              </div>
              {onChain && onChain.challengeBondAmount > 0 && (
                <div className="text-[10px] text-yellow-400/80 bg-yellow-500/10 px-1.5 py-0.5 rounded">
                  Bond: ${onChain.challengeBondAmount.toLocaleString()} USDC
                </div>
              )}
            </div>
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="pt-2 space-y-2">
                <label className="text-[10px] uppercase tracking-wide text-[#606060]">
                  Alternative price (USDC)
                </label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[10px] text-[#606060]">
                    $
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder="0.0000"
                    value={challengePrice}
                    onChange={(e) => setChallengePrice(e.target.value)}
                    disabled={isSubmitting || isExpired}
                    className="w-full bg-[#0F0F0F] text-white text-[10px] border border-[#222222] rounded px-4 py-1.5 outline-none focus:border-[#333333] font-mono placeholder-[#404040] disabled:opacity-50"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleChallenge}
                    disabled={!challengePrice || isSubmitting || !walletData?.address || isExpired}
                    className="text-xs text-red-400 hover:text-red-300 disabled:text-[#404040]"
                  >
                    {isSubmitting ? 'Submitting…' : 'Submit challenge'}
                  </button>
                  <span className={`text-[9px] ${helperColor} flex-1`}>
                    {helperText}
                  </span>
                </div>
                {onChain && onChain.challengeBondAmount > 0 && (
                  <div className="text-[9px] text-yellow-400/60 flex items-center gap-1">
                    <svg className="w-3 h-3 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Challenging requires a ${onChain.challengeBondAmount.toLocaleString()} USDC on-chain bond. The bond is slashed if your challenge is rejected.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isSettled ? 'bg-blue-400' : 'bg-green-400'}`} />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">{isSettled ? 'Final Settlement' : 'Settlement Status'}</span>
              </div>
            </div>
            <span className="text-[10px] text-white font-mono">${formattedProposed}</span>
          </div>
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-[#606060]">Wallet</span>
                <span className="text-white font-mono">{walletLabel}</span>
              </div>
              <span className="text-[9px] text-[#606060] block">
                {isSettled
                  ? 'This market has been settled. The final price has been locked and positions resolved.'
                  : 'Final settlement execution is handled by protocol operators once the challenge window closes.'}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="flex items-center justify-between p-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span className="text-[11px] font-medium text-[#808080]">Settlement Process</span>
            </div>
          </div>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">Info</div>
        </div>
        <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
          <div className="text-[9px] pt-1.5 space-y-1 text-[#606060]">
            {isSettled ? (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400" />
                  Settlement finalized. Positions have been resolved at the final price.
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400" />
                  Archived evidence and screenshots are preserved for the record.
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-green-400" />
                  Challenge window active after primary submission.
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-blue-400" />
                  {onChain && onChain.challengeBondAmount > 0
                    ? `On-chain bond of $${onChain.challengeBondAmount.toLocaleString()} USDC required to challenge. Bond is slashed if incorrect.`
                    : 'On-chain bond and archived evidence secure the process.'}
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-purple-400" />
                  Evidence hash committed on-chain at proposal time for tamper-proof verification.
                </div>
                <div className="flex items-center gap-1.5">
                  <div className="w-1 h-1 rounded-full bg-yellow-400" />
                  Window expiry or acceptance finalizes the market.
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettlementInterface;
