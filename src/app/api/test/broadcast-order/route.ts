import { NextRequest, NextResponse } from 'next/server';
import { PusherServerService } from '@/lib/pusher-server';

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Test endpoint to simulate order broadcasts for testing the real-time system
 * DELETE this endpoint before production deployment
 */
export async function POST(request: NextRequest) {
  try {
    if (process.env.NODE_ENV === 'production') {
      return NextResponse.json({ success: false, error: 'Disabled in production' }, { status: 403 })
    }
    const body = await request.json();
    
    // Default test order data
    const testOrder = {
      orderId: `test-${Date.now()}`,
      trader: '0x742d35Cc6e6f464e8000000000000000000DeEd',
      metricId: 'SILVER_V2',
      orderType: 'LIMIT',
      side: 'BUY',
      quantity: 1000,
      price: 24.50,
      filledQuantity: 0,
      status: 'PENDING',
      eventType: 'placed',
      timestamp: Date.now(),
      source: 'test',
      ...body // Override with any provided data
    };

    console.log('🧪 [TEST] Broadcasting test order:', testOrder);

    // Initialize Pusher service
    const pusherService = new PusherServerService();

    // Broadcast to all relevant channels
    const channels = [
      `market-${testOrder.metricId}`,
      'recent-transactions',
      `user-${testOrder.trader}`
    ];

    const broadcastPromises = channels.map(channel => 
      pusherService.pusher.trigger(channel, 'order-update', testOrder)
    );

    await Promise.all(broadcastPromises);

    // Also broadcast via trading events channel
    await pusherService.broadcastTradingEvent({
      symbol: testOrder.metricId,
      action: testOrder.eventType,
      userAddress: testOrder.trader,
      orderType: testOrder.orderType,
      side: testOrder.side,
      quantity: testOrder.quantity,
      price: testOrder.price,
      timestamp: testOrder.timestamp
    });

    console.log('✅ [TEST] Successfully broadcasted test order to all channels');

    return NextResponse.json({
      success: true,
      message: 'Test order broadcasted successfully',
      order: testOrder,
      channels
    });

  } catch (error) {
    console.error('❌ [TEST] Failed to broadcast test order:', error);
    
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}

/**
 * GET endpoint to simulate different types of order events
 */
export async function GET(request: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ success: false, error: 'Disabled in production' }, { status: 403 })
  }
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'placed';
  const metricId = searchParams.get('metricId') || 'SILVER_V2';
  
  // Generate different test scenarios
  const scenarios: Record<string, any> = {
    placed: {
      eventType: 'placed',
      status: 'PENDING',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 1000,
      price: 24.50
    },
    executed: {
      eventType: 'executed',
      status: 'FILLED',
      side: 'SELL',
      orderType: 'MARKET',
      quantity: 500,
      price: 24.45,
      filledQuantity: 500
    },
    cancelled: {
      eventType: 'cancelled',
      status: 'CANCELLED',
      side: 'BUY',
      orderType: 'LIMIT',
      quantity: 750,
      price: 24.30
    }
  };

  const testData = scenarios[type] || scenarios.placed;
  
  try {
    const pusherService = new PusherServerService();
    
    const testOrder = {
      orderId: `test-${type}-${Date.now()}`,
      trader: '0x742d35Cc6e6f464e8000000000000000000DeEd',
      metricId,
      timestamp: Date.now(),
      source: 'test',
      ...testData
    };

    // Broadcast the test order
    await pusherService.pusher.trigger(`market-${metricId}`, 'order-update', testOrder);
    await pusherService.pusher.trigger('recent-transactions', 'new-order', testOrder);

    return NextResponse.json({
      success: true,
      message: `Test ${type} order broadcasted`,
      order: testOrder
    });

  } catch (error) {
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}





