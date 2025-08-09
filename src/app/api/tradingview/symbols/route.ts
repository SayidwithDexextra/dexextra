import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    console.log(`🔍 TradingView symbols lookup: "${symbol}"`);

    // Query the vamm_markets table for this symbol
    const { data: market, error } = await supabase
      .from('vamm_markets')
      .select('*')
      .eq('symbol', symbol)
      .eq('is_active', true)
      .eq('deployment_status', 'deployed')
      .not('vamm_address', 'is', null)
      .single();

    if (error || !market) {
      console.log(`❌ Market not found for symbol: ${symbol}`);
      return NextResponse.json(
        { error: `Symbol "${symbol}" not found` },
        { status: 404 }
      );
    }

    // Determine market type from category
    let marketType = 'futures'; // Default for vAMM markets
    if (Array.isArray(market.category)) {
      if (market.category.includes('crypto')) marketType = 'crypto';
      else if (market.category.includes('stock')) marketType = 'stock';
      else if (market.category.includes('index')) marketType = 'index';
      else if (market.category.includes('commodity')) marketType = 'commodity';
    }

    // Calculate price scale based on decimals
    const priceDecimals = market.price_decimals || 8;
    const pricescale = Math.pow(10, priceDecimals);

    // Build symbol info response
    const symbolInfo = {
      ticker: market.symbol,
      name: market.symbol,
      description: market.description || `${market.symbol} vAMM Market`,
      type: marketType,
      session: '24x7', // vAMM markets are always open
      timezone: 'Etc/UTC',
      exchange: 'VAMM',
      minmov: 1,
      pricescale: pricescale,
      has_intraday: true,
      has_no_volume: false, // vAMM markets have volume data
      has_weekly_and_monthly: true,
      supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
      volume_precision: 8,
      data_status: 'streaming',
      
      // Custom vAMM market data
      custom: {
        vamm_address: market.vamm_address,
        vault_address: market.vault_address,
        oracle_address: market.oracle_address,
        initial_price: market.initial_price,
        deployment_status: market.deployment_status,
        created_at: market.created_at,
        category: market.category,
        market_id: market.id
      }
    };

    console.log(`✅ Symbol resolved: ${market.symbol} (vAMM: ${market.vamm_address})`);

    return NextResponse.json(symbolInfo, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ TradingView symbols error:', error);
    return NextResponse.json(
      { 
        error: 'Symbol lookup failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
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
  });
} 