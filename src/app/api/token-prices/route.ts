import { NextRequest, NextResponse } from 'next/server'

interface TokenPriceData {
  symbol: string
  price: number
  price_change_percentage_24h: number
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
    
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${idsParam}&vs_currencies=usd&include_24hr_change=true`,
      {
        headers: {
          'Accept': 'application/json',
        },
        // Add cache control
        next: { revalidate: 60 } // Cache for 1 minute
      }
    )
    
    if (!response.ok) {
      if (response.status === 429) {
        console.warn('CoinGecko rate limit hit')
        return NextResponse.json({})
      }
      throw new Error(`CoinGecko API error: ${response.status}`)
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
    console.error('Error fetching token prices:', error)
    return NextResponse.json(
      { error: 'Failed to fetch token prices' },
      { status: 500 }
    )
  }
} 