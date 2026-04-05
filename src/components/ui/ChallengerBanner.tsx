'use client';

import React from 'react';
import { useChallengerInfo, type ChallengerInfo } from '@/hooks/useChallengerInfo';

interface ChallengerBannerProps {
  /** The market contract address to read challenge info from */
  marketAddress: string | null | undefined;
  /** Optional class name for styling */
  className?: string;
  /** Compact mode shows less detail */
  compact?: boolean;
  /** Custom polling interval (default: 15000ms) */
  pollInterval?: number;
}

const formatAddress = (addr: string | null) => {
  if (!addr) return '—';
  return addr.length <= 10 ? addr : `${addr.slice(0, 6)}...${addr.slice(-4)}`;
};

/**
 * Displays a banner showing who challenged a market and their bond amount.
 * Reads directly from the HyperLiquid market contract.
 * 
 * NOTE: Currently using ETH testnet. When migrating to HyperLiquid mainnet,
 * update the viem client configuration. The contract interface remains the same.
 * 
 * @example
 * ```tsx
 * <ChallengerBanner marketAddress={market.market_address} />
 * ```
 */
export function ChallengerBanner({
  marketAddress,
  className = '',
  compact = false,
  pollInterval = 15_000,
}: ChallengerBannerProps) {
  const { data, isLoading, error } = useChallengerInfo(marketAddress, { pollInterval });

  if (!marketAddress || isLoading) {
    return null;
  }

  if (error || !data || !data.hasActiveChallenge) {
    return null;
  }

  const { challengerAddress, challengedPrice, bondEscrowed, resolved, challengerWon } = data;

  if (compact) {
    return (
      <div className={`flex items-center gap-2 text-xs ${className}`}>
        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${resolved ? (challengerWon ? 'bg-green-400' : 'bg-red-400') : 'bg-yellow-400 animate-pulse'}`} />
        <span className="text-[#808080]">
          Disputed by <span className="text-white font-mono">{formatAddress(challengerAddress)}</span>
        </span>
        <span className="text-[#606060]">•</span>
        <span className="text-[#808080]">
          Bond: <span className="text-white font-mono">${bondEscrowed.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
        </span>
      </div>
    );
  }

  return (
    <div className={`group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border transition-all duration-200 relative overflow-hidden ${
      resolved
        ? challengerWon
          ? 'border-green-500/20 hover:border-green-500/30'
          : 'border-red-500/20 hover:border-red-500/30'
        : 'border-yellow-500/20 hover:border-yellow-500/30'
    } ${className}`}>
      <div className={`absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r ${
        resolved
          ? challengerWon
            ? 'from-green-500 to-emerald-500'
            : 'from-red-500 to-rose-500'
          : 'from-yellow-400 to-amber-500'
      }`} />

      <div className="flex items-center justify-between p-2.5">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
            resolved ? (challengerWon ? 'bg-green-400' : 'bg-red-400') : 'bg-yellow-400 animate-pulse'
          }`} />
          <span className="text-[11px] font-medium text-[#808080]">
            {resolved ? 'Challenge Resolved' : 'Active Challenge'}
          </span>
        </div>
        <div className={`text-[10px] px-1.5 py-0.5 rounded ${
          resolved
            ? challengerWon
              ? 'text-green-400 bg-green-500/10'
              : 'text-red-400 bg-red-500/10'
            : 'text-yellow-400 bg-yellow-500/10'
        }`}>
          {resolved ? (challengerWon ? 'Challenger Won' : 'Proposer Won') : 'Pending'}
        </div>
      </div>

      <div className="px-2.5 pb-2.5 border-t border-[#1A1A1A]">
        <div className="pt-2 space-y-1.5 text-[10px]">
          <div className="flex justify-between items-center">
            <span className="text-[#606060]">Challenger</span>
            <span className="text-white font-mono">{formatAddress(challengerAddress)}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#606060]">Proposed Price</span>
            <span className="text-white font-mono">
              ${challengedPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[#606060]">Bond Escrowed</span>
            <span className="text-white font-mono">
              ${bondEscrowed.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
            </span>
          </div>
          {resolved && (
            <div className="flex justify-between items-center pt-1 border-t border-[#1A1A1A]">
              <span className="text-[#606060]">Outcome</span>
              <span className={`font-medium ${challengerWon ? 'text-green-400' : 'text-red-400'}`}>
                {challengerWon ? 'Bond Refunded' : 'Bond Slashed'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * A minimal inline badge showing challenger info.
 * Use this for tight spaces like table rows or compact cards.
 */
export function ChallengerBadge({
  marketAddress,
  className = '',
}: Pick<ChallengerBannerProps, 'marketAddress' | 'className'>) {
  const { data } = useChallengerInfo(marketAddress, { pollInterval: 30_000 });

  if (!data?.hasActiveChallenge) return null;

  return (
    <span className={`inline-flex items-center gap-1 text-[9px] px-1.5 py-0.5 rounded border ${
      data.resolved
        ? data.challengerWon
          ? 'border-green-500/30 bg-green-500/10 text-green-400'
          : 'border-red-500/30 bg-red-500/10 text-red-400'
        : 'border-yellow-500/30 bg-yellow-500/10 text-yellow-400'
    } ${className}`}>
      <span className={`w-1 h-1 rounded-full ${
        data.resolved ? (data.challengerWon ? 'bg-green-400' : 'bg-red-400') : 'bg-yellow-400'
      }`} />
      {data.resolved ? (data.challengerWon ? 'Overturned' : 'Upheld') : 'Disputed'}
    </span>
  );
}

/**
 * Inline text showing just the challenger address and bond.
 * For use in settings pages, notifications, or activity feeds.
 */
export function ChallengerInline({
  challengerInfo,
  className = '',
}: {
  challengerInfo: ChallengerInfo | null;
  className?: string;
}) {
  if (!challengerInfo?.hasActiveChallenge) return null;

  return (
    <span className={`text-[10px] text-[#808080] ${className}`}>
      Challenged by{' '}
      <span className="text-white font-mono">{formatAddress(challengerInfo.challengerAddress)}</span>
      {' '}with{' '}
      <span className="text-white font-mono">
        ${challengerInfo.bondEscrowed.toLocaleString(undefined, { minimumFractionDigits: 2 })} USDC
      </span>
      {' '}bond
    </span>
  );
}

export default ChallengerBanner;
