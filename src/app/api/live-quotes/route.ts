import { NextRequest, NextResponse } from 'next/server'

const CMC_API_KEY = process.env.CMC_API_KEY
const CMC_BASE_URL = 'https://pro-api.coinmarketcap.com/v1'

// Cache for reducing API calls
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_DURATION = 60000 // 1 minute

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const symbol = searchParams.get('symbol')
    const convert = searchParams.get('convert') || 'USD'

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      )
    }

    // Check cache first
    const cacheKey = `${symbol}-${convert}`
    const cached = cache.get(cacheKey)
    
    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        data: cached.data,
        cached: true,
        timestamp: cached.timestamp
      })
    }

    // Fetch from CoinMarketCap API
    const response = await fetch(
      `${CMC_BASE_URL}/cryptocurrency/quotes/latest?symbol=${symbol}&convert=${convert}`,
      {
        headers: {
          'X-CMC_PRO_API_KEY': CMC_API_KEY,
          'Accept': 'application/json',
        },
      }
    )

    if (!response.ok) {
      console.error(`CoinMarketCap API error: ${response.status} ${response.statusText}`)
      return NextResponse.json(
        { error: `CoinMarketCap API error: ${response.status}` },
        { status: response.status }
      )
    }

    const data = await response.json()

    if (!data.data || !data.data[symbol]) {
      return NextResponse.json(
        { error: `No data found for symbol: ${symbol}` },
        { status: 404 }
      )
    }

    const tokenData = data.data[symbol]
    const quote = tokenData.quote[convert]

    const result = {
      symbol,
      price: quote.price,
      priceChange24h: quote.price * (quote.percent_change_24h / 100),
      priceChangePercent24h: quote.percent_change_24h,
      marketCap: quote.market_cap,
      volume24h: quote.volume_24h,
      timestamp: Date.now(),
      lastUpdated: quote.last_updated
    }

    // Cache the result
    cache.set(cacheKey, {
      data: result,
      timestamp: Date.now()
    })

    return NextResponse.json({
      data: result,
      cached: false,
      timestamp: Date.now()
    })

  } catch (error) {
    console.error('Live quotes API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch live quotes' },
      { status: 500 }
    )
  }
}

// Optional: Add price conversion endpoint
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { fromSymbol, toSymbol, amount } = body

    if (!fromSymbol || !toSymbol || !amount) {
      return NextResponse.json(
        { error: 'fromSymbol, toSymbol, and amount are required' },
        { status: 400 }
      )
    }

    // Fetch both quotes
    const [fromResponse, toResponse] = await Promise.all([
      fetch(`${request.nextUrl.origin}/api/live-quotes?symbol=${fromSymbol}`),
      fetch(`${request.nextUrl.origin}/api/live-quotes?symbol=${toSymbol}`)
    ])

    if (!fromResponse.ok || !toResponse.ok) {
      return NextResponse.json(
        { error: 'Failed to fetch quote data' },
        { status: 500 }
      )
    }

    const fromData = await fromResponse.json()
    const toData = await toResponse.json()

    const exchangeRate = fromData.data.price / toData.data.price
    const convertedAmount = amount * exchangeRate

    return NextResponse.json({
      fromSymbol,
      toSymbol,
      amount,
      convertedAmount,
      exchangeRate,
      fromQuote: fromData.data,
      toQuote: toData.data,
      timestamp: Date.now()
    })

  } catch (error) {
    console.error('Price conversion API error:', error)
    return NextResponse.json(
      { error: 'Failed to convert price' },
      { status: 500 }
    )
  }
} 