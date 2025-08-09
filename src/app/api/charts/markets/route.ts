// src/app/api/charts/markets/route.ts
// Optimized markets API with dynamic aggregation

import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');

    // Get the ClickHouse pipeline
    const clickhouse = getClickHouseDataPipeline();

    // Get all available symbols
    const symbols = await clickhouse.getAvailableSymbols();

    if (symbols.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
        meta: {
          count: 0,
          message: 'No market data available yet'
        }
      });
    }

    // Get market statistics for each symbol (limited by the limit parameter)
    const symbolsToProcess = symbols.slice(0, limit);
    const markets = [];

    for (const symbol of symbolsToProcess) {
      try {
        const stats = await clickhouse.getMarketStats(symbol, 24);
        
        if (stats) {
          markets.push({
            symbol,
            totalTrades: stats.totalTrades,
            totalVolume: stats.totalVolume,
            avgPrice: Number(stats.avgPrice.toFixed(2)),
            high24h: Number(stats.high24h.toFixed(2)),
            low24h: Number(stats.low24h.toFixed(2)),
            priceChange24h: Number(stats.priceChange24h.toFixed(2)),
            priceChangePercent24h: Number(stats.priceChangePercent24h.toFixed(2)),
            lastUpdated: new Date().toISOString()
          });
        }
      } catch (error) {
        console.warn(`⚠️ Failed to get stats for ${symbol}:`, error);
        // Continue with other symbols
      }
    }

    // Sort by volume (highest first)
    markets.sort((a, b) => b.totalVolume - a.totalVolume);

    return NextResponse.json({
      success: true,
      data: markets,
      meta: {
        count: markets.length,
        totalSymbols: symbols.length,
        architecture: 'dynamic_aggregation',
        queryTime: Date.now()
      }
    });

  } catch (error) {
    console.error('❌ Markets API error:', error);
    return NextResponse.json(
      {
        error: 'Failed to fetch market data',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 