import { NextResponse } from 'next/server'

interface CoinGeckoETHData {
  ethereum: {
    usd: number;
    usd_24h_change: number;
  };
}

export async function GET() {
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd&include_24hr_change=true',
      {
        headers: {
          'Accept': 'application/json',
        },
        // Add cache control
        next: { revalidate: 60 } // Cache for 1 minute
      }
    )

    if (!response.ok) {
      throw new Error(`CoinGecko API error: ${response.status}`)
    }

    const data: CoinGeckoETHData = await response.json()
    
    // Return formatted data
    return NextResponse.json({
      price: data.ethereum?.usd || 0,
      changePercent24h: data.ethereum?.usd_24h_change || 0,
    })
  } catch (error) {
    console.error('Error fetching ETH price:', error)
    return NextResponse.json(
      { error: 'Failed to fetch ETH price' },
      { status: 500 }
    )
  }
} 