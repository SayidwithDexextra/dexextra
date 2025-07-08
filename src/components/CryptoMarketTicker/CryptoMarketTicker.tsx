'use client'

import React, { useState, useEffect, useRef } from 'react'
import { fetchTokenPrices, createTokenPriceUpdater } from '@/lib/tokenService'
import styles from './CryptoMarketTicker.module.css'

interface TokenPriceData {
  symbol: string
  price: number
  price_change_percentage_24h: number
}

interface CryptoMarketTickerProps {
  className?: string
  speed?: number
  pauseOnHover?: boolean
}

const DEFAULT_TOKENS = [
  'BTC', 'ETH', 'XRP', 'BNB', 'SOL', 'USDC', 'ADA', 'AVAX', 'DOGE', 'TRX',
  'LINK', 'DOT', 'MATIC', 'UNI', 'LTC', 'BCH', 'NEAR', 'ATOM', 'FTM', 'ALGO',
  'VET', 'ICP', 'FLOW', 'SAND', 'MANA', 'ENJ', 'CHZ', 'THETA', 'FIL', 'GRT'
]

export default function CryptoMarketTicker({ 
  className = '', 
  speed = 60,
  pauseOnHover = true 
}: CryptoMarketTickerProps) {
  const [tokenPrices, setTokenPrices] = useState<Record<string, TokenPriceData>>({})
  const [isLoading, setIsLoading] = useState(true)
  const [isPaused, setIsPaused] = useState(false)
  const tickerRef = useRef<HTMLDivElement>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  // Format price with appropriate decimals
  const formatPrice = (price: number): string => {
    if (price >= 1000) {
      return price.toLocaleString('en-US', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      })
    } else if (price >= 1) {
      return price.toFixed(4)
    } else if (price >= 0.0001) {
      return price.toFixed(6)
    } else {
      return price.toExponential(2)
    }
  }

  // Format percentage change
  const formatPercentage = (change: number): string => {
    const formatted = Math.abs(change).toFixed(2)
    return change >= 0 ? `+${formatted}%` : `-${formatted}%`
  }

  // Get color class for percentage change
  const getChangeColorClass = (change: number): string => {
    return change >= 0 ? styles.positive : styles.negative
  }

  // Fetch initial data and set up periodic updates
  useEffect(() => {
    const loadTokenPrices = async () => {
      try {
        setIsLoading(true)
        const prices = await fetchTokenPrices(DEFAULT_TOKENS)
        setTokenPrices(prices)
      } catch (error) {
        console.error('Error loading token prices:', error)
      } finally {
        setIsLoading(false)
      }
    }

    // Load initial data
    loadTokenPrices()

    // Set up periodic updates
    const cleanup = createTokenPriceUpdater((updatedPrices) => {
      setTokenPrices(prev => ({ ...prev, ...updatedPrices }))
    })

    cleanupRef.current = cleanup

    return () => {
      if (cleanupRef.current) {
        cleanupRef.current()
      }
    }
  }, [])

  // Handle hover events for pause on hover
  const handleMouseEnter = () => {
    if (pauseOnHover) {
      setIsPaused(true)
    }
  }

  const handleMouseLeave = () => {
    if (pauseOnHover) {
      setIsPaused(false)
    }
  }

  // Convert tokenPrices object to array and filter valid entries
  const validTokens = Object.values(tokenPrices).filter(token => 
    token && token.symbol && typeof token.price === 'number' && token.price > 0
  )

  if (isLoading) {
    return (
      <div className={`${styles.container} ${className}`}>
        <div className={styles.loading}>
          Loading market data...
        </div>
      </div>
    )
  }

  if (validTokens.length === 0) {
    return (
      <div className={`${styles.container} ${className}`}>
        <div className={styles.error}>
          Unable to load market data
        </div>
      </div>
    )
  }

  // Calculate animation duration - much slower for better readability
  const animationDuration = Math.max(60, validTokens.length * 4) // Minimum 60s, 4s per token

  return (
    <div 
      className={`${styles.container} ${className}`}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      role="marquee"
      aria-label="Cryptocurrency market ticker"
    >
      <div 
        ref={tickerRef}
        className={`${styles.ticker} ${isPaused ? styles.paused : ''}`}
        style={{ 
          '--ticker-duration': `${animationDuration}s`
        } as React.CSSProperties}
      >
        {/* First set of tokens */}
        {validTokens.map((token, index) => (
          <div key={`${token.symbol}-1-${index}`} className={styles.tickerItem}>
            <span className={styles.symbol}>{token.symbol}</span>
            <span className={styles.separator}>•</span>
            <span className={styles.price}>${formatPrice(token.price)}</span>
            <span className={`${styles.change} ${getChangeColorClass(token.price_change_percentage_24h)}`}>
              {formatPercentage(token.price_change_percentage_24h)}
            </span>
          </div>
        ))}
        
        {/* Duplicate set for seamless looping */}
        {validTokens.map((token, index) => (
          <div key={`${token.symbol}-2-${index}`} className={styles.tickerItem}>
            <span className={styles.symbol}>{token.symbol}</span>
            <span className={styles.separator}>•</span>
            <span className={styles.price}>${formatPrice(token.price)}</span>
            <span className={`${styles.change} ${getChangeColorClass(token.price_change_percentage_24h)}`}>
              {formatPercentage(token.price_change_percentage_24h)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
} 