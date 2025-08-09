// src/app/api/tradingview/history/route.ts
// Optimized TradingView UDF API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';

// TradingView resolution to our timeframe mapping
const RESOLUTION_MAP: Record<string, string> = {
  '1': '1m',
  '5': '5m',
  '15': '15m',
  '30': '30m',
  '60': '1h',
  '240': '4h',
  '1D': '1d',
  'D': '1d'
};

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    const symbol = searchParams.get('symbol');
    const resolution = searchParams.get('resolution');
    const from = searchParams.get('from');
    const to = searchParams.get('to');

    // Validate required parameters
    if (!symbol || !resolution || !from || !to) {
      return NextResponse.json(
        { s: 'error', errmsg: 'Missing required parameters' },
        { status: 400 }
      );
    }

    // Map TradingView resolution to our timeframe
    const timeframe = RESOLUTION_MAP[resolution];
    if (!timeframe) {
      return NextResponse.json(
        { s: 'error', errmsg: `Unsupported resolution: ${resolution}` },
        { status: 400 }
      );
    }

    // Parse timestamps
    const startTime = new Date(parseInt(from) * 1000);
    const endTime = new Date(parseInt(to) * 1000);

    if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) {
      return NextResponse.json(
        { s: 'error', errmsg: 'Invalid timestamp format' },
        { status: 400 }
      );
    }

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    // Fetch candles using dynamic aggregation
    const candles = await clickhouse.getOHLCVCandles(
      symbol,
      timeframe,
      2000, // TradingView limit
      startTime,
      endTime
    );

    // Handle no data case
    if (candles.length === 0) {
      return NextResponse.json({
        s: 'no_data',
        nextTime: Math.floor(endTime.getTime() / 1000)
      });
    }

    // Convert to TradingView format
    const t: number[] = []; // time
    const o: number[] = []; // open
    const h: number[] = []; // high
    const l: number[] = []; // low
    const c: number[] = []; // close
    const v: number[] = []; // volume

    candles.forEach(candle => {
      t.push(candle.time);
      o.push(candle.open);
      h.push(candle.high);
      l.push(candle.low);
      c.push(candle.close);
      v.push(candle.volume);
    });

    return NextResponse.json({
      s: 'ok',
      t,
      o,
      h,
      l,
      c,
      v,
      meta: {
        count: candles.length,
        symbol,
        resolution,
        timeframe,
        architecture: 'dynamic_aggregation'
      }
    });

  } catch (error) {
    console.error('❌ TradingView history API error:', error);
    return NextResponse.json(
      { 
        s: 'error',
        errmsg: error instanceof Error ? error.message : 'Unknown error'
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
  })
} 