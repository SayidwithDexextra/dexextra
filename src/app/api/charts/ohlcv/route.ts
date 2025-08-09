// src/app/api/charts/ohlcv/route.ts
// Optimized OHLCV API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const symbol = searchParams.get('symbol');
    const timeframe = searchParams.get('timeframe') || '1h';
    const limit = parseInt(searchParams.get('limit') || '200');
    const startTimeParam = searchParams.get('startTime');
    const endTimeParam = searchParams.get('endTime');

    if (!symbol) {
      return NextResponse.json(
        { error: 'Symbol parameter is required' },
        { status: 400 }
      );
    }

    // Parse optional time range
    let startTime: Date | undefined;
    let endTime: Date | undefined;

    if (startTimeParam) {
      startTime = new Date(startTimeParam);
      if (isNaN(startTime.getTime())) {
        return NextResponse.json(
          { error: 'Invalid startTime format' },
          { status: 400 }
        );
      }
    }

    if (endTimeParam) {
      endTime = new Date(endTimeParam);
      if (isNaN(endTime.getTime())) {
        return NextResponse.json(
          { error: 'Invalid endTime format' },
          { status: 400 }
        );
      }
    }

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    // Fetch OHLCV data using dynamic aggregation
    const candles = await clickhouse.getOHLCVCandles(
      symbol,
      timeframe,
      limit,
      startTime,
      endTime
    );

    return NextResponse.json({
      success: true,
      data: candles,
      meta: {
        symbol,
        timeframe,
        count: candles.length,
        architecture: 'dynamic_aggregation',
        source: timeframe === '1m' ? 'direct' : 'aggregated'
      }
    });

  } catch (error) {
    console.error('❌ OHLCV API error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to fetch OHLCV data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 