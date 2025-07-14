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
          'User-Agent': 'Mozilla/5.0 (compatible; DexExtra/1.0)',
        },
        // Add timeout
        signal: AbortSignal.timeout(10000), // 10 second timeout
        // Add cache control
        next: { revalidate: 60 } // Cache for 1 minute
      }
    )

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      throw new Error(`CoinGecko API error: ${response.status} ${response.statusText} - ${errorText}`)
    }

    const data: CoinGeckoETHData = await response.json()
    
    // Validate the response data
    if (!data.ethereum || typeof data.ethereum.usd !== 'number') {
      throw new Error('Invalid response from CoinGecko API')
    }
    
    // Return formatted data
    return NextResponse.json({
      price: data.ethereum.usd,
      changePercent24h: data.ethereum.usd_24h_change || 0,
    })
  } catch (error) {
    console.error('Error fetching ETH price:', {
      error: error instanceof Error ? error.message : error,
      timestamp: new Date().toISOString(),
    })
    
    // Return a more specific error message
    const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
    return NextResponse.json(
      { error: `Failed to fetch ETH price: ${errorMessage}` },
      { status: 500 }
    )
  }
} 