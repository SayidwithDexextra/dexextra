'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type Market = {
  id: string;
  symbol: string;
  name?: string | null;
  description?: string | null;
  icon_image_url?: string | null;
  market_identifier?: string | null;
  deployment_status?: string | null;
  initial_price?: number | null;
  price_decimals?: number | null;
  total_volume?: number | null;
};

type UserProfileSearchResult = {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  bio?: string;
  profile_image_url?: string;
  created_at: string;
};

type SearchResults = {
  markets: Market[];
  users: UserProfileSearchResult[];
  isLoading: boolean;
  error: string | null;
};

export type AddAssetsModalProps = {
  isOpen: boolean;
  onClose: () => void;
  walletAddress?: string;
  watchlistIds: string[];
  watchlistUserIds: string[];
  pendingMarketIds?: string[];
  pendingUserIds?: string[];
  onAddMarket: (market: { id: string; metricId?: string }) => Promise<void> | void;
  onAddUser: (user: { id: string }) => Promise<void> | void;
};

const formatUsdNumber = (value: number, decimals?: number) => {
  const safe = Number.isFinite(value) ? value : 0;
  const dRaw = typeof decimals === 'number' && Number.isFinite(decimals) ? Math.floor(decimals) : 4;
  const maxD = Math.max(0, Math.min(dRaw, 8));
  const minD = Math.min(2, maxD);
  const rounded = Number(safe.toFixed(maxD));
  return `$${new Intl.NumberFormat('en-US', {
    minimumFractionDigits: minD,
    maximumFractionDigits: maxD,
  }).format(rounded)}`;
};

