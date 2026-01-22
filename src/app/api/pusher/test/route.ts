import { NextRequest, NextResponse } from 'next/server';
import { getPusherServer } from '@/lib/pusher-server';
import { supabaseAdmin } from '@/lib/supabase-admin';

type CandleState = {
  bucketStartMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  lastTickMs: number;
};

// NOTE:
// This endpoint is for local/dev testing. We keep a simple in-memory candle builder so
// repeated POSTs act like *ticks* and we build OHLC server-side per timeframe bucket.
// In dev (Next.js node server), module state persists across requests, which is perfect here.
// In serverless environments this may not persist, but this route is not intended for prod usage.
const candleStateByKey = new Map<string, CandleState>();

function looksLikeUuid(value: string): boolean {
  const v = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
}

function timeframeToMs(tf: string): number {
  const t = String(tf || '').trim().toLowerCase();
  if (!t) return 60_000;
  // Allow numeric minute strings like "1", "5", "15" (TradingView resolutions)
  if (/^\d+$/.test(t)) return Math.max(1, parseInt(t, 10)) * 60_000;

  const m = t.match(/^(\d+)(m|h|d)$/);
  if (!m) return 60_000;
  const n = Math.max(1, parseInt(m[1]!, 10));
  const unit = m[2]!;
  if (unit === 'm') return n * 60_000;
  if (unit === 'h') return n * 3_600_000;
  if (unit === 'd') return n * 86_400_000;
  return 60_000;
}

