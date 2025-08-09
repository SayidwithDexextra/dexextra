export interface LiveQuote {
  symbol: string
  price: number
  priceChange24h: number
  priceChangePercent24h: number
  marketCap: number
  volume24h: number
  timestamp: number
  lastUpdated: string
}

export interface QuoteDetails {
  fromToken: string
  toToken: string
  fromAmount: number
  toAmount: number
  exchangeRate: string
  networkCosts: {
    gasFee: number
    gasFeeUsd: number
    estimatedTime: string
  }
  priceImpact: number
  maxSlippage: number
  minimumReceived: number
  quote: LiveQuote
}

export interface QuoteRefreshState {
  isRefreshing: boolean
  nextRefreshIn: number
  lastRefreshTime: number
}

class LiveQuotesService {
  private readonly BASE_URL = '/api/live-quotes' // Use local API endpoint
  private readonly REFRESH_INTERVAL = 60000 // 1 minute in milliseconds
  
  private cache = new Map<string, { data: LiveQuote; timestamp: number }>()
  private refreshTimers = new Map<string, NodeJS.Timeout>()

  /**
   * Fetch latest quote for a cryptocurrency
   */
  async getLatestQuote(symbol: string, convert: string = 'USD'): Promise<LiveQuote> {
    const cacheKey = `${symbol}-${convert}`
    const cached = this.cache.get(cacheKey)
    
    // Return cached data if it's less than 1 minute old
    if (cached && Date.now() - cached.timestamp < this.REFRESH_INTERVAL) {
      return cached.data
    }

    try {
      const response = await fetch(
        `${this.BASE_URL}?symbol=${symbol}&convert=${convert}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      )

      if (!response.ok) {
        throw new Error(`Live quotes API error: ${response.status} ${response.statusText}`)
      }

      const responseData = await response.json()
      
      if (!responseData.data) {
        throw new Error(`No data found for symbol: ${symbol}`)
      }

      const liveQuote: LiveQuote = responseData.data

      // Cache the result (but respect server-side caching)
      if (!responseData.cached) {
        this.cache.set(cacheKey, {
          data: liveQuote,
          timestamp: Date.now()
        })
      }

      return liveQuote
    } catch (error) {
      console.error('Error fetching live quote:', error)
      throw error
    }
  }

  /**
   * Get detailed quote information for a swap/deposit
   */
  async getDetailedQuote(
    fromSymbol: string,
    toSymbol: string,
    amount: number
  ): Promise<QuoteDetails> {
    try {
      // Try using the conversion API first for efficiency
      try {
        const response = await fetch('/api/live-quotes', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            fromSymbol,
            toSymbol,
            amount
          })
        })

        if (response.ok) {
          const conversionData = await response.json()
          
          // Calculate additional details
          const networkCosts = this.calculateNetworkCosts(fromSymbol)
          const priceImpact = this.calculatePriceImpact(amount, conversionData.fromQuote)
          const maxSlippage = this.calculateMaxSlippage(fromSymbol, toSymbol)
          const minimumReceived = conversionData.convertedAmount * (1 - maxSlippage / 100)

          return {
            fromToken: fromSymbol,
            toToken: toSymbol,
            fromAmount: amount,
            toAmount: conversionData.convertedAmount,
            exchangeRate: `1 ${fromSymbol} = ${conversionData.exchangeRate.toFixed(2)} ${toSymbol}`,
            networkCosts,
            priceImpact,
            maxSlippage,
            minimumReceived,
            quote: conversionData.fromQuote
          }
        }
      } catch (conversionError) {
        console.log('Conversion API not available, falling back to individual quotes')
      }

      // Fallback to individual quote fetching
      const [fromQuote, toQuote] = await Promise.all([
        this.getLatestQuote(fromSymbol),
        this.getLatestQuote(toSymbol)
      ])

      // Calculate exchange rate
      const exchangeRate = fromQuote.price / toQuote.price
      const toAmount = amount * exchangeRate

      // Calculate network costs (estimated)
      const networkCosts = this.calculateNetworkCosts(fromSymbol)
      
      // Calculate price impact (estimated based on volume)
      const priceImpact = this.calculatePriceImpact(amount, fromQuote)
      
      // Max slippage (typically 0.5% for stable pairs, 1% for volatile)
      const maxSlippage = this.calculateMaxSlippage(fromSymbol, toSymbol)
      
      // Minimum received after slippage
      const minimumReceived = toAmount * (1 - maxSlippage / 100)

      return {
        fromToken: fromSymbol,
        toToken: toSymbol,
        fromAmount: amount,
        toAmount,
        exchangeRate: `1 ${fromSymbol} = ${exchangeRate.toFixed(2)} ${toSymbol}`,
        networkCosts,
        priceImpact,
        maxSlippage,
        minimumReceived,
        quote: fromQuote
      }
    } catch (error) {
      console.error('Error getting detailed quote:', error)
      throw error
    }
  }

  /**
   * Calculate estimated network costs
   */
  private calculateNetworkCosts(symbol: string) {
    // These would typically come from blockchain gas estimators
    // Using estimated values for demonstration
    const gasEstimates: Record<string, { gasFee: number; estimatedTime: string }> = {
      'ETH': { gasFee: 0.003, estimatedTime: '< 2 min' },
      'BTC': { gasFee: 0.0001, estimatedTime: '~ 10 min' },
      'USDC': { gasFee: 0.002, estimatedTime: '< 1 min' },
      'USDT': { gasFee: 0.002, estimatedTime: '< 1 min' },
      'BNB': { gasFee: 0.0005, estimatedTime: '< 30 sec' }
    }

    const estimate = gasEstimates[symbol] || { gasFee: 0.002, estimatedTime: '< 2 min' }
    
    return {
      gasFee: estimate.gasFee,
      gasFeeUsd: estimate.gasFee * (symbol === 'ETH' ? 3500 : 1), // Rough USD conversion
      estimatedTime: estimate.estimatedTime
    }
  }

  /**
   * Calculate price impact based on trade size
   */
  private calculatePriceImpact(amount: number, quote: LiveQuote): number {
    // Simple heuristic: larger trades have higher impact
    const tradeValue = amount * quote.price
    
    if (tradeValue < 1000) return 0.01 // 0.01% for small trades
    if (tradeValue < 10000) return 0.05 // 0.05% for medium trades
    if (tradeValue < 100000) return 0.1 // 0.1% for large trades
    return 0.25 // 0.25% for very large trades
  }

  /**
   * Calculate maximum slippage based on token pair volatility
   */
  private calculateMaxSlippage(fromSymbol: string, toSymbol: string): number {
    const stableCoins = ['USDC', 'USDT', 'DAI', 'BUSD']
    const majorTokens = ['BTC', 'ETH', 'BNB']
    
    const fromIsStable = stableCoins.includes(fromSymbol)
    const toIsStable = stableCoins.includes(toSymbol)
    const fromIsMajor = majorTokens.includes(fromSymbol)
    const toIsMajor = majorTokens.includes(toSymbol)
    
    // Stable to stable: very low slippage
    if (fromIsStable && toIsStable) return 0.1
    
    // Stable to major or major to stable: low slippage
    if ((fromIsStable && toIsMajor) || (fromIsMajor && toIsStable)) return 0.3
    
    // Major to major: medium slippage
    if (fromIsMajor && toIsMajor) return 0.5
    
    // Everything else: higher slippage
    return 1.0
  }

  /**
   * Start auto-refresh for quotes
   */
  startAutoRefresh(
    symbols: string[],
    onUpdate: (quotes: Map<string, LiveQuote>) => void,
    onRefreshState: (state: QuoteRefreshState) => void
  ): () => void {
    const refreshId = Date.now().toString()
    let countdown = 60
    
    // Initial fetch
    this.refreshQuotes(symbols, onUpdate)
    
    // Countdown timer (updates every second)
    const countdownTimer = setInterval(() => {
      countdown--
      onRefreshState({
        isRefreshing: countdown <= 3,
        nextRefreshIn: countdown,
        lastRefreshTime: Date.now()
      })
      
      if (countdown <= 0) {
        countdown = 60
        this.refreshQuotes(symbols, onUpdate)
      }
    }, 1000)
    
    this.refreshTimers.set(refreshId, countdownTimer)
    
    // Return cleanup function
    return () => {
      const timer = this.refreshTimers.get(refreshId)
      if (timer) {
        clearInterval(timer)
        this.refreshTimers.delete(refreshId)
      }
    }
  }

  /**
   * Refresh quotes for multiple symbols
   */
  private async refreshQuotes(
    symbols: string[],
    onUpdate: (quotes: Map<string, LiveQuote>) => void
  ) {
    try {
      const quotes = new Map<string, LiveQuote>()
      
      // Fetch all quotes in parallel
      const quotePromises = symbols.map(async (symbol) => {
        try {
          const quote = await this.getLatestQuote(symbol)
          quotes.set(symbol, quote)
        } catch (error) {
          console.error(`Failed to fetch quote for ${symbol}:`, error)
        }
      })
      
      await Promise.allSettled(quotePromises)
      onUpdate(quotes)
    } catch (error) {
      console.error('Error refreshing quotes:', error)
    }
  }

  /**
   * Clear all caches and timers
   */
  cleanup() {
    this.cache.clear()
    this.refreshTimers.forEach(timer => clearInterval(timer))
    this.refreshTimers.clear()
  }
}

// Export singleton instance
export const liveQuotesService = new LiveQuotesService() 