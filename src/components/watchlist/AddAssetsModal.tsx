'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile';

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

  useEffect(() => {
    if (!isOpen) {
      setIsAnimating(false);
      return;
    }
    setIsAnimating(true);
    setTimeout(() => inputRef.current?.focus(), 75);
    fetchPopularMarkets();
  }, [fetchPopularMarkets, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, onClose]);

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
    <div className={`fixed inset-0 z-50 flex items-end sm:items-center justify-center sm:p-4 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      <div className="absolute inset-0" style={{ background: 'var(--t-overlay)' }} onClick={onClose} />

      <div
        ref={modalRef}
        className="relative z-10 w-full sm:max-w-[760px] bg-t-card rounded-t-xl sm:rounded-md border border-t-stroke transition-all duration-200 flex flex-col"
        style={{
          maxHeight: 'min(90vh, calc(100vh - 40px))',
          padding: '16px',
          boxShadow: 'var(--t-shadow-lg)',
        }}
      >
        {/* Mobile drag handle */}
        <div className="sm:hidden flex justify-center mb-3">
          <div className="w-10 h-1 rounded-full bg-t-stroke-hover" />
        </div>

        {/* Title + close */}
        <div className="flex items-center justify-between mb-2 flex-shrink-0">
          <div className="min-w-0">
            <div className="text-t-fg text-[13px] font-medium tracking-tight">Add assets</div>
            <div className="text-t-fg-muted text-[10px] mt-0.5 hidden sm:block">Search markets and users. Add markets to your watchlist.</div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-md border border-t-stroke hover:border-t-stroke-hover hover:bg-t-card-hover text-t-fg-sub transition-all duration-200"
            aria-label="Close"
          >
            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
              <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        {/* Wallet requirement banner */}
        {!canAdd && (
          <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 p-2.5 mb-3">
            <div className="flex items-center gap-2">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
              <span className="text-[11px] font-medium text-t-fg-sub">Connect your wallet to add assets to your watchlist.</span>
            </div>
          </div>
        )}

        {/* Search input */}
        <div className="mb-2 flex-shrink-0">
          <div className="relative">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-t-fg-muted">
              {results.isLoading ? (
                <div className="w-1.5 h-1.5 rounded-full bg-t-accent animate-pulse" />
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
              className="w-full bg-t-inset hover:bg-t-card-hover border border-t-stroke hover:border-t-stroke-hover rounded-md transition-all duration-200 focus:outline-none focus:border-t-stroke-hover text-t-fg text-sm pl-10 pr-10 py-2.5 sm:py-2"
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full hover:bg-t-skeleton text-t-fg-muted hover:text-t-fg-sub transition-all duration-200"
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
        <div className="overflow-y-auto scrollbar-none flex-1 min-h-0">
          {results.error && (
            <div className="bg-t-card border border-t-stroke rounded-md p-2.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-negative" />
                <span className="text-[11px] font-medium text-t-negative">{results.error}</span>
              </div>
            </div>
          )}

          {/* Recent searches (only when empty) */}
          {!searchValue && recentSearches.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Recent</h4>
                <button onClick={clearRecentSearches} className="text-[10px] text-t-positive hover:opacity-80 uppercase tracking-wide transition-all duration-200">
                  Clear
                </button>
              </div>
              <div className="space-y-1">
                {recentSearches.map((t, idx) => (
                  <button
                    key={`${t}-${idx}`}
                    onClick={() => handleRecentSelect(t)}
                    className="w-full text-left group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200"
                  >
                    <div className="flex items-center gap-2 p-2.5">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                      <span className="text-[11px] font-medium text-t-fg-sub">{t}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Markets */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">
                {searchValue.trim() ? 'Markets' : 'Popular markets'}
              </h4>
              <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">{visibleMarkets.length}</div>
            </div>

            <div className="space-y-1">
              {visibleMarkets.length === 0 ? (
                <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                  <div className="flex items-center justify-between p-2.5">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                      <span className="text-[11px] font-medium text-t-fg-sub">No markets found</span>
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
                    <div key={id} className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                      <div className="flex items-center justify-between p-2.5 gap-2">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 hidden sm:block ${status === 'deployed' ? 'bg-t-positive' : 'bg-t-warning'}`} />
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            {m.icon_image_url ? (
                              <div className="w-7 h-7 sm:w-6 sm:h-6 rounded bg-cover bg-center bg-no-repeat flex-shrink-0" style={{ backgroundImage: `url(${m.icon_image_url})` }} />
                            ) : (
                              <div className={`flex items-center justify-center rounded text-[9px] font-medium w-7 h-7 sm:w-6 sm:h-6 flex-shrink-0 ${status === 'deployed' ? 'bg-t-positive text-black' : 'bg-t-warning text-black'}`}>
                                {(m.symbol || '?').charAt(0).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="text-left text-[13px] font-medium text-t-fg truncate">
                                {m.symbol}
                                {m.name ? <span className="text-t-fg-muted font-normal text-[11px] ml-1.5 sm:ml-2">· {m.name}</span> : null}
                              </div>
                              <div className="text-[11px] text-t-fg-muted truncate sm:max-w-[420px]">{m.description || ''}</div>
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
                          <div className="text-right hidden sm:block min-w-[90px]">
                            <div className="text-[11px] text-t-fg font-mono">
                              {formatUsdNumber(Number(m.initial_price || 0), Number(m.price_decimals || 4))}
                            </div>
                            <div className="text-[10px] text-t-fg-muted">{m.market_identifier || ''}</div>
                          </div>
                          <div className="w-px h-6 bg-t-stroke hidden sm:block" />
                          <button
                            disabled={!canAdd || isAdded || isPending}
                            onClick={() => handleAdd(m)}
                            className={[
                              'px-3 py-2 rounded-md text-[11px] font-medium transition-all duration-200 border whitespace-nowrap',
                              isAdded
                                ? 'bg-t-card border-t-stroke text-t-fg-muted'
                                : isPending
                                  ? 'bg-t-card border-t-stroke text-t-fg-sub animate-pulse'
                                  : 'bg-t-card border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg',
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
                <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">Users</h4>
                <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">{results.users.length}</div>
              </div>

              <div className="space-y-1">
                {results.users.length === 0 ? (
                  <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                        <span className="text-[11px] font-medium text-t-fg-sub">No users found</span>
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
                        className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200"
                      >
                        <div className="flex items-center justify-between p-2.5 gap-2">
                          <button
                            onClick={() => handleUserClick(u)}
                            className="min-w-0 flex-1 text-left"
                            title="Copy wallet address"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-accent hidden sm:block" />
                              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                <div
                                  className="flex items-center justify-center text-[9px] font-medium rounded-full w-7 h-7 sm:w-6 sm:h-6 flex-shrink-0"
                                  style={{
                                    backgroundImage: `url(${u.profile_image_url || DEFAULT_PROFILE_IMAGE})`,
                                    backgroundSize: 'cover',
                                    backgroundPosition: 'center',
                                  }}
                                >
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-[11px] sm:text-[11px] font-medium text-t-fg truncate">{u.display_name || u.username || 'Anonymous User'}</div>
                                  <div className="text-[10px] text-t-fg-muted font-mono truncate">
                                    {u.wallet_address.slice(0, 6)}...{u.wallet_address.slice(-4)}
                                  </div>
                                </div>
                              </div>
                            </div>
                          </button>

                          <div className="flex items-center gap-2 flex-shrink-0">
                            <div className="text-[10px] text-t-fg-muted min-w-[44px] text-right hidden sm:block">
                              {copiedUserId === u.id ? <span className="text-t-positive">Copied</span> : ''}
                            </div>
                            <button
                              disabled={!canAdd || isAdded || isPending}
                              onClick={() => handleAddUser(u)}
                              className={[
                                'px-3 py-2 rounded-md text-[11px] font-medium transition-all duration-200 border whitespace-nowrap',
                                isAdded
                                  ? 'bg-t-card border-t-stroke text-t-fg-muted'
                                  : isPending
                                    ? 'bg-t-card border-t-stroke text-t-fg-sub animate-pulse'
                                    : 'bg-t-card border-t-stroke text-t-fg-sub hover:border-t-stroke-hover hover:bg-t-card-hover hover:text-t-fg',
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
