'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import searchModalDesign from '../../design/searchModal.json'
import { getSupabaseClient } from '@/lib/supabase-browser'
import MarketPairBadge from './Series/MarketPairBadge'
import { metricSourceFromMarket } from '@/lib/metricSource'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

// Import types for real data structures
interface Market {
  id: string;
  market_identifier?: string;
  symbol: string;
  description: string;
  category: string | string[];
  initial_price: number;
  price_decimals: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  is_active: boolean;
  market_id?: string;
  deployment_status: string;
  created_at: string;
  user_address?: string;
  initial_order?: any;
  market_config?: any;
  metric_source_url?: string | null;
  metric_source_host?: string | null;
  metric_source_label?: string | null;
}

interface UserProfileSearchResult {
  id: string;
  wallet_address: string;
  username?: string;
  display_name?: string;
  bio?: string;
  profile_image_url?: string;
  created_at: string;
}

interface SearchResults {
  markets: Market[];
  users: UserProfileSearchResult[];
  isLoading: boolean;
  error: string | null;
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [searchValue, setSearchValue] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResults>({
    markets: [],
    users: [],
    isLoading: false,
    error: null
  })
  const [pairMap, setPairMap] = useState<Record<string, { otherId: string; seriesSlug: string }>>({})
  const [idToMarket, setIdToMarket] = useState<Record<string, Market>>({})
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const design = searchModalDesign.searchModal

  const formatUsdNumber = useCallback((value: number, decimals?: number) => {
    const safe = Number.isFinite(value) ? value : 0
    const dRaw = typeof decimals === 'number' && Number.isFinite(decimals) ? Math.floor(decimals) : 4
    const d = Math.max(0, Math.min(dRaw, 8))
    return `$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: d,
      maximumFractionDigits: d,
    }).format(safe)}`
  }, [])

