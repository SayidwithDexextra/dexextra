import { NextRequest, NextResponse } from 'next/server';
import { getPusherServer } from '@/lib/pusher-server';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type = 'price', symbol = 'TEST', price = 100, timeframe = '1h' } = body as any;
   
     console.log('body', body);

    const pusherServer = getPusherServer();

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
        await pusherServer.broadcastChartData({
          symbol,
          timeframe,
          open: price * 0.99,
          high: price * 1.02,
          low: price * 0.98,
          close: price,
          volume: Math.random() * 1000,
          timestamp: Date.now(),
        });
        break;

      default:
        throw new Error(`Unknown test type: ${type}`);
    }

    return NextResponse.json({
      success: true,
      message: `Test ${type} event broadcasted successfully`,
      data: { type, symbol, price },
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
      availableTests: [
        'price - Test price updates',
        'ticker - Test token ticker updates', 
        'market - Test market data updates',
        'trading - Test trading events',
        'chart - Test chart data updates'
      ],
      usage: 'POST /api/pusher/test with { "type": "price", "symbol": "BTC", "price": 50000, "timeframe": "1h" }',
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