export function AddAssetsModal({
  isOpen,
  onClose,
  walletAddress,
  watchlistIds,
  watchlistUserIds,
  pendingMarketIds = [],
  pendingUserIds = [],
  onAddMarket,
  onAddUser,
}: AddAssetsModalProps) {
  const [searchValue, setSearchValue] = useState('');
  const [isAnimating, setIsAnimating] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [popularMarkets, setPopularMarkets] = useState<Market[]>([]);
  const [copiedUserId, setCopiedUserId] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResults>({
    markets: [],
    users: [],
    isLoading: false,
    error: null,
  });

  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const canAdd = Boolean(walletAddress);
  const watchlistSet = useMemo(() => new Set(watchlistIds), [watchlistIds]);
  const pendingSet = useMemo(() => new Set(pendingMarketIds), [pendingMarketIds]);
  const watchlistUserSet = useMemo(() => new Set(watchlistUserIds), [watchlistUserIds]);
  const pendingUserSet = useMemo(() => new Set(pendingUserIds), [pendingUserIds]);

  // Load recent searches
  useEffect(() => {
    const saved = localStorage.getItem('dexextra-add-assets-recent-searches');
    if (!saved) return;
    try {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed)) setRecentSearches(parsed.filter((x) => typeof x === 'string'));
    } catch {}
  }, []);

  const saveRecentSearch = useCallback((term: string) => {
    const t = term.trim();
    if (!t) return;
    setRecentSearches((prev) => {
      const next = [t, ...prev.filter((p) => p !== t)].slice(0, 6);
      localStorage.setItem('dexextra-add-assets-recent-searches', JSON.stringify(next));
      return next;
    });
  }, []);

  const clearRecentSearches = useCallback(() => {
    setRecentSearches([]);
    localStorage.removeItem('dexextra-add-assets-recent-searches');
  }, []);

  const fetchPopularMarkets = useCallback(async () => {
    try {
      const res = await fetch('/api/markets?limit=20');
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.success) return;
      const mkts = Array.isArray(json.markets) ? (json.markets as Market[]) : [];
      setPopularMarkets(mkts);
    } catch {}
  }, []);

  const performSearch = useCallback(async (term: string) => {
    const q = term.trim();
    if (!q) {
      setResults((prev) => ({ ...prev, markets: [], users: [], isLoading: false, error: null }));
      return;
    }

    setResults((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      // Use full-text search for better multi-word query handling
      const [marketsRes, usersRes] = await Promise.all([
        fetch(`/api/markets?fts=${encodeURIComponent(q)}&limit=15`),
        fetch(`/api/profile/search?q=${encodeURIComponent(q)}&limit=10`),
      ]);

      const [marketsJson, usersJson] = await Promise.all([
        marketsRes.json().catch(() => null),
        usersRes.json().catch(() => null),
      ]);

      const marketMap = new Map<string, Market>();
      if (marketsJson?.success && Array.isArray(marketsJson?.markets)) {
        (marketsJson.markets as Market[]).forEach((m) => {
          if (m?.id) marketMap.set(String(m.id), m);
        });
      }

      const users: UserProfileSearchResult[] =
        usersJson?.success && Array.isArray(usersJson?.data) ? (usersJson.data as UserProfileSearchResult[]) : [];

      setResults({
        markets: Array.from(marketMap.values()),
        users,
        isLoading: false,
        error: null,
      });
    } catch (e) {
      setResults({
        markets: [],
        users: [],
        isLoading: false,
        error: (e as Error)?.message || 'Search failed. Please try again.',
      });
    }
  }, []);

  // Open/close animation + initial data
  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false);
      return;
    }
    setIsAnimating(true);
    setTimeout(() => inputRef.current?.focus(), 75);
    fetchPopularMarkets();
  }, [fetchPopularMarkets, isOpen]);

  // Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  // Click outside
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

  // Debounce search
  useEffect(() => {
    if (!isOpen) return;
    const id = setTimeout(() => performSearch(searchValue), 250);
    return () => clearTimeout(id);
  }, [isOpen, performSearch, searchValue]);

  const handleRecentSelect = useCallback((term: string) => setSearchValue(term), []);

  const handleAdd = useCallback(
    async (m: Market) => {
      if (!m?.id) return;
      if (!canAdd) return;
      if (watchlistSet.has(m.id)) return;
      if (pendingSet.has(m.id)) return;

      if (searchValue.trim()) saveRecentSearch(searchValue);
      const metricId = (m.market_identifier || m.symbol || '').toString();
      await Promise.resolve(onAddMarket({ id: m.id, metricId }));
    },
    [canAdd, onAddMarket, pendingSet, saveRecentSearch, searchValue, watchlistSet]
  );

  const handleAddUser = useCallback(
    async (u: UserProfileSearchResult) => {
      if (!u?.id) return;
      if (!canAdd) return;
      if (watchlistUserSet.has(u.id)) return;
      if (pendingUserSet.has(u.id)) return;

      if (searchValue.trim()) saveRecentSearch(searchValue);
      await Promise.resolve(onAddUser({ id: u.id }));
    },
    [canAdd, onAddUser, pendingUserSet, saveRecentSearch, searchValue, watchlistUserSet]
  );

  const handleUserClick = useCallback(async (u: UserProfileSearchResult) => {
    try {
      await navigator.clipboard.writeText(u.wallet_address);
      setCopiedUserId(u.id);
      setTimeout(() => setCopiedUserId((cur) => (cur === u.id ? null : cur)), 1200);
    } catch {
      // ignore
    }
  }, []);

  if (!isOpen) return null;

  const visibleMarkets = searchValue.trim() ? results.markets : popularMarkets;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} />

      <div
        ref={modalRef}
        className="relative z-10 w-full bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200"
        style={{
          maxWidth: '760px',
          // Make the modal shorter vertically (avoid taking over the whole viewport).
          maxHeight: 'min(640px, calc(100vh - 160px))',
          padding: '16px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.35)',
        }}
      >
        {/* Title + close */}
        <div className="flex items-center justify-between mb-2">
          <div className="min-w-0">
            <div className="text-white text-[13px] font-medium tracking-tight">Add assets</div>
            <div className="text-[#606060] text-[10px] mt-0.5">Search markets and users. Add markets to your watchlist.</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md border border-[#222222] hover:border-[#333333] hover:bg-[#1A1A1A] text-[#808080] transition-all duration-200"
            aria-label="Close"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Wallet requirement banner */}
        {!canAdd && (
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
              <span className="text-[11px] font-medium text-[#808080]">Connect your wallet to add assets to your watchlist.</span>
            </div>
          </div>
        )}

        {/* Search input */}
        <div className="mb-2">
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-[#606060]">
              {results.isLoading ? (
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2" />
                  <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search markets and users…"
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="w-full bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200 focus:outline-none focus:border-[#333333] text-white text-sm pl-10 pr-10 py-2"
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-[#2A2A2A] text-[#606060] hover:text-[#808080] transition-all duration-200"
                aria-label="Clear"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Scroll body */}
        <div className="overflow-y-auto scrollbar-none" style={{ maxHeight: '460px' }}>
          {results.error && (
            <div className="bg-[#0F0F0F] border border-[#222222] rounded-md p-2.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                <span className="text-[11px] font-medium text-red-400">{results.error}</span>
              </div>
            </div>
          )}

          {/* Recent searches (only when empty) */}
          {!searchValue && recentSearches.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Recent</h4>
                <button onClick={clearRecentSearches} className="text-[10px] text-green-400 hover:text-green-300 uppercase tracking-wide transition-all duration-200">
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((t, idx) => (
                  <button
                    key={`${t}-${idx}`}
                    onClick={() => handleRecentSelect(t)}
                    className="w-full text-left group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">{t}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Markets */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                {searchValue.trim() ? 'Markets' : 'Popular markets'}
              </h4>
              <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{visibleMarkets.length}</div>
            </div>

            <div className="space-y-1">
              {visibleMarkets.length === 0 ? (
                <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                      <span className="text-[11px] font-medium text-[#808080]">No markets found</span>
                    </div>
                  </div>
                </div>
              ) : (
                visibleMarkets.map((m) => {
                  const id = String(m.id);
                  const isAdded = watchlistSet.has(id);
                  const isPending = pendingSet.has(id);
                  const status = String(m.deployment_status || '').toLowerCase();

                  return (
                    <div key={id} className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                      <div className="flex items-center justify-between p-2.5">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${status === 'deployed' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {m.icon_image_url ? (
                              <div className="w-6 h-6 rounded bg-cover bg-center bg-no-repeat" style={{ backgroundImage: `url(${m.icon_image_url})` }} />
                            ) : (
                              <div className={`flex items-center justify-center rounded text-[9px] font-medium w-6 h-6 ${status === 'deployed' ? 'bg-green-400 text-black' : 'bg-yellow-400 text-black'}`}>
                                {(m.symbol || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-left text-[13px] font-medium text-white">
                                {m.symbol}
                                {m.name ? <span className="text-[#606060] font-normal text-[11px] ml-2 truncate">· {m.name}</span> : null}
                              </div>
                              <div className="text-[11px] text-[#606060] truncate max-w-[420px]">{m.description || ''}</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right min-w-[90px]">
                            <div className="text-[11px] text-white font-mono">
                              {formatUsdNumber(Number(m.initial_price || 0), Number(m.price_decimals || 4))}
                            </div>
                            <div className="text-[10px] text-[#606060]">{m.market_identifier || ''}</div>
                          </div>
                          <div className="w-px h-6 bg-[#222222]" />
                          <button
                            disabled={!canAdd || isAdded || isPending}
                            onClick={() => handleAdd(m)}
                            className={[
                              'px-3 py-2 rounded-md text-[11px] font-medium transition-all duration-200 border',
                              isAdded
                                ? 'bg-[#0F0F0F] border-[#222222] text-[#606060]'
                                : isPending
                                  ? 'bg-[#0F0F0F] border-[#222222] text-[#808080] animate-pulse'
                                  : 'bg-[#0F0F0F] border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white',
                              !canAdd ? 'opacity-50' : '',
                            ].join(' ')}
                          >
                            {isAdded ? 'Added' : isPending ? 'Adding…' : 'Add'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Users (only when searching) */}
          {searchValue.trim() && (
            <div className="mb-1">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Users</h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{results.users.length}</div>
              </div>

              <div className="space-y-1">
                {results.users.length === 0 ? (
                  <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                        <span className="text-[11px] font-medium text-[#808080]">No users found</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  results.users.map((u) => {
                    const isAdded = watchlistUserSet.has(u.id);
                    const isPending = pendingUserSet.has(u.id);
                    return (
                      <div
                        key={u.id}
                        className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
                      >
                        <div className="flex items-center justify-between p-2.5">
                          <button
                            onClick={() => handleUserClick(u)}
                            className="min-w-0 flex-1 text-left"
                            title="Copy wallet address"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <div
                                  className="flex items-center justify-center text-[9px] font-medium rounded-full w-6 h-6"
                                  style={{
                                    backgroundColor: u.profile_image_url ? 'transparent' : '#404040',
                                    backgroundImage: u.profile_image_url ? `url(${u.profile_image_url})` : undefined,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                    color: '#ffffff',
                                  }}
                                >
                                  {!u.profile_image_url && (u.display_name || u.username || u.wallet_address).charAt(0).toUpperCase()}
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] font-medium text-white">{u.display_name || u.username || 'Anonymous User'}</div>
                                  <div className="text-[10px] text-[#606060] font-mono">
                                    {u.wallet_address.slice(0, 6)}...{u.wallet_address.slice(-4)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-2 pl-3">
                            <div className="text-[10px] text-[#606060] min-w-[44px] text-right">
                              {copiedUserId === u.id ? <span className="text-green-400">Copied</span> : ''}
                            </div>
                            <button
                              disabled={!canAdd || isAdded || isPending}
                              onClick={() => handleAddUser(u)}
                              className={[
                                'px-3 py-2 rounded-md text-[11px] font-medium transition-all duration-200 border',
                                isAdded
                                  ? 'bg-[#0F0F0F] border-[#222222] text-[#606060]'
                                  : isPending
                                    ? 'bg-[#0F0F0F] border-[#222222] text-[#808080] animate-pulse'
                                    : 'bg-[#0F0F0F] border-[#222222] text-[#808080] hover:border-[#333333] hover:bg-[#1A1A1A] hover:text-white',
                                !canAdd ? 'opacity-50' : '',
                              ].join(' ')}
                            >
                              {isAdded ? 'Added' : isPending ? 'Saving…' : 'Save'}
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