  // Load recent searches from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('dexextra-recent-searches')
    if (saved) {
      try {
        setRecentSearches(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse recent searches:', e)
      }
    }
  }, [])

  // Save recent searches to localStorage
  const saveRecentSearch = useCallback((searchTerm: string) => {
    if (!searchTerm.trim()) return
    
    setRecentSearches(prevSearches => {
      const updatedSearches = [
        searchTerm,
        ...prevSearches.filter(term => term !== searchTerm)
      ].slice(0, 5) // Keep only last 5 searches
      
      localStorage.setItem('dexextra-recent-searches', JSON.stringify(updatedSearches))
      return updatedSearches
    })
  }, []) // Remove recentSearches dependency

  // Clear recent searches
  const clearRecentSearches = useCallback(() => {
    setRecentSearches([])
    localStorage.removeItem('dexextra-recent-searches')
  }, [])

  // Search function with debouncing
  const performSearch = useCallback(async (searchTerm: string) => {
    if (!searchTerm.trim()) {
      setSearchResults({
        markets: [],
        users: [],
        isLoading: false,
        error: null
      })
      return
    }

    setSearchResults(prev => ({ ...prev, isLoading: true, error: null }))

    try {
      // Search markets by both symbol and category, and users in parallel
      const [marketsSymbolResponse, marketsCategoryResponse, usersResponse] = await Promise.all([
        fetch(`/api/markets?symbol=${encodeURIComponent(searchTerm)}&limit=10`),
        fetch(`/api/markets?category=${encodeURIComponent(searchTerm)}&limit=10`),
        fetch(`/api/profile/search?q=${encodeURIComponent(searchTerm)}&limit=10`)
      ])

      const marketsSymbolData = await marketsSymbolResponse.json()
      const marketsCategoryData = await marketsCategoryResponse.json()
      const usersData = await usersResponse.json()

      let markets: Market[] = []
      let users: UserProfileSearchResult[] = []

      // Combine symbol and category search results, removing duplicates
      const marketMap = new Map<string, Market>()
      
      if (marketsSymbolData.success && marketsSymbolData.markets) {
        marketsSymbolData.markets.forEach((market: Market) => {
          marketMap.set(market.id, market)
        })
      }

      if (marketsCategoryData.success && marketsCategoryData.markets) {
        marketsCategoryData.markets.forEach((market: Market) => {
          marketMap.set(market.id, market)
        })
      }

      markets = Array.from(marketMap.values())

      // Series-aware enrichment: if any of these markets are in an active rollover pair,
      // fetch the paired market so the UI can present both choices.
      let computedPairMap: Record<string, { otherId: string; seriesSlug: string }> = {}
      if (markets.length > 0) {
        const supabase = getSupabaseClient();
        const ids = markets.map(m => m.id);
        // Find active pairs where any of these ids are either from or to
        const [{ data: pairsFrom, error: eFrom }, { data: pairsTo, error: eTo }] = await Promise.all([
          supabase
            .from('v_active_rollover_pairs')
            .select('series_id, series_slug, from_market_id, to_market_id')
            .in('from_market_id', ids),
          supabase
            .from('v_active_rollover_pairs')
            .select('series_id, series_slug, from_market_id, to_market_id')
            .in('to_market_id', ids)
        ]);
        if (eFrom) console.warn('pairsFrom error', eFrom.message);
        if (eTo) console.warn('pairsTo error', eTo.message);
        const pairs = [...(pairsFrom || []), ...(pairsTo || [])] as any[];
        if (pairs.length > 0) {
          // Build set of paired market ids we might be missing
          const pairedIds = new Set<string>();
          pairs.forEach(p => {
            if (!marketMap.has(p.from_market_id)) pairedIds.add(p.from_market_id);
            if (!marketMap.has(p.to_market_id)) pairedIds.add(p.to_market_id);
            computedPairMap[p.from_market_id] = { otherId: p.to_market_id, seriesSlug: p.series_slug };
            computedPairMap[p.to_market_id] = { otherId: p.from_market_id, seriesSlug: p.series_slug };
          });
          if (pairedIds.size > 0) {
            // Fetch minimal info for paired markets not already in results
            const { data: extraMkts, error: eMkts } = await supabase
              .from('markets')
              .select('id, symbol, description, icon_image_url, deployment_status, decimals, minimum_order_size, tick_size, category, initial_order, market_config')
              .in('id', Array.from(pairedIds));
            if (!eMkts && extraMkts) {
              extraMkts.forEach((m: any) => {
                // Coerce into our SearchModal Market type shape where possible
                marketMap.set(m.id, {
                  id: m.id,
                  symbol: m.symbol,
                  description: m.description || '',
                  category: Array.isArray(m.category) ? m.category : (m.category ? [m.category] : []),
                  initial_price: 0,
                  price_decimals: Number(m.decimals || 6),
                  banner_image_url: undefined,
                  icon_image_url: m.icon_image_url || undefined,
                  supporting_photo_urls: [],
                  is_active: true,
                  market_id: m.id,
                  deployment_status: (m.deployment_status || '').toLowerCase(),
                  created_at: '',
                  user_address: undefined
                } as Market);
              });
            }
          }
          markets = Array.from(marketMap.values());
          setPairMap(computedPairMap);
        }
      }

      if (usersData.success && usersData.data) {
        users = usersData.data
      }

      const mapById: Record<string, Market> = {};
      markets.forEach((m: Market) => { mapById[m.id] = m; });
      setIdToMarket(mapById);
      setSearchResults({
        markets,
        users,
        isLoading: false,
        error: null
      })

    } catch (error) {
      console.error('Search error:', error)
      setSearchResults({
        markets: [],
        users: [],
        isLoading: false,
        error: 'Search failed. Please try again.'
      })
    }
  }, []) // Remove saveRecentSearch dependency

  // Debounced search effect
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      performSearch(searchValue)
    }, 300) // 300ms delay

    return () => clearTimeout(timeoutId)
  }, [searchValue, performSearch])

  // Handle modal animation
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true)
    } else {
      setIsAnimating(false)
    }
  }, [isOpen])

  // Close modal on escape key
  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('keydown', handleEscape)
      setTimeout(() => inputRef.current?.focus(), 100)
    }

    return () => document.removeEventListener('keydown', handleEscape)
  }, [isOpen, onClose])

  // Close modal when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modalRef.current && !modalRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isOpen, onClose])

  // Handle market selection
  const handleMarketSelect = useCallback((market: Market) => {
    // Save the search term that led to this selection
    if (searchValue.trim()) {
      saveRecentSearch(searchValue)
    }
    // Navigate to market page
    window.location.href = `/token/${market.symbol}`
    onClose()
  }, [onClose, searchValue, saveRecentSearch])

  // Handle user selection
  const handleUserSelect = useCallback((user: UserProfileSearchResult) => {
    // Save the search term that led to this selection
    if (searchValue.trim()) {
      saveRecentSearch(searchValue)
    }
    // You could navigate to user profile page here
     console.log('Selected user:', user)
    onClose()
  }, [onClose, searchValue, saveRecentSearch])

  // Handle recent search selection
  const handleRecentSearchSelect = useCallback((searchTerm: string) => {
    setSearchValue(searchTerm)
  }, [])

  if (!isOpen) return null

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-500 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}>
      {/* Backdrop for click-to-close */}
      <div 
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        ref={modalRef}
        className={`relative z-10 w-full bg-[#0F0F0F] rounded-md border border-[#222222] transition-all duration-200 transform ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        style={{
          maxWidth: '720px',
          maxHeight: '800px',
          padding: '20px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Search Input Section */}
        <div className="mb-3">
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[#606060]">
              {searchResults.isLoading ? (
                <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
              ) : (
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                  <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                </svg>
              )}
            </div>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search markets, categories, and users..."
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              className="w-full bg-[#1A1A1A] hover:bg-[#2A2A2A] border border-[#222222] hover:border-[#333333] rounded-md transition-all duration-200 focus:outline-none focus:border-[#333333] text-white text-sm pl-10 pr-10 py-2.5"
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 rounded-full hover:bg-[#2A2A2A] text-[#606060] hover:text-[#808080] transition-all duration-200"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content Sections */}
        <div className="overflow-y-auto" style={{ maxHeight: '680px' }}>
          {/* Error Message */}
          {searchResults.error && (
            <div className="bg-[#0F0F0F] border border-[#222222] rounded-md p-2.5 mb-3">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-red-400" />
                <span className="text-[11px] font-medium text-red-400">{searchResults.error}</span>
              </div>
            </div>
          )}

          {/* Recent Searches */}
          {!searchValue && recentSearches.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Recent Searches
                </h4>
                <button 
                  onClick={clearRecentSearches}
                  className="text-[10px] text-green-400 hover:text-green-300 uppercase tracking-wide transition-all duration-200"
                >
                  Clear
                </button>
              </div>
              
              <div className="space-y-1">
                {recentSearches.map((searchTerm, index) => (
                  <div
                    key={index}
                    onClick={() => handleRecentSearchSelect(searchTerm)}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                        <svg className="w-3 h-3 text-[#606060]" viewBox="0 0 24 24" fill="none">
                          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[11px] font-medium text-[#808080]">
                          {searchTerm}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending Categories */}
          {!searchValue && (
            <div className="mb-3">
              <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">
                Trending Categories
              </h4>
              
              <div className="grid grid-cols-2 gap-2">
                {['DeFi', 'Gaming', 'NFT', 'AI', 'Crypto', 'Prediction'].map((category) => (
                  <div
                    key={category}
                    onClick={() => setSearchValue(category)}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                        <div className="flex items-center gap-1.5">
                          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                            #
                          </div>
                          <span className="text-[11px] font-medium text-[#808080]">
                            {category}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results - Markets */}
          {searchValue && searchResults.markets.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Markets
                </h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {searchResults.markets.length}
                </div>
              </div>
              
              <div className="space-y-1">
                {searchResults.markets.map((market) => (
                  (() => {
                    const deploymentStatus = String(market.deployment_status || '').toLowerCase();
                    const metricSource = metricSourceFromMarket(market);
                    const metricSourceText =
                      metricSource.label || metricSource.host || (metricSource.url ? metricSource.url : '—');
                    return (
                  <div
                    key={market.id}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200"
                  >
                    <div
                      className="flex items-center justify-between p-2.5 cursor-pointer"
                      role="button"
                      tabIndex={0}
                      aria-label={`Open market ${market.symbol}`}
                      onClick={() => handleMarketSelect(market)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          handleMarketSelect(market)
                        }
                      }}
                    >
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${deploymentStatus === 'deployed' ? 'bg-green-400' : 'bg-yellow-400'}`} />
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          {market.icon_image_url ? (
                            <div 
                              className="w-6 h-6 rounded bg-cover bg-center bg-no-repeat"
                              style={{ backgroundImage: `url(${market.icon_image_url})` }}
                            />
                          ) : (
                            <div className={`flex items-center justify-center rounded text-[9px] font-medium w-6 h-6 ${
                              deploymentStatus === 'deployed' ? 'bg-green-400 text-black' : 'bg-yellow-400 text-black'
                            }`}>
                              {market.symbol.charAt(0).toUpperCase()}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="text-left text-[11px] font-medium text-white group-hover:underline">
                              {market.symbol}
                            </div>
                            <div className="text-[10px] text-[#606060] truncate max-w-[200px]">
                              {market.description}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right min-w-[92px]">
                          <div className="text-[10px] text-white font-mono">
                            {formatUsdNumber(market.initial_price, market.price_decimals ?? 4)}
                          </div>
                          <div className={`text-[9px] ${
                            deploymentStatus === 'deployed' ? 'text-green-400' : 'text-yellow-400'
                          }`}>
                            {deploymentStatus || '—'}
                          </div>
                        </div>
                        <div className="w-px h-6 bg-[#222222]" />
                        <div className="text-right min-w-[110px] max-w-[160px]">
                          <div
                            className="text-[10px] text-[#8a8a8a] leading-none truncate"
                            title={metricSource.url || undefined}
                          >
                            {metricSource.url ? (
                              <a
                                href={metricSource.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="hover:underline"
                              >
                                {metricSourceText}
                              </a>
                            ) : (
                              '—'
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                    {/* Expandable Details (only expands for this row on hover) */}
                    <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                      <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                        <div className="text-[9px] pt-1.5">
                          <div className="flex flex-wrap gap-1">
                            {(() => {
                              // Convert category to array if it's a string
                              const categories = Array.isArray(market.category)
                                ? market.category
                                : typeof market.category === 'string'
                                  ? market.category.split(',').map(c => c.trim())
                                  : [];
                              
                              return (
                                <>
                                  {categories.slice(0, 3).map((cat, index) => (
                                    <span
                                      key={index}
                                      className="text-[9px] text-green-400 bg-green-400/10 px-1 py-0.5 rounded border border-green-400/20"
                                    >
                                      {cat}
                                    </span>
                                  ))}
                                  {categories.length > 3 && (
                                    <span className="text-[9px] text-[#606060] bg-[#1A1A1A] px-1 py-0.5 rounded">
                                      +{categories.length - 3}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                            {/* Inline series toggle if in active rollover */}
                            {pairMap[market.id] && idToMarket[pairMap[market.id].otherId] && (
                              <div className="flex items-center gap-2 mt-1 w-full">
                                <MarketPairBadge text={pairMap[market.id].seriesSlug} />
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleMarketSelect(market)}
                                    className="text-[10px] rounded px-2 py-1 transition-all duration-200 text-white bg-[#1A1A1A] border border-[#333333]"
                                  >
                                    {market.symbol}
                                  </button>
                                  <button
                                    onClick={() => handleMarketSelect(idToMarket[pairMap[market.id].otherId])}
                                    className="text-[10px] rounded px-2 py-1 transition-all duration-200 text-[#808080] bg-[#0F0F0F] border border-[#222222] hover:text-white hover:bg-[#1A1A1A] hover:border-[#333333]"
                                  >
                                    {idToMarket[pairMap[market.id].otherId].symbol}
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                    );
                  })()
                ))}
              </div>
            </div>
          )}

          {/* Search Results - Users */}
          {searchValue && searchResults.users.length > 0 && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">
                  Users
                </h4>
                <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                  {searchResults.users.length}
                </div>
              </div>
              
              <div className="space-y-1">
                {searchResults.users.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => handleUserSelect(user)}
                    className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400" />
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <div 
                            className="flex items-center justify-center text-[9px] font-medium rounded-full w-6 h-6"
                            style={{
                              backgroundColor: user.profile_image_url ? 'transparent' : '#404040',
                              backgroundImage: user.profile_image_url ? `url(${user.profile_image_url})` : undefined,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                              color: '#ffffff'
                            }}
                          >
                            {!user.profile_image_url && (user.display_name || user.username || user.wallet_address).charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-medium text-white">
                              {user.display_name || user.username || 'Anonymous User'}
                            </div>
                            <div className="text-[10px] text-[#606060] font-mono">
                              {user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                        <svg className="w-3 h-3 text-[#404040]" viewBox="0 0 24 24" fill="none">
                          <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No Results Message */}
          {searchValue && !searchResults.isLoading && searchResults.markets.length === 0 && searchResults.users.length === 0 && !searchResults.error && (
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      No results found for "{searchValue}"
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                  <svg className="w-3 h-3 text-[#404040]" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">Try searching for market symbols, categories, or usernames</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!searchValue && recentSearches.length === 0 && (
            <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-[#808080]">
                      Search Dexextra
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-[#404040]" />
                  <svg className="w-3 h-3 text-[#404040]" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-[#606060]">Find smart contract markets by symbol or category, and user accounts</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 