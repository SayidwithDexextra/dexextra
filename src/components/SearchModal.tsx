'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import searchModalDesign from '../../design/searchModal.json'
import { getSupabaseClient } from '@/lib/supabase-browser'
import MarketPairBadge from './Series/MarketPairBadge'
import { metricSourceFromMarket } from '@/lib/metricSource'
import { DEFAULT_PROFILE_IMAGE } from '@/types/userProfile'

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
  const router = useRouter()
  const [searchValue, setSearchValue] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResults>({
    markets: [],
    users: [],
    isLoading: false,
    error: null
  })
  
  const [isMobile, setIsMobile] = useState(false)

  // Track mount state for portal rendering (document.body not available during SSR)
  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = () => setIsMobile(mq.matches)
    handler()
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  const [pairMap, setPairMap] = useState<Record<string, { otherId: string; seriesSlug: string }>>({})
  const [idToMarket, setIdToMarket] = useState<Record<string, Market>>({})
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const [showAllUsers, setShowAllUsers] = useState(false)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const usersScrollRef = useRef<HTMLDivElement>(null)

  const design = searchModalDesign.searchModal

  const formatUsdNumber = useCallback((value: number, decimals?: number) => {
    const safe = Number.isFinite(value) ? value : 0
    const dRaw = typeof decimals === 'number' && Number.isFinite(decimals) ? Math.floor(decimals) : 4
    const maxD = Math.max(0, Math.min(dRaw, 8))
    const minD = Math.min(2, maxD) // keep 2dp when available, trim extra trailing zeros
    const rounded = Number(safe.toFixed(maxD))
    return `$${new Intl.NumberFormat('en-US', {
      minimumFractionDigits: minD,
      maximumFractionDigits: maxD,
    }).format(rounded)}`
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

  const updateScrollArrows = useCallback(() => {
    const el = usersScrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 2)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = usersScrollRef.current
    if (!el) return
    updateScrollArrows()
    el.addEventListener('scroll', updateScrollArrows, { passive: true })
    const ro = new ResizeObserver(updateScrollArrows)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', updateScrollArrows)
      ro.disconnect()
    }
  }, [searchResults.users, updateScrollArrows, showAllUsers])

  const scrollUsers = useCallback((direction: 'left' | 'right') => {
    const el = usersScrollRef.current
    if (!el) return
    const scrollAmount = 300
    el.scrollBy({ left: direction === 'left' ? -scrollAmount : scrollAmount, behavior: 'smooth' })
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
      // Use full-text search for markets (handles multi-word queries, partial matches)
      const [marketsResponse, usersResponse] = await Promise.all([
        fetch(`/api/markets?fts=${encodeURIComponent(searchTerm)}&limit=15`),
        fetch(`/api/profile/search?q=${encodeURIComponent(searchTerm)}&limit=10`)
      ])

      const marketsData = await marketsResponse.json()
      const usersData = await usersResponse.json()

      let markets: Market[] = []
      let users: UserProfileSearchResult[] = []

      // Build market map from FTS results (already relevance-ordered from API)
      const marketMap = new Map<string, Market>()
      
      if (marketsData.success && marketsData.markets) {
        marketsData.markets.forEach((market: Market) => {
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
    setShowAllUsers(false)
    const timeoutId = setTimeout(() => {
      performSearch(searchValue)
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [searchValue, performSearch])

  // Handle modal animation and body scroll lock
  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true)
      // Prevent body scrolling when modal is open
      document.body.style.overflow = 'hidden'
    } else {
      setIsAnimating(false)
      // Restore body scrolling when modal is closed
      document.body.style.overflow = ''
    }
    
    return () => {
      // Cleanup: restore body scrolling on unmount
      document.body.style.overflow = ''
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
    router.push(`/token/${encodeURIComponent(market.market_identifier || market.symbol)}`)
    onClose()
  }, [onClose, router, searchValue, saveRecentSearch])

  // Handle user selection
  const handleUserSelect = useCallback((user: UserProfileSearchResult) => {
    // Save the search term that led to this selection
    if (searchValue.trim()) {
      saveRecentSearch(searchValue)
    }
    // Navigate to user profile page by wallet address
    router.push(`/user/${encodeURIComponent(user.wallet_address)}`)
    onClose()
  }, [onClose, router, searchValue, saveRecentSearch])

  // Handle recent search selection
  const handleRecentSearchSelect = useCallback((searchTerm: string) => {
    setSearchValue(searchTerm)
  }, [])

  if (!isOpen || !mounted) return null

  const modalContent = (
    <div 
      className={isMobile ? 'fixed inset-0 z-[9999]' : `fixed inset-0 z-[9999] flex items-center justify-center p-4 transition-opacity duration-500 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
      style={isMobile ? undefined : {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
      }}
    >
      {/* Backdrop */}
      <div 
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />
      
      {/* Modal panel */}
      <div 
        ref={modalRef}
        className={isMobile
          ? 'fixed left-0 top-0 bg-t-card transition-transform duration-300 ease-in-out flex flex-col'
          : `relative z-10 w-full bg-t-card rounded-md border border-t-stroke transition-all duration-200 transform ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`
        }
        style={isMobile ? {
          width: '100vw',
          height: '100dvh',
          zIndex: 10000,
          transform: isAnimating ? 'translateX(0)' : 'translateX(100%)',
          overflowX: 'hidden',
          overflowY: 'hidden',
        } : {
          maxWidth: '900px',
          maxHeight: '85vh',
          padding: '24px',
          boxShadow: 'var(--t-shadow-lg)',
          margin: 'auto',
        }}
      >
        {/* Mobile header bar */}
        {isMobile && (
          <div
            className="flex items-center justify-between flex-shrink-0"
            style={{ height: '56px', padding: '0 12px 0 16px', borderBottom: '1px solid var(--t-stroke)' }}
          >
            <span className="text-t-fg text-base font-semibold">Search</span>
            <button
              onClick={onClose}
              className="w-10 h-10 rounded-full flex items-center justify-center border border-t-stroke text-t-fg-label hover:text-t-fg hover:border-t-stroke-hover transition-all duration-200"
              aria-label="Close search"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}

        {/* Inner scrollable area (on mobile: flex-1 with padding; on desktop: direct children) */}
        <div className={isMobile ? 'flex-1 overflow-y-auto' : ''} style={isMobile ? { padding: '12px 16px' } : undefined}>
        {/* Search Input Section */}
        <div className={isMobile ? 'mb-2' : 'mb-3'}>
          <div className="relative">
            <div className="absolute left-3 top-1/2 transform -translate-y-1/2 text-t-fg-muted">
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
              className={isMobile
                ? 'w-full bg-t-inset hover:bg-t-skeleton border border-t-stroke hover:border-t-stroke-hover rounded-md transition-all duration-200 focus:outline-none focus:border-t-stroke-hover text-t-fg text-base pl-10 pr-10 py-3'
                : 'w-full bg-t-inset hover:bg-t-skeleton border border-t-stroke hover:border-t-stroke-hover rounded-md transition-all duration-200 focus:outline-none focus:border-t-stroke-hover text-t-fg text-sm pl-10 pr-10 py-2.5'
              }
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 rounded-full hover:bg-t-skeleton text-t-fg-muted hover:text-t-fg-sub transition-all duration-200"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content Sections */}
        <div className="search-modal-scroll overflow-y-auto" style={{ maxHeight: isMobile ? 'calc(100dvh - 140px)' : 'calc(85vh - 100px)' }}>
          {/* Error Message */}
          {searchResults.error && (
            <div className="bg-t-card border border-t-stroke rounded-md p-2.5 mb-3">
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
                <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">
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
                    className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                        <svg className="w-3 h-3 text-t-fg-muted" viewBox="0 0 24 24" fill="none">
                          <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                        <span className="text-[11px] font-medium text-t-fg-sub">
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
              <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide mb-2">
                Trending Categories
              </h4>
              
              <div className="grid grid-cols-2 gap-2">
                {['DeFi', 'Gaming', 'NFT', 'AI', 'Crypto', 'Prediction'].map((category) => (
                  <div
                    key={category}
                    onClick={() => setSearchValue(category)}
                    className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200 cursor-pointer"
                  >
                    <div className="flex items-center justify-between p-2.5">
                      <div className="flex items-center gap-2 min-w-0 flex-1">
                        <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                        <div className="flex items-center gap-1.5">
                          <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                            #
                          </div>
                          <span className="text-[11px] font-medium text-t-fg-sub">
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

          {/* Search Results - Markets (hidden in show-all-users mode) */}
          {searchValue && searchResults.markets.length > 0 && (
            <div
              className="mb-3 transition-all duration-300"
              style={{
                maxHeight: showAllUsers ? 0 : '1000px',
                opacity: showAllUsers ? 0 : 1,
                overflow: 'hidden',
                marginBottom: showAllUsers ? 0 : undefined,
              }}
            >
              <div className="flex items-center justify-between mb-2">
                <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">
                  Markets
                </h4>
                <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                  {searchResults.markets.length}
                </div>
              </div>
              
              <div className="relative">
              <div className="space-y-1 overflow-y-auto markets-internal-scroll" style={{ maxHeight: '320px' }}>
                {searchResults.markets.map((market) => (
                  (() => {
                    const deploymentStatus = String(market.deployment_status || '').toLowerCase();
                    const metricSource = metricSourceFromMarket(market);
                    const metricSourceText =
                      metricSource.label || metricSource.host || (metricSource.url ? metricSource.url : '—');
                    return (
                  <div
                    key={market.id}
                    className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200"
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
                            <div className="text-left text-[13px] font-medium text-t-fg group-hover:underline">
                              {market.symbol}
                            </div>
                            <div className="text-[11px] text-t-fg-muted truncate max-w-[200px]">
                              {market.description}
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right min-w-[92px]">
                          <div className="text-[11px] text-t-fg font-mono">
                            {formatUsdNumber(market.initial_price, market.price_decimals ?? 4)}
                          </div>
                          <div className={`text-[10px] ${
                            deploymentStatus === 'deployed' ? 'text-green-400' : 'text-yellow-400'
                          }`}>
                            {deploymentStatus || '—'}
                          </div>
                        </div>
                        <div className="w-px h-6 bg-t-stroke" />
                        <div className="text-right min-w-[110px] max-w-[160px]">
                          <div
                            className="text-[11px] text-t-fg-sub leading-none truncate"
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
                      <div className="px-2.5 pb-2 border-t border-t-stroke-sub">
                        <div className="text-[9px] pt-1.5">
                          <div className="flex flex-wrap gap-1">
                            {(() => {
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
                                    <span className="text-[9px] text-t-fg-muted bg-t-inset px-1 py-0.5 rounded">
                                      +{categories.length - 3}
                                    </span>
                                  )}
                                </>
                              );
                            })()}
                            {pairMap[market.id] && idToMarket[pairMap[market.id].otherId] && (
                              <div className="flex items-center gap-2 mt-1 w-full">
                                <MarketPairBadge text={pairMap[market.id].seriesSlug} />
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleMarketSelect(market)}
                                    className="text-[10px] rounded px-2 py-1 transition-all duration-200 text-t-fg bg-t-inset border border-t-stroke-hover"
                                  >
                                    {market.symbol}
                                  </button>
                                  <button
                                    onClick={() => handleMarketSelect(idToMarket[pairMap[market.id].otherId])}
                                    className="text-[10px] rounded px-2 py-1 transition-all duration-200 text-t-fg-sub bg-t-card border border-t-stroke hover:text-t-fg hover:bg-t-card-hover hover:border-t-stroke-hover"
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
              {searchResults.markets.length > 6 && (
                <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-10 bg-gradient-to-t from-t-card to-transparent rounded-b-md" />
              )}
              </div>
            </div>
          )}

          {/* Search Results - Users */}
          {searchValue && searchResults.users.length > 0 && (
            <div className={`transition-all duration-300 ease-in-out ${showAllUsers ? 'flex-1' : 'mb-3'}`}>
              <div className="flex items-center justify-between mb-3">
                {showAllUsers ? (
                  <button
                    onClick={() => setShowAllUsers(false)}
                    className="flex items-center gap-2 text-[11px] text-t-fg-sub hover:text-t-fg transition-colors group"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="transition-transform group-hover:-translate-x-0.5">
                      <path d="M19 12H5M5 12L12 19M5 12L12 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                    <span>Back to results</span>
                  </button>
                ) : (
                  <h4 className="text-xs font-medium text-t-fg-label uppercase tracking-wide">
                    Users
                  </h4>
                )}
                {!showAllUsers && (
                  <button
                    onClick={() => setShowAllUsers(true)}
                    className="text-[11px] text-t-fg-sub hover:text-t-fg hover:underline transition-colors"
                  >
                    Show all
                  </button>
                )}
                {showAllUsers && (
                  <div className="text-[10px] text-t-fg-muted bg-t-inset px-1.5 py-0.5 rounded">
                    {searchResults.users.length} users
                  </div>
                )}
              </div>

              {showAllUsers ? (
                <div className="users-grid-scroll overflow-y-auto animate-users-expand" style={{ maxHeight: 'calc(85vh - 160px)' }}>
                  <div className="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-6 gap-3">
                    {searchResults.users.map((user, i) => (
                      <div
                        key={user.id}
                        onClick={() => handleUserSelect(user)}
                        className="group flex flex-col items-center cursor-pointer transition-all duration-200 p-3 rounded-lg hover:bg-t-card-hover animate-user-bubble-in"
                        style={{ animationDelay: `${i * 30}ms` }}
                      >
                        <div
                          className="flex items-center justify-center text-2xl font-semibold rounded-full w-[90px] h-[90px] mb-2 transition-all duration-200 shadow-lg group-hover:shadow-xl group-hover:scale-105"
                          style={{
                            backgroundImage: `url('${user.profile_image_url || DEFAULT_PROFILE_IMAGE}')`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          }}
                        >
                        </div>
                        <div className="text-center w-full">
                          <div className="text-[13px] font-semibold text-t-fg truncate">
                            {user.display_name || user.username || 'Anonymous'}
                          </div>
                          <div className="text-[11px] text-t-fg-label">
                            User
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="relative">
                  {canScrollLeft && (
                    <button
                      onClick={() => scrollUsers('left')}
                      className="absolute left-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-t-inset/90 border border-t-stroke-hover text-t-fg-sub hover:text-t-fg hover:bg-t-skeleton transition-all duration-200 shadow-lg backdrop-blur-sm"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  )}
                  {canScrollRight && (
                    <button
                      onClick={() => scrollUsers('right')}
                      className="absolute right-0 top-1/2 -translate-y-1/2 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-t-inset/90 border border-t-stroke-hover text-t-fg-sub hover:text-t-fg hover:bg-t-skeleton transition-all duration-200 shadow-lg backdrop-blur-sm"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </button>
                  )}
                  {canScrollLeft && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-12 bg-gradient-to-r from-t-card to-transparent z-[5]" />
                  )}
                  {canScrollRight && (
                    <div className="pointer-events-none absolute right-0 top-0 bottom-0 w-12 bg-gradient-to-l from-t-card to-transparent z-[5]" />
                  )}
                  <div ref={usersScrollRef} className="overflow-x-auto overflow-y-hidden users-horizontal-scroll -mx-2 px-2">
                    <div className="flex gap-4 pb-2" style={{ minWidth: 'max-content' }}>
                      {searchResults.users.map((user) => (
                        <div
                          key={user.id}
                          onClick={() => handleUserSelect(user)}
                          className="group flex flex-col items-start cursor-pointer transition-all duration-200 flex-shrink-0 p-3 rounded-lg hover:bg-t-card-hover"
                          style={{ width: '140px' }}
                        >
                          <div
                            className="flex items-center justify-center text-3xl font-semibold rounded-full w-[115px] h-[115px] mb-3 transition-all duration-200 shadow-lg group-hover:shadow-xl"
                            style={{
                              backgroundImage: `url('${user.profile_image_url || DEFAULT_PROFILE_IMAGE}')`,
                              backgroundSize: 'cover',
                              backgroundPosition: 'center',
                            }}
                          >
                          </div>
                          <div className="text-left w-full">
                            <div className="text-[14px] font-semibold text-t-fg truncate">
                              {user.display_name || user.username || 'Anonymous'}
                            </div>
                            <div className="text-[12px] text-t-fg-label">
                              User
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* No Results Message */}
          {searchValue && !searchResults.isLoading && searchResults.markets.length === 0 && searchResults.users.length === 0 && !searchResults.error && (
            <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-t-fg-sub">
                      No results found for "{searchValue}"
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-t-dot" />
                  <svg className="w-3 h-3 text-t-dot" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-t-stroke-sub">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-t-fg-muted">Try searching for market symbols, categories, or usernames</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!searchValue && recentSearches.length === 0 && (
            <div className="group bg-t-card hover:bg-t-card-hover rounded-md border border-t-stroke hover:border-t-stroke-hover transition-all duration-200">
              <div className="flex items-center justify-between p-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-t-dot" />
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="text-[11px] font-medium text-t-fg-sub">
                      Search Dexextra
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-t-dot" />
                  <svg className="w-3 h-3 text-t-dot" viewBox="0 0 24 24" fill="none">
                    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
              </div>
              <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
                <div className="px-2.5 pb-2 border-t border-t-stroke-sub">
                  <div className="text-[9px] pt-1.5">
                    <span className="text-t-fg-muted">Find smart contract markets by symbol or category, and user accounts</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        <style jsx>{`
          .search-modal-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .search-modal-scroll::-webkit-scrollbar {
            width: 0px;
            height: 0px;
          }

          .markets-internal-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--t-stroke-hover) transparent;
          }

          .markets-internal-scroll::-webkit-scrollbar {
            width: 4px;
          }

          .markets-internal-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .markets-internal-scroll::-webkit-scrollbar-thumb {
            background-color: var(--t-stroke-hover);
            border-radius: 4px;
          }

          .markets-internal-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--t-dot);
          }

          .users-horizontal-scroll {
            scrollbar-width: none;
            -ms-overflow-style: none;
          }

          .users-horizontal-scroll::-webkit-scrollbar {
            display: none;
          }

          .users-grid-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--t-stroke-hover) transparent;
          }

          .users-grid-scroll::-webkit-scrollbar {
            width: 4px;
          }

          .users-grid-scroll::-webkit-scrollbar-track {
            background: transparent;
          }

          .users-grid-scroll::-webkit-scrollbar-thumb {
            background-color: var(--t-stroke-hover);
            border-radius: 4px;
          }

          .users-grid-scroll::-webkit-scrollbar-thumb:hover {
            background-color: var(--t-dot);
          }

          .animate-users-expand {
            animation: usersExpand 300ms ease-out forwards;
          }

          @keyframes usersExpand {
            from {
              opacity: 0;
              transform: translateY(20px);
            }
            to {
              opacity: 1;
              transform: translateY(0);
            }
          }

          .animate-user-bubble-in {
            animation: bubbleIn 250ms ease-out both;
          }

          @keyframes bubbleIn {
            from {
              opacity: 0;
              transform: scale(0.85);
            }
            to {
              opacity: 1;
              transform: scale(1);
            }
          }
        `}</style>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
} 