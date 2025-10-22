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

    // Query the orderbook_markets table for this metric_id
    const { data: market, error } = await supabase
      .from('orderbook_markets')
      .select('*')
      .eq('metric_id', symbol)
      .eq('is_active', true)
      .eq('deployment_status', 'deployed')
      .not('market_address', 'is', null)
      .single();

    if (error || !market) {
      console.log(`❌ Market not found for symbol: ${symbol}`);
      return NextResponse.json(
        { error: `Symbol "${symbol}" not found` },
        { status: 404 }
      );
    }

    // Determine market type from category string
    const cat = (market.category || '').toString().toLowerCase();
    let marketType = 'futures';
    if (cat.includes('crypto')) marketType = 'crypto';
    else if (cat.includes('stock')) marketType = 'stock';
    else if (cat.includes('index')) marketType = 'index';
    else if (cat.includes('commodity')) marketType = 'commodity';

    // Calculate price scale based on decimals
    const priceDecimals = market.decimals || 8;
    const pricescale = Math.pow(10, priceDecimals);

    // Build symbol info response
    const symbolInfo = {
      ticker: market.metric_id,
      name: market.metric_id,
      description: market.description || `${market.metric_id} Orderbook Market`,
      type: marketType,
      session: '24x7', // vAMM markets are always open
      timezone: 'Etc/UTC',
      exchange: 'ORDERBOOK',
      minmov: 1,
      pricescale: pricescale,
      has_intraday: true,
      has_no_volume: false, // vAMM markets have volume data
      has_weekly_and_monthly: true,
      supported_resolutions: ['1', '5', '15', '30', '60', '240', '1D', '1W', '1M'],
      volume_precision: 8,
      data_status: 'streaming',
      
      // Custom orderbook market data
      custom: {
        market_address: market.market_address,
        vault_address: market.central_vault_address,
        oracle_address: market.uma_oracle_manager_address,
        initial_price: market.last_trade_price,
        deployment_status: market.deployment_status,
        created_at: market.created_at,
        category: market.category,
        market_id: market.id
      }
    };

    console.log(`✅ Symbol resolved: ${market.metric_id} (orderbook: ${market.market_address})`);

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