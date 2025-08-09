import { NextResponse } from 'next/server'
import { ethPriceService } from '@/lib/ethPriceService'

export async function GET() {
  try {
    // Try to get price from our bulletproof service
    const result = await ethPriceService.getETHPrice();
    
    return NextResponse.json({
      price: result.price,
      changePercent24h: result.changePercent24h,
      source: result.source,
      timestamp: result.timestamp,
      success: true
    });
    
  } catch (error) {
    console.error('All ETH price sources failed:', {
      error: error instanceof Error ? error.message : error,
      timestamp: new Date().toISOString(),
      endpointStatus: ethPriceService.getEndpointStatus()
    });
    
    // Return fallback data instead of error
    const fallbackData = ethPriceService.getFallbackData();
    
    return NextResponse.json({
      price: fallbackData.price,
      changePercent24h: fallbackData.changePercent24h,
      source: fallbackData.source,
      timestamp: fallbackData.timestamp,
      success: false,
      warning: 'Using fallback data due to API failures'
    }, { 
      status: 200 // Return 200 so the frontend doesn't treat it as an error
    });
  }
} 