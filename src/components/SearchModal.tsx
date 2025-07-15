'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import searchModalDesign from '../../design/searchModal.json'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

// Import types for real data structures
interface VAMMMarket {
  id: string;
  symbol: string;
  description: string;
  category: string[];
  oracle_address: string;
  initial_price: number;
  price_decimals: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  deployment_fee: number;
  is_active: boolean;
  vamm_address?: string;
  vault_address?: string;
  market_id?: string;
  deployment_status: string;
  created_at: string;
  user_address?: string;
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
  markets: VAMMMarket[];
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
  const [recentSearches, setRecentSearches] = useState<string[]>([])
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const design = searchModalDesign.searchModal

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

      let markets: VAMMMarket[] = []
      let users: UserProfileSearchResult[] = []

      // Combine symbol and category search results, removing duplicates
      const marketMap = new Map<string, VAMMMarket>()
      
      if (marketsSymbolData.success && marketsSymbolData.markets) {
        marketsSymbolData.markets.forEach((market: VAMMMarket) => {
          marketMap.set(market.id, market)
        })
      }

      if (marketsCategoryData.success && marketsCategoryData.markets) {
        marketsCategoryData.markets.forEach((market: VAMMMarket) => {
          marketMap.set(market.id, market)
        })
      }

      markets = Array.from(marketMap.values())

