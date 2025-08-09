import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const config = {
    // Datafeed configuration
    supports_search: true,
    supports_group_request: false,
    supports_marks: false,
    supports_timescale_marks: false,
    supports_time: true,
    exchanges: [
      {
        value: 'VAMM',
        name: 'vAMM Markets',
        desc: 'Decentralized vAMM Trading'
      }
    ],
    symbols_types: [
      {
        name: 'futures',
        value: 'futures'
      },
      {
        name: 'crypto',
        value: 'crypto'
      },
      {
        name: 'stock',
        value: 'stock'
      },
      {
        name: 'index',
        value: 'index'
      },
      {
        name: 'commodity',
        value: 'commodity'
      }
    ],
    supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
    
    // Chart configuration
    supports_resolution_switching: true,
    supports_marks_display: false,
    supports_timescale_marks: false,
    
    // Data configuration
    intraday_multipliers: ['1', '5', '15', '30', '60', '240'],
    has_daily: true,
    has_weekly_and_monthly: true,
    has_intraday: true,
    
    // Technical indicators
    has_no_volume: false,
    volume_precision: 2,
    
    // Additional features
    supports_time_frames: true,
    currency_codes: ['USD', 'USDC', 'ETH', 'BTC'],
    
    // Custom features for vAMM
    custom: {
      platform: 'DexExtra Custom vAMM',
      version: '1.0.0',
      description: 'Real-time custom market data from user-created vAMM contracts',
      data_source: 'custom_vamm_markets'
    }
  }

  // Set appropriate headers for TradingView
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  }

  return NextResponse.json(config, { headers })
}

// Handle CORS preflight
export async function OPTIONS(request: NextRequest) {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    }
  })
} 