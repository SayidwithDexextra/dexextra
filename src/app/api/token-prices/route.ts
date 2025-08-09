import { NextRequest, NextResponse } from 'next/server'

interface TokenPriceData {
  symbol: string
  price: number
  price_change_percentage_24h: number
}

// Enhanced retry mechanism for external API calls
async function retryFetch(
  url: string, 
  options: RequestInit = {}, 
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<Response> {
  let lastError: Error

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 10000) // 10s timeout
      
      const response = await fetch(url, {
        ...options,
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      
      if (response.ok) {
        return response
      }
      
      // Don't retry on client errors (4xx), only on server errors (5xx) or timeouts
      if (response.status >= 400 && response.status < 500) {
        throw new Error(`Client error: ${response.status}`)
      }
      
      throw new Error(`Server error: ${response.status}`)
      
    } catch (error) {
      lastError = error as Error
      console.warn(`CoinGecko attempt ${attempt + 1} failed:`, error)
      
      if (attempt < maxRetries - 1) {
        const delay = Math.min(baseDelay * Math.pow(2, attempt), 5000)
         console.log(`Retrying CoinGecko in ${delay}ms...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
  }
  
  throw lastError!
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const tokensParam = searchParams.get('tokens')
    
    if (!tokensParam) {
      return NextResponse.json(
        { error: 'Missing tokens parameter' },
        { status: 400 }
      )
    }

    const tokens = tokensParam.split(',')
    
    // Enhanced symbol to CoinGecko ID mapping
    const symbolToId: Record<string, string> = {
      'ETH': 'ethereum',
      'WETH': 'wrapped-ethereum',
      'USDC': 'usd-coin',
      'USDT': 'tether',
      'DAI': 'dai',
      'LINK': 'chainlink',
      'UNI': 'uniswap',
      'AAVE': 'aave',
      'COMP': 'compound',
      'MKR': 'maker',
      'SNX': 'havven',
      'CRV': 'curve-dao-token',
      'SUSHI': 'sushi',
      'MATIC': 'polygon-pos',
      'POL': 'polygon-pos',
      'BTC': 'bitcoin',
      'LTC': 'litecoin',
      'BCH': 'bitcoin-cash',
      'XRP': 'ripple',
      'ADA': 'cardano',
      'DOT': 'polkadot',
      'SOL': 'solana',
      'AVAX': 'avalanche-2',
      'NEAR': 'near',
      'ATOM': 'cosmos',
      'FTM': 'fantom',
      'ALGO': 'algorand',
      'XLM': 'stellar',
      'VET': 'vechain',
      'ICP': 'internet-computer',
      'FLOW': 'flow',
      'SAND': 'the-sandbox',
      'MANA': 'decentraland',
      'ENJ': 'enjincoin',
      'CHZ': 'chiliz',
      'THETA': 'theta-token',
      'FIL': 'filecoin',
      'GRT': 'the-graph',
      'LRC': 'loopring',
      'BAT': 'basic-attention-token',
      'ZRX': '0x',
      'YFI': 'yearn-finance',
      'SHIB': 'shiba-inu',
      'DOGE': 'dogecoin',
      'APE': 'apecoin',
      '1INCH': '1inch',
      'BNB': 'binancecoin',
      'TRX': 'tron',
    }
    
    // Get CoinGecko IDs for the requested symbols
    const coinGeckoIds: string[] = []
    const symbolMap: Record<string, string> = {}
    
    tokens.forEach(symbol => {
      const id = symbolToId[symbol.toUpperCase()]
      if (id) {
        coinGeckoIds.push(id)
        symbolMap[id] = symbol
      }
    })
    
    if (coinGeckoIds.length === 0) {
      return NextResponse.json({})
    }
    
    // Limit to 50 tokens per request to avoid URL length issues  
    const limitedIds = coinGeckoIds.slice(0, 50)
    const idsParam = limitedIds.join(',')
        
    // Use enhanced retry mechanism
    const response = await retryFetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'DexExtra/1.0'
        },
        // Add cache control
        next: { revalidate: 60 } // Cache for 1 minute
      },
      3,
      1000
    )
    
    if (response.status === 429) {
      console.warn('CoinGecko rate limit hit')
      return NextResponse.json({})
    }
    
    const data = await response.json()
    
    const priceData: Record<string, TokenPriceData> = {}
    
    // Map back to symbols using our symbolMap
    Object.entries(data).forEach(([coinGeckoId, priceInfo]: [string, any]) => {
      const symbol = symbolMap[coinGeckoId]
      if (symbol && priceInfo && typeof priceInfo.usd === 'number') {
        priceData[symbol] = {
          symbol,
          price: priceInfo.usd || 0,
          price_change_percentage_24h: priceInfo.usd_24h_change || 0,
        }
      }
    })
    
    return NextResponse.json(priceData)
    
  } catch (error) {
    console.error('Error fetching token prices after all retries:', error)
    
    // Return empty object instead of error to let client handle fallback
    // This prevents cascading failures
    return NextResponse.json({})
  }
} 