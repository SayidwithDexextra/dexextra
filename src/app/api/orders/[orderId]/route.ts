import { NextRequest, NextResponse } from 'next/server';

import { supabaseAdmin } from '@/lib/supabase-admin';
import { z } from 'zod';

// Cancel order schema
const CancelOrderSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address'),
  signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/, 'Invalid signature format'),
  timestamp: z.number().min(0, 'Invalid timestamp'),
});

/**
 * GET /api/orders/[orderId] - Get specific order details
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    const orderId = params.orderId;

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Get order from database
    const { data: order, error } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        orderbook_markets!inner (
          metric_id,
          description,
          market_status,
          last_trade_price
        )
      `)
      .eq('order_id', orderId)
      .single();

    if (error || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    // Get related trade matches
    const { data: trades } = await supabaseAdmin
      .from('trade_matches')
      .select('*')
      .or(`buy_order_id.eq.${order.id},sell_order_id.eq.${order.id}`)
      .order('matched_at', { ascending: false });

    // Format response
    const formattedOrder = {
      orderId: order.order_id,
      metricId: order.orderbook_markets.metric_id,
      marketDescription: order.orderbook_markets.description,
      marketStatus: order.orderbook_markets.market_status,
      orderType: order.order_type,
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      filledQuantity: order.filled_quantity,
      remainingQuantity: order.remaining_quantity,
      averageFillPrice: order.average_fill_price,
      status: order.order_status,
      timeInForce: order.time_in_force,
      postOnly: order.post_only,
      reduceOnly: order.reduce_only,
      createdAt: order.created_at,
      updatedAt: order.updated_at,
      openedAt: order.opened_at,
      closedAt: order.closed_at,
      expiresAt: order.expires_at,
      clientOrderId: order.client_order_id,
      source: order.source,
      
      // Trading statistics
      totalFees: order.estimated_fees,
      isMaker: order.is_maker,
      matchingAttempts: order.matching_attempts,
      lastMatchAttempt: order.last_match_attempt_at,
      submissionLatency: order.submission_latency_ms,

      // Related trades
      trades: trades?.map(trade => ({
        matchId: trade.match_id,
        price: trade.trade_price,
        quantity: trade.trade_quantity,
        totalValue: trade.total_value,
        buyerFee: trade.buy_trader_fee,
        sellerFee: trade.sell_trader_fee,
        settlementStatus: trade.settlement_status,
        matchedAt: trade.matched_at,
        settledAt: trade.settled_at
      })) || [],

      // Market context
      marketContext: {
        lastTradePrice: order.orderbook_markets.last_trade_price,
        priceImpact: order.price && order.orderbook_markets.last_trade_price 
          ? ((parseFloat(order.price) - parseFloat(order.orderbook_markets.last_trade_price)) / parseFloat(order.orderbook_markets.last_trade_price) * 100).toFixed(4) + '%'
          : null
      }
    };

    return NextResponse.json({ order: formattedOrder });

  } catch (error) {
    console.error('Get order error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch order details' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/orders/[orderId] - Cancel an order
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  const startTime = Date.now();

  try {
    const orderId = params.orderId;

    if (!orderId) {
      return NextResponse.json(
        { error: 'Order ID is required' },
        { status: 400 }
      );
    }

    // Parse and validate request body
    const body = await request.json();
    const validationResult = CancelOrderSchema.safeParse(body);
    
    if (!validationResult.success) {
      return NextResponse.json(
        { 
          error: 'Invalid request body',
          details: validationResult.error.errors.map(err => ({
            field: err.path.join('.'),
            message: err.message
          }))
        },
        { status: 400 }
      );
    }

    const { walletAddress, signature, timestamp } = validationResult.data;

    // Verify timestamp is recent (within 5 minutes)
    const now = Date.now();
    if (Math.abs(now - timestamp) > 5 * 60 * 1000) {
      return NextResponse.json(
        { error: 'Cancel request timestamp too old or too far in future' },
        { status: 400 }
      );
    }

    // Get order from database to verify ownership
    const { data: order, error: orderError } = await supabaseAdmin
      .from('orders')
      .select(`
        *,
        orderbook_markets!inner (
          metric_id,
          market_status
        )
      `)
      .eq('order_id', orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      );
    }

    // Verify order ownership
    if (order.trader_wallet_address.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json(
        { error: 'Unauthorized: Order does not belong to this wallet' },
        { status: 403 }
      );
    }

    // Check if order is cancellable
    if (!['PENDING', 'OPEN', 'PARTIALLY_FILLED'].includes(order.order_status)) {
      return NextResponse.json(
        { error: `Cannot cancel order with status: ${order.order_status}` },
        { status: 400 }
      );
    }

    // Verify signature (implement proper EIP-712 verification)
    const isValidSignature = await verifyCancelSignature(orderId, walletAddress, signature, timestamp);
    if (!isValidSignature) {
      return NextResponse.json(
        { error: 'Invalid cancellation signature' },
        { status: 401 }
      );
    }

    // Serverless order cancellation - update order status directly in database
    const { error: updateError } = await supabaseAdmin
      .from('orders')
      .update({
        order_status: 'CANCELLED',
        closed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
      .eq('order_id', orderId);

    if (updateError) {
      console.error('Failed to update order status:', updateError);
      throw updateError;
    }

    const processingTime = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      orderId,
      status: 'CANCELLED',
      cancelledAt: new Date().toISOString(),
      remainingQuantity: order.quantity - order.filled_quantity,
      processingTime: `${processingTime}ms`
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('Order cancellation error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        processingTime: `${processingTime}ms`
      },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/orders/[orderId] - Modify an order (if supported)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { orderId: string } }
) {
  try {
    // For now, return not implemented
    // Order modification would require additional logic in the matching engine
    return NextResponse.json(
      { 
        error: 'Order modification not yet implemented',
        suggestion: 'Cancel the existing order and place a new one'
      },
      { status: 501 }
    );

  } catch (error) {
    console.error('Order modification error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Helper functions

async function verifyCancelSignature(
  orderId: string, 
  walletAddress: string, 
  signature: string, 
  timestamp: number
): Promise<boolean> {
  try {
    // Implement EIP-712 signature verification for order cancellation
    // This should verify that the wallet owner signed the cancellation request
    
    // For now, return true - implement proper verification based on your signature scheme
    return true;
    
  } catch (error) {
    console.error('Cancel signature verification error:', error);
    return false;
  }
}

