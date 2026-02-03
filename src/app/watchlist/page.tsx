'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import useWallet from '@/hooks/useWallet';
import { useMarketOverview } from '@/hooks/useMarketOverview';
import type { MarketOverviewRow } from '@/hooks/useMarketOverview';
import { WatchlistMetricsBar } from '@/components/watchlist/WatchlistMetricsBar';
import { AddAssetsModal } from '@/components/watchlist/AddAssetsModal';
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

export default function WatchlistPage() {
  const router = useRouter();
  const { walletData } = useWallet();

  const [watchlistIds, setWatchlistIds] = useState<string[]>([]);
  const [watchlistUserIds, setWatchlistUserIds] = useState<string[]>([]);
  const [watchlistUsers, setWatchlistUsers] = useState<WatchedUser[]>([]);
  const [watchlistPending, setWatchlistPending] = useState<string[]>([]);
  const [watchlistUserPending, setWatchlistUserPending] = useState<string[]>([]);
  const [watchlistError, setWatchlistError] = useState<string | null>(null);
  const [watchlistLoading, setWatchlistLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);
  const [isAddAssetsOpen, setIsAddAssetsOpen] = useState(false);
  const [copiedWatchedUserId, setCopiedWatchedUserId] = useState<string | null>(null);

  // Fetch watchlist ids for the connected wallet (with caching)
  useEffect(() => {
    const walletAddress = walletData?.address;
    if (!walletAddress) {
      setWatchlistIds([]);
      setWatchlistUserIds([]);
      setWatchlistUsers([]);
      setWatchlistError(null);
      setWatchlistLoading(false);
      return;
    }

    const cacheKey = CACHE_KEYS.WATCHLIST(walletAddress);

    // Load cached data immediately if available
    const cached = getFromCacheOrStorage<WatchlistCacheData>(cacheKey);
    if (cached) {
      setWatchlistIds(cached.market_ids);
      setWatchlistUserIds(cached.watched_user_ids);
      setWatchlistUsers(cached.watched_users);
      // If data is fresh, don't show loading state
      if (!isDataStale(cacheKey)) {
        setWatchlistLoading(false);
      }
    }

    const ctrl = new AbortController();
    const run = async () => {
      // Only show loading if no cached data
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
        const userIds = Array.isArray(json.watched_user_ids) ? json.watched_user_ids : [];
        const watchedUsers = Array.isArray(json.watched_users) ? (json.watched_users as WatchedUser[]) : [];
        
        const filteredIds = ids.filter((id: unknown) => typeof id === 'string');
        const filteredUserIds = userIds.filter((id: unknown) => typeof id === 'string');
        const filteredUsers = watchedUsers.filter(
          (u: any) => u && typeof u.id === 'string' && typeof u.wallet_address === 'string'
        );

        // Update state
        setWatchlistIds(filteredIds);
        setWatchlistUserIds(filteredUserIds);
        setWatchlistUsers(filteredUsers);

        // Cache the data
        setCache<WatchlistCacheData>(cacheKey, {
          market_ids: filteredIds,
          watched_user_ids: filteredUserIds,
          watched_users: filteredUsers,
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
  }, [walletData?.address]);

  // Fetch market overview
  const { data: overview, isLoading: marketsLoading, error: marketsError } = useMarketOverview({
    limit: 500,
    autoRefresh: false,
    realtime: true,
    realtimeDebounce: 1000,
  });

  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);

  const watchlistedRows = useMemo(() => {
    const rows = (overview as MarketOverviewRow[]) || [];
    if (!rows.length || watchlistSet.size === 0) return [];
    return rows.filter((row) => watchlistSet.has(String(row?.market_id || '')));
  }, [overview, watchlistSet]);

  // Apply search and sort
  const filteredAndSortedRows = useMemo(() => {
    let result = [...watchlistedRows];
    
    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((row) => 
        row.name?.toLowerCase().includes(query) ||
        row.symbol?.toLowerCase().includes(query)
      );
    }
    
    // Apply sorting
    if (sortConfig) {
      result.sort((a, b) => {
        let aValue: any;
        let bValue: any;
        
        switch (sortConfig.key) {
          case 'name':
            aValue = a.name?.toLowerCase() || '';
            bValue = b.name?.toLowerCase() || '';
            break;
          case 'price':
            aValue = (a.mark_price || 0) / 1_000_000;
            bValue = (b.mark_price || 0) / 1_000_000;
            break;
          case 'marketCap':
            aValue = a.total_volume || 0;
            bValue = b.total_volume || 0;
            break;
          default:
            return 0;
        }
        
        if (aValue < bValue) return sortConfig.direction === 'asc' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
      });
    }
    
    return result;
  }, [watchlistedRows, searchQuery, sortConfig]);

  const handleSort = (key: string) => {
    setSortConfig((current) => {
      if (current?.key === key) {
        return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }
      return { key, direction: 'asc' };
    });
  };

  const handleNavigateToMarket = (row: MarketOverviewRow) => {
    router.push(`/token/${row.market_identifier || row.symbol}`);
  };

  const handleAddMarketFromModal = useCallback(
    async ({ id, metricId }: { id: string; metricId?: string }) => {
      if (!id) return;
      if (!walletData?.address) return;
      if (watchlistPending.includes(id)) return;
      if (watchlistIds.includes(id)) return;

      // Optimistic add
      setWatchlistIds((prev) => [...prev, id]);
      setWatchlistPending((prev) => [...prev, id]);

      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: walletData.address,
            market_id: id,
            metric_id: metricId,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to update watchlist');
        }
      } catch {
        // Revert optimistic update
        setWatchlistIds((prev) => prev.filter((x) => x !== id));
      } finally {
        setWatchlistPending((prev) => prev.filter((x) => x !== id));
      }
    },
    [walletData?.address, watchlistIds, watchlistPending]
  );

  const handleAddUserFromModal = useCallback(
    async ({ id }: { id: string }) => {
      if (!id) return;
      if (!walletData?.address) return;
      if (watchlistUserPending.includes(id)) return;
      if (watchlistUserIds.includes(id)) return;

      // Optimistic add
      setWatchlistUserIds((prev) => [...prev, id]);
      setWatchlistUserPending((prev) => [...prev, id]);

      try {
        const res = await fetch('/api/watchlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: walletData.address,
            watched_user_id: id,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to update watchlist');
        }
      } catch {
        // Revert optimistic update
        setWatchlistUserIds((prev) => prev.filter((x) => x !== id));
      } finally {
        setWatchlistUserPending((prev) => prev.filter((x) => x !== id));
      }
    },
    [walletData?.address, watchlistUserIds, watchlistUserPending]
  );

  const handleRemoveWatchedUser = useCallback(
    async (id: string) => {
      if (!id) return;
      if (!walletData?.address) return;
      if (watchlistUserPending.includes(id)) return;

      const prevIds = watchlistUserIds;
      const prevUsers = watchlistUsers;

      setWatchlistUserIds((prev) => prev.filter((x) => x !== id));
      setWatchlistUsers((prev) => prev.filter((u) => u.id !== id));
      setWatchlistUserPending((prev) => [...prev, id]);

      try {
        const res = await fetch('/api/watchlist', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            wallet_address: walletData.address,
            watched_user_id: id,
          }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || !json?.success) {
          throw new Error(json?.error || 'Failed to remove watched user');
        }
      } catch {
        setWatchlistUserIds(prevIds);
        setWatchlistUsers(prevUsers);
      } finally {
        setWatchlistUserPending((prev) => prev.filter((x) => x !== id));
      }
    },
    [walletData?.address, watchlistUserIds, watchlistUserPending, watchlistUsers]
  );

  const handleCopyWatchedUserAddress = useCallback(async (u: WatchedUser) => {
    try {
      await navigator.clipboard.writeText(u.wallet_address);
      setCopiedWatchedUserId(u.id);
      setTimeout(() => setCopiedWatchedUserId((cur) => (cur === u.id ? null : cur)), 1200);
    } catch {
      // ignore
    }
  }, []);

  const handleWatchlistToggle = async (row: MarketOverviewRow) => {
    const marketId = row.market_id;
    if (!marketId) return;
    if (!walletData?.address) return;
    if (watchlistPending.includes(marketId)) return;

    const isWatchlisted = watchlistIds.includes(marketId);
    setWatchlistIds((prev) => (isWatchlisted ? prev.filter((id) => id !== marketId) : [...prev, marketId]));
    setWatchlistPending((prev) => [...prev, marketId]);

    try {
      const res = await fetch('/api/watchlist', {
        method: isWatchlisted ? 'DELETE' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          wallet_address: walletData.address,
          market_id: marketId,
          metric_id: row.market_identifier || row.symbol,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to update watchlist');
      }
    } catch (e) {
      // Revert optimistic update
      setWatchlistIds((prev) => (isWatchlisted ? [...prev, marketId] : prev.filter((id) => id !== marketId)));
    } finally {
      setWatchlistPending((prev) => prev.filter((id) => id !== marketId));
    }
  };

  const formatPrice = (row: MarketOverviewRow) => {
    const price = (row.mark_price || 0) / 1_000_000;
    if (price === 0) return '$0.00';
    if (price < 0.01) return '< $0.01';
    return `$${price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const formatMarketCap = (row: MarketOverviewRow) => {
    const volume = row.total_volume || 0;
    if (volume === 0) return '$0.00';
    return `$${volume.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Mock change percentage (would need real data)
  const getChangePercent = useCallback((row: MarketOverviewRow) => {
    const hash = row.market_id?.split('').reduce((a, b) => a + b.charCodeAt(0), 0) || 0;
    return ((hash % 200) - 100) / 10;
  }, []);

  const isWalletConnected = Boolean(walletData?.address);
  const showEmpty =
    isWalletConnected &&
    !watchlistLoading &&
    !marketsLoading &&
    watchlistIds.length === 0 &&
    watchlistUserIds.length === 0;
  const isLoading = watchlistLoading || marketsLoading;

  const metrics = useMemo(() => {
    const rows = watchlistedRows || [];

    const totalVolume24hUsd = rows.reduce((sum, row) => sum + (Number(row?.total_volume) || 0), 0);

    const changes = rows.map((r) => getChangePercent(r)).filter((n) => Number.isFinite(n));
    const avgChangePct = changes.length ? changes.reduce((a, b) => a + b, 0) / changes.length : 0;

    const gainers = rows.reduce((count, row) => count + (getChangePercent(row) > 0 ? 1 : 0), 0);
    const losers = rows.reduce((count, row) => count + (getChangePercent(row) < 0 ? 1 : 0), 0);

    const maxVol = rows.reduce((m, row) => Math.max(m, Number(row?.total_volume) || 0), 0);
    const dominancePct = totalVolume24hUsd > 0 ? (maxVol / totalVolume24hUsd) * 100 : 0;

    return {
      watchlistAssets: watchlistIds.length,
      totalVolume24hUsd,
      avgChangePct,
      gainers,
      losers,
      dominancePct,
    };
  }, [getChangePercent, watchlistedRows, watchlistIds.length]);

  return (
    <div className="dex-page-enter-up w-full h-[calc(100vh-96px)] flex bg-transparent overflow-hidden">
      {/* Main Watchlist Content */}
      <div className="flex-1 flex flex-col min-w-0 px-6 py-6 overflow-y-auto scrollbar-none">
        {/* Header */}
        <div className="mb-4 flex-shrink-0">
          <h1 className="text-white text-xl font-medium tracking-tight">Watchlist</h1>
          <p className="text-[#606060] text-[11px] mt-1">
            Stay Ahead of the Market with Your Personalized Watchlist
          </p>
        </div>

        <div className="mb-4 flex-shrink-0">
          <WatchlistMetricsBar
            watchlistAssets={metrics.watchlistAssets}
            totalVolume24hUsd={metrics.totalVolume24hUsd}
            avgChangePct={metrics.avgChangePct}
            gainers={metrics.gainers}
            losers={metrics.losers}
            dominancePct={metrics.dominancePct}
          />
        </div>

        {/* Error Display */}
        {(watchlistError || marketsError) && (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-red-500/20 hover:border-red-500/30 transition-all duration-200 p-2.5 mb-3 flex-shrink-0">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
              <span className="text-[11px] font-medium text-red-400">
                {watchlistError ? `Watchlist error: ${watchlistError}` : `Markets error: ${marketsError}`}
              </span>
            </div>
          </div>
        )}

        {/* Not Connected State */}
        {!isWalletConnected ? (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-[#808080]">
                    Connect your wallet to view watchlist
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsAddAssetsOpen(true)}
                  className="flex items-center gap-1.5 px-3 py-2 bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded-md text-[11px] text-[#808080] transition-all duration-200"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                  </svg>
                  Add Asset
                </button>
                <svg className="w-3 h-3 text-[#404040]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
            </div>
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
              <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                <div className="text-[9px] pt-1.5">
                  <span className="text-[#606060]">Your watchlist is tied to your wallet address. Use the sidebar to connect.</span>
                </div>
              </div>
            </div>
          </div>
        ) : showEmpty ? (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
            <div className="flex items-center justify-between p-2.5">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[11px] font-medium text-[#808080]">
                    No markets in your watchlist
                  </span>
                </div>
              </div>
              <button
                onClick={() => setIsAddAssetsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded-md text-[11px] text-[#808080] transition-all duration-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Asset
              </button>
            </div>
            <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
              <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                <div className="text-[9px] pt-1.5">
                  <span className="text-[#606060]">Add markets from the Overview page using the bookmark icon.</span>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Search and Controls */}
            <div className="flex items-center gap-2 mb-3 flex-shrink-0">
              <div className="relative flex-1 max-w-md">
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3 h-3 text-[#606060]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  placeholder="Search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] focus:border-[#333333] rounded-md pl-8 pr-3 py-2 text-[11px] text-white placeholder-[#606060] focus:outline-none transition-all duration-200"
                />
              </div>
              <button
                onClick={() => setIsAddAssetsOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded-md text-[11px] text-[#808080] transition-all duration-200"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Asset
              </button>
              <button className="p-2 bg-[#0F0F0F] border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] rounded-md text-[#808080] transition-all duration-200">
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                </svg>
              </button>
            </div>

            {/* Table with internal scroll */}
            <div className="flex-1 min-h-0 overflow-hidden rounded-md border border-[#222222]">
              <div className="h-full overflow-y-auto scrollbar-none">
                <table className="w-full">
                  <thead className="sticky top-0 z-10 bg-[#0F0F0F]">
                    <tr className="border-b border-[#1A1A1A]">
                      <th className="w-10 px-2.5 py-2"></th>
                      <th 
                        className="w-10 px-2 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide cursor-pointer hover:text-[#9CA3AF] transition-colors duration-200"
                        onClick={() => handleSort('rank')}
                      >
                        #
                        {sortConfig?.key === 'rank' && (
                          <span className="ml-0.5 text-[#9CA3AF]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                      <th 
                        className="px-2.5 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide cursor-pointer hover:text-[#9CA3AF] transition-colors duration-200"
                        onClick={() => handleSort('name')}
                      >
                        Cryptocurrency
                        {sortConfig?.key === 'name' && (
                          <span className="ml-0.5 text-[#9CA3AF]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                      <th 
                        className="px-2.5 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide cursor-pointer hover:text-[#9CA3AF] transition-colors duration-200"
                        onClick={() => handleSort('price')}
                      >
                        Price
                        {sortConfig?.key === 'price' && (
                          <span className="ml-0.5 text-[#9CA3AF]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                      <th className="px-2.5 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide">
                        Change
                      </th>
                      <th 
                        className="px-2.5 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide cursor-pointer hover:text-[#9CA3AF] transition-colors duration-200"
                        onClick={() => handleSort('marketCap')}
                      >
                        Market Cap
                        {sortConfig?.key === 'marketCap' && (
                          <span className="ml-0.5 text-[#9CA3AF]">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>
                        )}
                      </th>
                      <th className="w-10 px-2.5 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      Array.from({ length: 8 }).map((_, i) => (
                        <tr key={i} className="border-b border-[#1A1A1A] bg-[#0F0F0F]">
                          <td className="px-2.5 py-2.5">
                            <div className="w-4 h-4 bg-[#2A2A2A] rounded animate-pulse"></div>
                          </td>
                          <td className="px-2 py-2.5">
                            <div className="w-4 h-3 bg-[#2A2A2A] rounded animate-pulse"></div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 bg-[#2A2A2A] rounded-full animate-pulse"></div>
                              <div className="space-y-1">
                                <div className="w-20 h-3 bg-[#2A2A2A] rounded animate-pulse"></div>
                                <div className="w-10 h-2 bg-[#2A2A2A] rounded animate-pulse"></div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="w-16 h-3 bg-[#2A2A2A] rounded animate-pulse"></div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="w-10 h-3 bg-[#2A2A2A] rounded animate-pulse"></div>
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="w-20 h-3 bg-[#2A2A2A] rounded animate-pulse"></div>
                          </td>
                          <td className="px-2.5 py-2.5"></td>
                        </tr>
                      ))
                    ) : filteredAndSortedRows.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="px-2.5 py-8 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                            <span className="text-[11px] text-[#606060]">
                              {searchQuery ? 'No markets match your search' : 'No markets in your watchlist'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    ) : (
                      filteredAndSortedRows.map((row, index) => {
                        const changePercent = getChangePercent(row);
                        const isPositive = changePercent >= 0;
                        const isPending = watchlistPending.includes(row.market_id);
                        
                        return (
                          <tr 
                            key={row.market_id} 
                            className="group border-b border-[#1A1A1A] bg-[#0F0F0F] hover:bg-[#1A1A1A] transition-all duration-200 cursor-pointer"
                            onClick={() => handleNavigateToMarket(row)}
                          >
                            <td className="px-2.5 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <button
                                onClick={() => handleWatchlistToggle(row)}
                                disabled={isPending}
                                className={`text-yellow-400 hover:text-yellow-300 transition-colors duration-200 ${isPending ? 'opacity-50 animate-pulse' : ''}`}
                              >
                                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                                  <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
                                </svg>
                              </button>
                            </td>
                            <td className="px-2 py-2.5 text-[10px] text-[#606060]">
                              {index + 1}
                            </td>
                            <td className="px-2.5 py-2.5">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0">
                                  {row.icon_image_url ? (
                                    <Image
                                      src={row.icon_image_url}
                                      alt={row.name || row.symbol}
                                      width={28}
                                      height={28}
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <div className="w-full h-full flex items-center justify-center text-[9px] font-medium text-[#808080]">
                                      {(row.symbol || row.name || '?').slice(0, 2).toUpperCase()}
                                    </div>
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <div className="text-[11px] font-medium text-white truncate">
                                    {row.name || row.symbol}
                                  </div>
                                  <div className="text-[9px] text-[#606060] uppercase">
                                    {row.symbol}
                                  </div>
                                </div>
                              </div>
                            </td>
                            <td className="px-2.5 py-2.5 text-[10px] text-white font-mono">
                              {formatPrice(row)}
                            </td>
                            <td className="px-2.5 py-2.5">
                              <span className={`text-[10px] font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                                {isPositive ? '+' : ''}{changePercent.toFixed(1)}%
                              </span>
                            </td>
                            <td className="px-2.5 py-2.5 text-[10px] text-white font-mono">
                              {formatMarketCap(row)}
                            </td>
                            <td className="px-2.5 py-2.5" onClick={(e) => e.stopPropagation()}>
                              <button className="opacity-0 group-hover:opacity-100 p-1 hover:bg-[#2A2A2A] rounded text-[#606060] hover:text-[#9CA3AF] transition-all duration-200">
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h.01M12 12h.01M19 12h.01M6 12a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0zm7 0a1 1 0 11-2 0 1 1 0 012 0z" />
                                </svg>
                              </button>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Watched Accounts (separate UI table) */}
            {watchlistUsers.length > 0 && (
              <div className="mt-3 flex-shrink-0">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                    Watched accounts
                  </h4>
                  <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {watchlistUsers.length}
                  </div>
                </div>

                <div className="rounded-md border border-[#222222] overflow-hidden bg-[#0F0F0F]">
                  <div className="max-h-40 overflow-y-auto scrollbar-none">
                    <table className="w-full">
                      <thead className="sticky top-0 z-10 bg-[#0F0F0F]">
                        <tr className="border-b border-[#1A1A1A]">
                          <th className="px-2.5 py-2 text-left text-[10px] font-medium text-[#606060] uppercase tracking-wide">
                            Account
                          </th>
                          <th className="px-2.5 py-2 text-right text-[10px] font-medium text-[#606060] uppercase tracking-wide">
                            Actions
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {watchlistUsers.map((u) => {
                          const isPending = watchlistUserPending.includes(u.id);
                          const label = u.display_name || u.username || 'Anonymous User';
                          const shortAddr = `${u.wallet_address.slice(0, 6)}...${u.wallet_address.slice(-4)}`;
                          return (
                            <tr
                              key={u.id}
                              className="border-b border-[#1A1A1A] bg-[#0F0F0F] hover:bg-[#1A1A1A] transition-all duration-200"
                            >
                              <td className="px-2.5 py-2.5">
                                <div className="flex items-center gap-2 min-w-0">
                                  <div
                                    className="w-7 h-7 rounded-full overflow-hidden bg-[#2A2A2A] flex-shrink-0"
                                    style={{
                                      backgroundImage: u.profile_image_url ? `url(${u.profile_image_url})` : undefined,
                                      backgroundSize: 'cover',
                                      backgroundPosition: 'center',
                                    }}
                                  >
                                    {!u.profile_image_url && (
                                      <div className="w-full h-full flex items-center justify-center text-[10px] font-medium text-[#808080]">
                                        {label.slice(0, 1).toUpperCase()}
                                      </div>
                                    )}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="text-[11px] font-medium text-white truncate">{label}</div>
                                    <div className="text-[10px] text-[#606060] font-mono">{shortAddr}</div>
                                  </div>
                                </div>
                              </td>
                              <td className="px-2.5 py-2.5 text-right">
                                <div className="inline-flex items-center gap-2">
                                  <button
                                    onClick={() => handleCopyWatchedUserAddress(u)}
                                    className="px-2.5 py-1.5 rounded-md text-[11px] border border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white transition-all duration-200"
                                  >
                                    {copiedWatchedUserId === u.id ? 'Copied' : 'Copy'}
                                  </button>
                                  <button
                                    disabled={isPending}
                                    onClick={() => handleRemoveWatchedUser(u.id)}
                                    className={`px-2.5 py-1.5 rounded-md text-[11px] border transition-all duration-200 ${
                                      isPending
                                        ? 'border-[#222222] text-[#808080] animate-pulse'
                                        : 'border-red-500/20 text-red-400 hover:border-red-500/30 hover:bg-red-500/5'
                                    }`}
                                  >
                                    {isPending ? 'Removing…' : 'Remove'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <AddAssetsModal
        isOpen={isAddAssetsOpen}
        onClose={() => setIsAddAssetsOpen(false)}
        walletAddress={walletData?.address}
        watchlistIds={watchlistIds}
        watchlistUserIds={watchlistUserIds}
        pendingMarketIds={watchlistPending}
        pendingUserIds={watchlistUserPending}
        onAddMarket={handleAddMarketFromModal}
        onAddUser={handleAddUserFromModal}
      />
    </div>
  );
}
