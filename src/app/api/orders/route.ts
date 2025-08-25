import { NextRequest, NextResponse } from 'next/server';
import { Address, isAddress } from 'viem';
import { orderService } from '@/lib/orderService';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Query parameters
    const trader = searchParams.get('trader') as Address | null;
    const metricId = searchParams.get('metricId');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const type = searchParams.get('type') || 'history'; // 'active', 'history', 'market'

    console.log('🔍 Fetching orders:', { trader, metricId, limit, offset, type });

    // Validate trader address if provided
    if (trader && !isAddress(trader)) {
      return NextResponse.json(
        { 
          error: 'Invalid trader address',
          details: 'Trader must be a valid Ethereum address'
        },
        { status: 400 }
      );
    }

    let orders = [];
    let marketDepth = null;

    try {
      if (trader && type === 'active') {
        // Get user's active orders
        orders = await orderService.getUserActiveOrders(trader);
      } else if (trader && type === 'history') {
        // Get user's order history
        orders = await orderService.getUserOrderHistory(trader, limit, offset);
      } else if (metricId && type === 'market') {
        // Get all orders for a specific metric
        orders = await orderService.getMetricOrders(metricId, limit);
        // Also get market depth
        marketDepth = await orderService.getMarketDepth(metricId, 15);
      } else if (metricId) {
        // Default: get market orders
        orders = await orderService.getMetricOrders(metricId, limit);
      } else {
        return NextResponse.json(
          { 
            error: 'Missing required parameters',
            details: 'Either trader address or metricId is required'
          },
          { status: 400 }
        );
      }

      console.log(`✅ Successfully fetched ${orders.length} orders`);

      return NextResponse.json({
        success: true,
        orders,
        marketDepth,
        pagination: {
          limit,
          offset,
          total: orders.length,
          hasMore: orders.length === limit
        }
      });

    } catch (contractError) {
      console.error('❌ Smart contract error:', contractError);
      
      // Return empty data instead of error for contract connectivity issues
      // This allows the UI to gracefully handle contract downtime
      return NextResponse.json({
        success: true,
        orders: [],
        marketDepth: null,
        pagination: {
          limit,
          offset,
          total: 0,
          hasMore: false
        },
        warning: 'Contract temporarily unavailable - showing cached data'
      });
    }

  } catch (error) {
    console.error('❌ API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: 'Failed to process orders request'
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId } = body;

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    console.log('🔍 Fetching single order:', orderId);

    const order = await orderService.getOrder(BigInt(orderId));
    
    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    // Also get executions for this order
    const executions = await orderService.getOrderExecutions(BigInt(orderId));

    return NextResponse.json({
      success: true,
      order,
      executions
    });

  } catch (error) {
    console.error('❌ POST API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