function bucketStartMs(tsMs: number, tfMs: number): number {
  const interval = Math.max(1, tfMs);
  return Math.floor(tsMs / interval) * interval;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      type = 'price',
      symbol = 'TEST',
      price = 100,
      timeframe = '1h',
      marketUuid,
      // Optional override so tests can "fast-forward" time and create multiple bars quickly.
      // Accepts ms epoch; if omitted we use Date.now().
      timestamp,
    } = body as any;
   
     console.log('body', body);

    const pusherServer = getPusherServer();
    let debug: any = undefined;

    // Test different types of broadcasts
    switch (type) {
      case 'price':
        await pusherServer.broadcastPriceUpdate({
          symbol,
          markPrice: price,
          fundingRate: 0,
          timestamp: Date.now(),
          priceChange24h: Math.random() * 10 - 5, // Random change
          volume24h: Math.random() * 1000000,
        });
        break;

      case 'ticker':
        await pusherServer.broadcastTokenTicker([{
          symbol,
          price,
          priceChange24h: Math.random() * 10 - 5,
          timestamp: Date.now(),
        }]);
        break;

      case 'market':
        await pusherServer.broadcastMarketData({
          marketCap: '$3,415,977,522,715',
          marketCapChange: Math.random() * 5 - 2.5,
          tradingVolume: '$86,016,835,572',
          timestamp: Date.now(),
        });
        break;

      case 'trading':
        await pusherServer.broadcastTradingEvent({
          userAddress: '0x1234567890123456789012345678901234567890',
          symbol,
          action: 'open',
          positionSize: '1000',
          markPrice: price,
          timestamp: Date.now(),
          isLong: Math.random() > 0.5,
        });
        break;

      case 'chart':
        // Normalize timeframe inputs:
        // - TradingView uses numeric resolutions like "1", "15", "60"
        // - Our realtime channels use "1m", "15m", "1h"
        const normalizeTf = (tf: string) => {
          const t = String(tf || '').trim();
          if (!t) return '1m';
          if (/^\d+$/.test(t)) {
            const n = parseInt(t, 10);
            if (n === 1) return '1m';
            if (n === 5) return '5m';
            if (n === 15) return '15m';
            if (n === 30) return '30m';
            if (n === 60) return '1h';
            if (n === 240) return '4h';
            return `${n}m`;
          }
          return t;
        };

        // Resolve a canonical market UUID for the channel.
        // - If caller provides a valid UUID, use it.
        // - Otherwise, try resolving by metric_id/symbol from Supabase so callers can just pass "BITCOIN".
        let resolvedMarketUuid: string | undefined = looksLikeUuid(String(marketUuid || ''))
          ? String(marketUuid)
          : undefined;
        const rawSym = String(symbol || '').trim();
        const symPart = rawSym.includes(':') ? rawSym.split(':').pop()! : rawSym;
        if (!resolvedMarketUuid && looksLikeUuid(symPart)) {
          resolvedMarketUuid = symPart;
        }
        if (!resolvedMarketUuid) {
          try {
            const sym = String(symPart || '').trim();
            if (sym) {
              const { data: m } = await supabaseAdmin
                .from('orderbook_markets_view')
                .select('id')
                .or(`eq.metric_id.${sym},eq.symbol.${sym},ilike.metric_id.${sym},ilike.symbol.${sym}`)
                .limit(1)
                .maybeSingle();
              if ((m as any)?.id) resolvedMarketUuid = String((m as any).id);
            }
          } catch {
            // ignore
          }
        }

        // Resolve a human-facing symbol for storage/payload (so ClickHouse doesn't store UUID in `symbol`).
        // - If caller provided a non-UUID (e.g. "BITCOIN"), use it.
        // - If caller provided a UUID (or only marketUuid), look up metric_id/symbol from Supabase.
        let humanSymbol = symPart;
        if (!humanSymbol || looksLikeUuid(humanSymbol)) {
          try {
            const id = resolvedMarketUuid || (looksLikeUuid(humanSymbol) ? humanSymbol : undefined);
            if (id) {
              const { data: m } = await supabaseAdmin
                .from('orderbook_markets_view')
                .select('metric_id, symbol')
                .eq('id', id)
                .limit(1)
                .maybeSingle();
              const resolved = (m as any)?.metric_id || (m as any)?.symbol;
              if (resolved) humanSymbol = String(resolved);
            }
          } catch {
            // ignore
          }
        }
        humanSymbol = String(humanSymbol || symPart || 'UNKNOWN').trim();
        if (humanSymbol) humanSymbol = humanSymbol.toUpperCase();

        const tf = normalizeTf(timeframe);
        const tickTsMs = typeof timestamp === 'number' && Number.isFinite(timestamp) ? timestamp : Date.now();
        const tfMs = timeframeToMs(tf);
        const startMs = bucketStartMs(tickTsMs, tfMs);

        // Key by canonical id if present; fall back to human symbol (still stable for testing).
        const key = `${resolvedMarketUuid || humanSymbol}:${tf}`;

        const tickPrice = Number(price);
        if (!Number.isFinite(tickPrice)) {
          throw new Error(`Invalid tick price: ${price}`);
        }

        const prev = candleStateByKey.get(key);
        let next: CandleState;
        if (!prev || prev.bucketStartMs !== startMs) {
          // New candle bucket
          next = {
            bucketStartMs: startMs,
            open: tickPrice,
            high: tickPrice,
            low: tickPrice,
            close: tickPrice,
            volume: 0,
            lastTickMs: tickTsMs,
          };
        } else {
          // Same bucket; update OHLC
          const high = Math.max(prev.high, tickPrice);
          const low = Math.min(prev.low, tickPrice);
          const isInOrder = tickTsMs >= prev.lastTickMs;
          const close = isInOrder ? tickPrice : prev.close;
          const lastTickMs = isInOrder ? tickTsMs : prev.lastTickMs;
          // Simulate incremental volume for realism (optional). Keep small so repeated ticks
          // don't explode volume during demos.
          const volInc = isInOrder ? Math.random() * 25 : 0;
          next = {
            bucketStartMs: prev.bucketStartMs,
            open: prev.open,
            high,
            low,
            close,
            volume: prev.volume + volInc,
            lastTickMs,
          };
        }
        candleStateByKey.set(key, next);

        await pusherServer.broadcastChartData({
          symbol: humanSymbol,
          marketUuid: resolvedMarketUuid,
          timeframe: tf,
          open: next.open,
          high: next.high,
          low: next.low,
          close: next.close,
          volume: next.volume,
          timestamp: tickTsMs,
        });

        debug = {
          humanSymbol,
          resolvedMarketUuid: resolvedMarketUuid || null,
          normalizedTimeframe: tf,
          subscribedChannel: resolvedMarketUuid ? `chart-${resolvedMarketUuid}-${tf}` : `chart-${humanSymbol}-${tf}`,
          event: 'chart-update',
          candle: {
            bucketStartMs: next.bucketStartMs,
            open: next.open,
            high: next.high,
            low: next.low,
            close: next.close,
            volume: next.volume,
            tickTsMs,
          },
        };
        break;

      default:
        throw new Error(`Unknown test type: ${type}`);
    }

    return NextResponse.json({
      success: true,
      message: `Test ${type} event broadcasted successfully`,
      data: { type, symbol, price, marketUuid },
      debug,
    });

  } catch (error) {
    console.error('Pusher test error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Test broadcast failed',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const pusherServer = getPusherServer();
    const connectionInfo = pusherServer.getConnectionInfo();
    const testResult = await pusherServer.testConnection();

    return NextResponse.json({
      success: true,
      pusherInfo: connectionInfo,
      connectionTest: testResult,
      envCheck: {
        // Safe to expose: keys/clusters are public identifiers (secrets are not included)
        server: {
          key: process.env.PUSHER_KEY || null,
          cluster: process.env.PUSHER_CLUSTER || 'us2',
        },
        client: {
          key: process.env.NEXT_PUBLIC_PUSHER_KEY || null,
          cluster: process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2',
        },
        match: {
          key: Boolean(process.env.PUSHER_KEY && process.env.NEXT_PUBLIC_PUSHER_KEY && process.env.PUSHER_KEY === process.env.NEXT_PUBLIC_PUSHER_KEY),
          cluster: String(process.env.PUSHER_CLUSTER || 'us2') === String(process.env.NEXT_PUBLIC_PUSHER_CLUSTER || 'us2'),
        }
      },
      availableTests: [
        'price - Test price updates',
        'ticker - Test token ticker updates', 
        'market - Test market data updates',
        'trading - Test trading events',
        'chart - Test chart data updates'
      ],
      usage:
        'POST /api/pusher/test with { "type": "chart", "symbol": "<marketUuid-or-symbol>", "marketUuid": "<optional-marketUuid>", "price": 50000, "timeframe": "1m" }',
    });

  } catch (error) {
    console.error('Pusher test info error:', error);
    return NextResponse.json(
      { 
        success: false,
        error: 'Failed to get Pusher info',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 