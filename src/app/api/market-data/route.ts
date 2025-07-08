import { NextResponse } from 'next/server'

interface CoinGeckoGlobalData {
  data: {
    total_market_cap: {
      usd: number;
    };
    total_volume: {
      usd: number;
    };
    market_cap_change_percentage_24h_usd: number;
  };
}

export async function GET() {
  try {
    const response = await fetch('https://api.coingecko.com/api/v3/global', {
      headers: {
        'Accept': 'application/json',
      },
      // Add cache control
      next: { revalidate: 300 } // Cache for 5 minutes
    })

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`)
    }

    const data: CoinGeckoGlobalData = await response.json()
    
    // Return formatted data
    return NextResponse.json({
      marketCap: data.data.total_market_cap.usd,
      marketCapChange: data.data.market_cap_change_percentage_24h_usd,
      tradingVolume: data.data.total_volume.usd,
    })
  } catch (error) {
    console.error('Error fetching market data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch market data' },
      { status: 500 }
    )
  }
} 