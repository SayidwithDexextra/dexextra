'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { getSupabaseClient } from '@/lib/supabase-browser';

interface SettlementMarket {
  id: string;
  symbol: string;
  market_identifier: string;
  proposed_settlement_value: number;
  proposed_settlement_at: string;
  settlement_window_expires_at: string;
  proposed_settlement_by: string;
  alternative_settlement_value?: number;
  alternative_settlement_at?: string;
  alternative_settlement_by?: string;
  settlement_disputed: boolean;
  market_config?: {
    ai_source_locator?: {
      url?: string;
      primary_source_url?: string;
    };
  };
}

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
    market?.market_config?.ai_source_locator?.url ||
    market?.market_config?.ai_source_locator?.primary_source_url;

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

  const statusDotClass = isExpired
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
                Settlement Window
              </span>
              <span className="text-[10px] text-[#606060]">•</span>
              <span className="text-[10px] text-white font-mono truncate">{market.symbol}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {isExpired ? 'Expired' : timeRemaining || '—'}
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
                <span className="text-[11px] font-medium text-[#808080]">Proposed Settlement</span>
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

        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Evidence Source</span>
              </div>
            </div>
            {sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[10px] text-blue-400 hover:text-blue-300 underline truncate max-w-[140px]"
              >
                {sourceHost}
              </a>
            )}
          </div>
          <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
            <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
              <div className="text-[9px] pt-1.5 text-[#606060]">
                {sourceUrl
                  ? 'Primary metric source archived when settlement started.'
                  : 'No primary source attached.'}
              </div>
            </div>
          </div>
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

      <div className="grid gap-1 md:grid-cols-2">
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Challenge Settlement</span>
              </div>
            </div>
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
            </div>
          </div>
        </div>

        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Settlement Status</span>
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
                Final settlement execution is handled by protocol operators once the challenge window closes.
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
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-green-400" />
              24h challenge window after primary submission.
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-blue-400" />
              UMA bond and archived data secure the process.
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-1 h-1 rounded-full bg-yellow-400" />
              Window expiry or acceptance finalizes the market.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default SettlementInterface;
