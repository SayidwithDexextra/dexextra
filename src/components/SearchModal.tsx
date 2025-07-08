'use client'

import { useState, useEffect, useRef } from 'react'
import searchModalDesign from '../../design/searchModal.json'

interface SearchModalProps {
  isOpen: boolean
  onClose: () => void
}

interface RecentSearch {
  id: string
  name: string
  symbol: string
  price: string
  change: string
  isPositive: boolean
}

interface TrendingCollection {
  id: string
  name: string
  items: string
  price: string
  avatar: string
  verified: boolean
}

interface TopToken {
  id: string
  name: string
  symbol: string
  price: string
  change: string
  isPositive: boolean
}

export default function SearchModal({ isOpen, onClose }: SearchModalProps) {
  const [searchValue, setSearchValue] = useState('')
  const [isAnimating, setIsAnimating] = useState(false)
  const modalRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const design = searchModalDesign.searchModal

  // Mock data matching the image
  const recentSearches: RecentSearch[] = [
    {
      id: '1',
      name: 'Startup',
      symbol: 'STARTUP',
      price: '$0.03952',
      change: '+71.6%',
      isPositive: true
    }
  ]

  const trendingCollections: TrendingCollection[] = [
    {
      id: '1',
      name: 'Larvva Lads',
      items: '19.1K items',
      price: '$12.04',
      avatar: '🦄',
      verified: true
    },
    {
      id: '2',
      name: 'DX Terminal',
      items: '36.7K items', 
      price: '$9.58',
      avatar: '💎',
      verified: true
    },
    {
      id: '3',
      name: 'Courtyard.io',
      items: '204.9K items',
      price: '$10.06',
      avatar: '🏛️',
      verified: true
    }
  ]

  const topTokens: TopToken[] = [
    {
      id: '1',
      name: 'Startup',
      symbol: 'STARTUP', 
      price: '$0.03987',
      change: '+74.6%',
      isPositive: true
    }
  ]

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
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
                <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </div>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search Dexextra"
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
          {/* Recent Searches */}
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
              {recentSearches.map((search) => (
                <div
                  key={search.id}
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
                        backgroundColor: '#00d4aa',
                        color: '#000000'
                      }}
                    >
                      S
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
                        {search.name}
                      </div>
                      <div 
                        style={{
                          color: design.colors.text.secondary,
                          fontSize: '11px',
                          fontFamily: design.typography.fontFamily.mono
                        }}
                      >
                        {search.symbol}
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
                      {search.price}
                    </div>
                    <div 
                      style={{
                        color: search.isPositive ? design.colors.status.positive : design.colors.status.negative,
                        fontSize: '11px',
                        fontWeight: '500'
                      }}
                    >
                      {search.change}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Trending Collections */}
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
              Trending Collections
            </h3>
            
            <div className="space-y-1">
              {trendingCollections.map((collection) => (
                <div
                  key={collection.id}
                  className="flex items-center justify-between cursor-pointer transition-all duration-150"
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
                      className="flex items-center justify-center text-sm"
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        backgroundColor: '#1a1a1a'
                      }}
                    >
                      {collection.avatar}
                    </div>
                    <div>
                      <div className="flex items-center gap-1">
                        <span 
                          style={{
                            color: design.colors.text.primary,
                            fontSize: '13px',
                            fontWeight: '500',
                            fontFamily: design.typography.fontFamily.primary
                          }}
                        >
                          {collection.name}
                        </span>
                        {collection.verified && (
                          <div
                            style={{
                              width: '12px',
                              height: '12px',
                              borderRadius: '50%',
                              backgroundColor: '#00d4aa',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center'
                            }}
                          >
                            <svg width="8" height="8" viewBox="0 0 24 24" fill="white">
                              <path d="M9 12l2 2 4-4" stroke="white" strokeWidth="3" fill="none"/>
                            </svg>
                          </div>
                        )}
                      </div>
                      <div 
                        style={{
                          color: design.colors.text.secondary,
                          fontSize: '11px',
                          fontFamily: design.typography.fontFamily.primary
                        }}
                      >
                        {collection.items}
                      </div>
                    </div>
                  </div>
                  <div 
                    style={{
                      color: design.colors.text.primary,
                      fontSize: '13px',
                      fontWeight: '500',
                      fontFamily: design.typography.fontFamily.primary
                    }}
                  >
                    {collection.price}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Top Tokens */}
          <div style={{ marginBottom: '0px' }}>
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
              Top Tokens
            </h3>
            
            <div className="space-y-1">
              {topTokens.map((token) => (
                <div
                  key={token.id}
                  className="flex items-center justify-between cursor-pointer transition-all duration-150"
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
                      className="flex items-center justify-center text-xs font-bold"
                      style={{
                        width: '24px',
                        height: '24px',
                        borderRadius: '6px',
                        backgroundColor: '#00d4aa',
                        color: '#000000'
                      }}
                    >
                      S
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
                        {token.name}
                      </div>
                      <div 
                        style={{
                          color: design.colors.text.secondary,
                          fontSize: '11px',
                          fontFamily: design.typography.fontFamily.mono
                        }}
                      >
                        {token.symbol}
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
                      {token.price}
                    </div>
                    <div 
                      style={{
                        color: token.isPositive ? design.colors.status.positive : design.colors.status.negative,
                        fontSize: '11px',
                        fontWeight: '500'
                      }}
                    >
                      {token.change}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>


    </div>
  )
} 