      if (usersData.success && usersData.data) {
        users = usersData.data
      }

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
  const handleMarketSelect = useCallback((market: VAMMMarket) => {
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
        className={`absolute inset-0 transition-opacity duration-200 ${isAnimating ? 'opacity-100' : 'opacity-0'}`}
        style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
        onClick={onClose}
      />
      
      {/* Modal */}
      <div 
        ref={modalRef}
        className={`relative z-10 w-full transition-all duration-200 transform ${isAnimating ? 'opacity-100 scale-100' : 'opacity-0 scale-95'}`}
        style={{
          maxWidth: '720px',
          maxHeight: '800px',
          backgroundColor: '#1a1a1a',
          borderRadius: '12px',
          padding: '28px',
          border: '1px solid #333333',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)'
        }}
      >
        {/* Search Input Section */}
        <div style={{ marginBottom: '16px' }}>
          <div className="relative">
            <div 
              className="absolute left-3 top-1/2 transform -translate-y-1/2"
              style={{ color: design.colors.text.secondary }}
            >
              {searchResults.isLoading ? (
                <div className="animate-spin w-4 h-4 border-2 border-current border-t-transparent rounded-full" />
              ) : (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
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
              className="w-full transition-all duration-200 focus:outline-none"
              style={{
                height: '40px',
                padding: '8px 12px',
                paddingLeft: '40px',
                paddingRight: searchValue ? '40px' : '12px',
                borderRadius: '8px',
                fontSize: '14px',
                fontFamily: design.typography.fontFamily.primary,
                backgroundColor: '#2a2a2a',
                border: '1px solid #444444',
                color: design.colors.text.primary,
                boxShadow: 'none'
              }}
              onFocus={(e) => {
                e.target.style.borderColor = '#555555'
                e.target.style.boxShadow = '0 0 0 2px rgba(255, 255, 255, 0.05)'
              }}
              onBlur={(e) => {
                e.target.style.borderColor = '#444444'
                e.target.style.boxShadow = 'none'
              }}
            />
            {searchValue && (
              <button
                onClick={() => setSearchValue('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 p-1 rounded-full transition-all duration-200"
                style={{ color: design.colors.text.secondary }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'transparent'
                }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* Content Sections */}
        <div 
          className="overflow-y-auto"
          style={{ 
            maxHeight: '680px'
          }}
        >
          {/* Error Message */}
          {searchResults.error && (
            <div 
              className="mb-4 p-3 rounded-lg border"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                borderColor: 'rgba(239, 68, 68, 0.3)',
                color: '#f87171'
              }}
            >
              <div className="text-sm">{searchResults.error}</div>
            </div>
          )}

          {/* Recent Searches */}
          {!searchValue && recentSearches.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 
                  style={{
                    fontSize: '11px',
                    fontWeight: '600',
                    color: '#888888',
                    fontFamily: design.typography.fontFamily.primary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                >
                  Recent Searches
                </h3>
                <button 
                  onClick={clearRecentSearches}
                  className="text-sm transition-all duration-200"
                  style={{ 
                    color: '#00d4aa',
                    fontSize: '11px',
                    fontFamily: design.typography.fontFamily.primary,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.textDecoration = 'underline'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.textDecoration = 'none'
                  }}
                >
                  Clear
                </button>
              </div>
              
              <div className="space-y-1">
                {recentSearches.map((searchTerm, index) => (
                  <div
                    key={index}
                    onClick={() => handleRecentSearchSelect(searchTerm)}
                    className="flex items-center cursor-pointer transition-all duration-150"
                    style={{
                      height: '36px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #333333'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a2a'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" stroke="#888888" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                      <span 
                        style={{
                          color: design.colors.text.primary,
                          fontSize: '13px',
                          fontWeight: '400',
                          fontFamily: design.typography.fontFamily.primary
                        }}
                      >
                        {searchTerm}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trending Categories */}
          {!searchValue && (
            <div style={{ marginBottom: '16px' }}>
              <h3 
                className="mb-2"
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#888888',
                  fontFamily: design.typography.fontFamily.primary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Trending Categories
              </h3>
              
              <div className="grid grid-cols-2 gap-2">
                {['DeFi', 'Gaming', 'NFT', 'AI', 'Crypto', 'Prediction'].map((category) => (
                  <div
                    key={category}
                    onClick={() => setSearchValue(category)}
                    className="flex items-center cursor-pointer transition-all duration-150"
                    style={{
                      height: '36px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #333333'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a2a'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="flex items-center justify-center rounded text-xs font-semibold"
                        style={{
                          width: '20px',
                          height: '20px',
                          backgroundColor: '#00d4aa',
                          color: '#000000'
                        }}
                      >
                        #
                      </div>
                      <span 
                        style={{
                          color: design.colors.text.primary,
                          fontSize: '13px',
                          fontWeight: '400',
                          fontFamily: design.typography.fontFamily.primary
                        }}
                      >
                        {category}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results - Markets */}
          {searchValue && searchResults.markets.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h3 
                className="mb-2"
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#888888',
                  fontFamily: design.typography.fontFamily.primary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Markets ({searchResults.markets.length})
              </h3>
              
              <div className="space-y-1">
                {searchResults.markets.map((market) => (
                  <div
                    key={market.id}
                    onClick={() => handleMarketSelect(market)}
                    className="flex items-center justify-between cursor-pointer transition-all duration-150"
                    style={{
                      height: '44px',
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #333333'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a2a'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="flex items-center justify-center rounded-full text-xs font-semibold"
                        style={{
                          width: '24px',
                          height: '24px',
                          backgroundColor: market.deployment_status === 'deployed' ? '#00d4aa' : '#fbbf24',
                          color: '#000000'
                        }}
                      >
                        {market.symbol.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div 
                          style={{
                            color: design.colors.text.primary,
                            fontSize: '13px',
                            fontWeight: '500',
                            fontFamily: design.typography.fontFamily.primary
                          }}
                        >
                          {market.symbol}
                        </div>
                        <div 
                          style={{
                            color: design.colors.text.secondary,
                            fontSize: '11px',
                            fontFamily: design.typography.fontFamily.primary,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            maxWidth: '200px',
                            marginBottom: '2px'
                          }}
                        >
                          {market.description}
                        </div>
                        {/* Category badges */}
                        <div className="flex flex-wrap gap-1">
                          {market.category.slice(0, 2).map((cat, index) => (
                            <span
                              key={index}
                              style={{
                                fontSize: '9px',
                                fontWeight: '500',
                                color: '#00d4aa',
                                backgroundColor: 'rgba(0, 212, 170, 0.1)',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                border: '1px solid rgba(0, 212, 170, 0.3)',
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px'
                              }}
                            >
                              {cat}
                            </span>
                          ))}
                          {market.category.length > 2 && (
                            <span
                              style={{
                                fontSize: '9px',
                                fontWeight: '500',
                                color: design.colors.text.secondary,
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                padding: '1px 4px',
                                borderRadius: '3px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.3px'
                              }}
                            >
                              +{market.category.length - 2}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div 
                        style={{
                          color: design.colors.text.primary,
                          fontSize: '13px',
                          fontWeight: '500',
                          fontFamily: design.typography.fontFamily.primary
                        }}
                      >
                        ${market.initial_price.toFixed(4)}
                      </div>
                      <div 
                        style={{
                          color: market.deployment_status === 'deployed' 
                            ? design.colors.status.positive 
                            : design.colors.text.secondary,
                          fontSize: '11px',
                          fontWeight: '500',
                          textTransform: 'capitalize'
                        }}
                      >
                        {market.deployment_status}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Search Results - Users */}
          {searchValue && searchResults.users.length > 0 && (
            <div style={{ marginBottom: '16px' }}>
              <h3 
                className="mb-2"
                style={{
                  fontSize: '11px',
                  fontWeight: '600',
                  color: '#888888',
                  fontFamily: design.typography.fontFamily.primary,
                  textTransform: 'uppercase',
                  letterSpacing: '0.5px'
                }}
              >
                Users ({searchResults.users.length})
              </h3>
              
              <div className="space-y-1">
                {searchResults.users.map((user) => (
                  <div
                    key={user.id}
                    onClick={() => handleUserSelect(user)}
                    className="flex items-center cursor-pointer transition-all duration-150"
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: '#2a2a2a',
                      border: '1px solid #333333',
                      minHeight: '44px'
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.08)'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = '#2a2a2a'
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div 
                        className="flex items-center justify-center text-sm rounded-full"
                        style={{
                          width: '24px',
                          height: '24px',
                          backgroundColor: user.profile_image_url ? 'transparent' : '#444444',
                          backgroundImage: user.profile_image_url ? `url(${user.profile_image_url})` : undefined,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center'
                        }}
                      >
                        {!user.profile_image_url && (user.display_name || user.username || user.wallet_address).charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div 
                          style={{
                            color: design.colors.text.primary,
                            fontSize: '13px',
                            fontWeight: '500',
                            fontFamily: design.typography.fontFamily.primary
                          }}
                        >
                          {user.display_name || user.username || 'Anonymous User'}
                        </div>
                        <div 
                          style={{
                            color: design.colors.text.secondary,
                            fontSize: '11px',
                            fontFamily: design.typography.fontFamily.mono
                          }}
                        >
                          {user.wallet_address.slice(0, 6)}...{user.wallet_address.slice(-4)}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* No Results Message */}
          {searchValue && !searchResults.isLoading && searchResults.markets.length === 0 && searchResults.users.length === 0 && !searchResults.error && (
            <div 
              className="text-center py-8"
              style={{ color: design.colors.text.secondary }}
            >
              <div className="mb-2">
                <svg className="mx-auto w-12 h-12 opacity-50" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zM13 17h-2v-6h2v6zm0-8h-2V7h2v2z"/>
                </svg>
              </div>
              <div className="text-sm">No markets or users found for "{searchValue}"</div>
              <div className="text-xs mt-1 opacity-75">Try searching for market symbols, categories, or usernames</div>
            </div>
          )}

          {/* Empty State */}
          {!searchValue && recentSearches.length === 0 && (
            <div 
              className="text-center py-8"
              style={{ color: design.colors.text.secondary }}
            >
              <div className="mb-4">
                <svg className="mx-auto w-12 h-12 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
              </div>
              <div className="text-sm mb-1">Search Dexextra</div>
              <div className="text-xs opacity-75">Find smart contract markets by symbol or category, and user accounts</div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
} 