'use client';

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import useWallet from '@/hooks/useWallet';
import { useMarketOverview } from '@/hooks/useMarketOverview';
import type { MarketOverviewRow } from '@/hooks/useMarketOverview';
import {
  getFromCacheOrStorage,
  setCache,
  isDataStale,
  CACHE_KEYS,
} from '@/lib/dataCache';

type WatchlistCacheData = {
  market_ids: string[];
  watched_user_ids: string[];
  watched_users: WatchedUser[];
};

type WatchedUser = {
  id: string;
  wallet_address: string;
  username?: string | null;
  display_name?: string | null;
  profile_image_url?: string | null;
};

type FooterWatchlistPopupProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function FooterWatchlistPopup({ isOpen, onClose }: FooterWatchlistPopupProps) {
  const router = useRouter();
  const { walletData } = useWallet();

  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);


  // Close on escape key
  useEffect(() => {
    if (!isOpen) return;
    
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Fetch watchlist ids for the connected wallet (with caching)
  useEffect(() => {
    const walletAddress = walletData?.address;
    if (!walletAddress || !isOpen) {
      return;
    }

    const cacheKey = CACHE_KEYS.WATCHLIST(walletAddress);

    // Load cached data immediately if available
    const cached = getFromCacheOrStorage<WatchlistCacheData>(cacheKey);
    if (cached) {
      setWatchlistIds(cached.market_ids);
      if (!isDataStale(cacheKey)) {
        setWatchlistLoading(false);
      }
    }

    const ctrl = new AbortController();
    const run = async () => {
      if (!cached) {
        setWatchlistLoading(true);
      }
      setWatchlistError(null);
      try {
        const res = await fetch(`/api/watchlist?wallet=${encodeURIComponent(walletAddress)}`, {
          signal: ctrl.signal,
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to fetch watchlist');
        }
        const ids = Array.isArray(json.market_ids) ? json.market_ids : [];
        const filteredIds = ids.filter((id: unknown) => typeof id === 'string');
        setWatchlistIds(filteredIds);

        // Update cache
        const existingCache = getFromCacheOrStorage<WatchlistCacheData>(cacheKey);
        setCache<WatchlistCacheData>(cacheKey, {
          market_ids: filteredIds,
          watched_user_ids: existingCache?.watched_user_ids || [],
          watched_users: existingCache?.watched_users || [],
        });
      } catch (e) {
        if ((e as any)?.name === 'AbortError') return;
        setWatchlistError((e as Error).message || 'Failed to fetch watchlist');
      } finally {
        setWatchlistLoading(false);
      }
    };

    run();
    return () => ctrl.abort();
  }, [walletData?.address, isOpen]);

  // Fetch market overview
  const { data: overview, isLoading: marketsLoading } = useMarketOverview({
    limit: 500,
    autoRefresh: false,
    realtime: false,
  });

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  const watchlistedRows = useMemo(() => {
    const rows = (overview as MarketOverviewRow[]) || [];
    if (!rows.length || watchlistSet.size === 0) return [];
    return rows.filter((row) => watchlistSet.has(String(row?.market_id || '')));
  }, [overview, watchlistSet]);

  // Get top 5 watchlist items
  const topWatchlistItems = useMemo(() => {
    return watchlistedRows.slice(0, 5);
  }, [watchlistedRows]);

  const handleNavigateToMarket = useCallback((row: MarketOverviewRow) => {
    router.push(`/token/${row.market_identifier || row.symbol}`);
    onClose();
  }, [router, onClose]);

  const handleNavigateToWatchlist = useCallback(() => {
    router.push('/watchlist');
    onClose();
  }, [router, onClose]);

  // Mock change percentage (same as watchlist page)
  const getChangePercent = useCallback((row: MarketOverviewRow) => {
    const hash = row.market_id?.split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0;
    return ((hash % 200) - 100) / 10;
  }, []);

  const formatPrice = (row: MarketOverviewRow) => {
    const price = (row.mark_price || 0) / 1_000_000;
    if (price === 0) return '$0.00';
    if (price < 0.01) return '< $0.01';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const isWalletConnected = Boolean(walletData?.address);
  const isLoading = watchlistLoading || marketsLoading;

  if (!isOpen) return null;

  return (
    <div
      className="absolute bottom-full left-0 mb-3.5 z-50"
      style={{
        minWidth: '300px',
        maxWidth: '340px',
      }}
    >
      {/* Main Container - Design System Pattern */}
      <div className="bg-[#0F0F0F] rounded-md border border-[#222222] overflow-hidden shadow-xl">
        {/* Header - Section Header Pattern */}
        <div className="flex items-center justify-between p-2.5 border-b border-[#1A1A1A]">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
            Watchlist
          </h4>
          {isWalletConnected && watchlistIds.length > 0 && (
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
              {watchlistIds.length}
            </div>
          )}
        </div>

        {/* Content */}
        <div className="p-1.5">
          {/* Not Connected State */}
          {!isWalletConnected ? (
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                <span className="text-[11px] font-medium text-[#808080]">
                  Connect wallet to view watchlist
                </span>
                <svg className="w-3 h-3 text-[#404040] ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
          ) : isLoading ? (
            /* Loading State Pattern */
            <div className="space-y-1">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="bg-[#0F0F0F] rounded-md">
                  <div className="flex items-center gap-2 p-2.5">
                    <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
                    <div className="w-6 h-6 bg-[#2A2A2A] rounded-full animate-pulse flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="w-16 h-3 bg-[#2A2A2A] rounded animate-pulse" />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-3 bg-[#2A2A2A] rounded animate-pulse" />
                      <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                        <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : watchlistError ? (
            /* Error State */
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-red-500/20 hover:border-red-500/30 transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                <span className="text-[11px] font-medium text-red-400">
                  {watchlistError}
                </span>
              </div>
            </div>
          ) : topWatchlistItems.length === 0 ? (
            /* Empty State Pattern */
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md transition-all duration-200">
              <div className="flex items-center gap-2 p-2.5">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                <span className="text-[11px] font-medium text-[#808080]">
                  No items in watchlist
                </span>
                <svg className="w-3 h-3 text-[#404040] ml-auto flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                </svg>
              </div>
              {/* Expandable Details on Hover */}
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">Add markets from the Explore page using the star icon</span>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* Watchlist Items */
            <div className="space-y-0.5">
              {topWatchlistItems.map((row) => {
                const changePercent = getChangePercent(row);
                const isPositive = changePercent >= 0;
                
                return (
                  <button
                    key={row.market_id}
                    onClick={() => handleNavigateToMarket(row)}
                    className="group w-full bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md transition-all duration-200 text-left"
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      {/* Status Dot */}
                      <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isPositive ? 'bg-green-400' : 'bg-red-400'}`} />
                      
                      {/* Avatar */}
                      <div className="w-6 h-6 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
                        {row.icon_image_url ? (
                          <Image
                            src={row.icon_image_url}
                            alt={row.name || row.symbol}
                            width={24}
                            height={24}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[8px] font-medium text-[#808080]">
                            {(row.symbol || row.name || '?').slice(0, 2).toUpperCase()}
                          </div>
                        )}
                      </div>
                      
                      {/* Symbol/Name */}
                      <div className="flex-1 min-w-0">
                        <span className="text-[11px] font-medium text-white truncate block">
                          {row.symbol || row.name}
                        </span>
                      </div>
                      
                      {/* Price & Change */}
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <span className="text-[10px] text-white font-mono">
                          {formatPrice(row)}
                        </span>
                        <span className={`text-[10px] font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                          {isPositive ? '+' : ''}{changePercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer - Action Row Pattern */}
        <div className="p-1.5 border-t border-[#1A1A1A]">
          <button
            onClick={handleNavigateToWatchlist}
            className="w-full flex items-center justify-center gap-1.5 p-2 rounded-md text-[11px] font-medium text-[#808080] hover:text-white bg-[#0F0F0F] hover:bg-[#1A1A1A] border border-[#222222] hover:border-[#333333] transition-all duration-200"
          >
            View Full Watchlist
            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}
