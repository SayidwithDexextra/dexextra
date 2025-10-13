import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Simplified order schema for demo (no signature validation)
interface DemoOrderRequest {
  metricId: string;
  orderType: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  quantity: string;
  price?: string;
  walletAddress: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTD';
  postOnly?: boolean;
  reduceOnly?: boolean;
}

/**
 * Demo route for testing order insertion without EIP-712 signing
 * POST /api/orders/demo
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();

  try {
    // Initialize Supabase
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Parse request body
    const body: DemoOrderRequest = await request.json();

    // Basic validation
    if (!body.metricId || !body.orderType || !body.side || !body.quantity || !body.walletAddress) {
      return NextResponse.json(
        { error: 'Missing required fields: metricId, orderType, side, quantity, walletAddress' },
        { status: 400 }
      );
    }

    // Validate quantity
    const quantity = parseFloat(body.quantity);
    if (isNaN(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: 'Invalid quantity: must be a positive number' },
        { status: 400 }
      );
    }

    // Validate price for LIMIT orders
    let price: number | null = null;
    if (body.orderType === 'LIMIT') {
      if (!body.price) {
        return NextResponse.json(
          { error: 'LIMIT orders require a price' },
          { status: 400 }
        );
      }
      price = parseFloat(body.price);
      if (isNaN(price) || price <= 0) {
        return NextResponse.json(
          { error: 'Invalid price: must be a positive number' },
          { status: 400 }
        );
      }
    }

    // Generate a simple order ID (in production this would come from the blockchain)
    const orderId = Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000);

    // Prepare order data for insertion
    const orderData = {
      order_id: orderId,
      market_id: body.metricId, // Using metricId directly as market_id for demo
      user_address: body.walletAddress,
      trader_address: body.walletAddress, // Alias column
      order_type: body.orderType,
      side: body.side,
      size: quantity,
      quantity: quantity, // Alias column
      price: price,
      filled: 0,
      status: 'PENDING',
      margin_reserved: quantity * (price || 1) * 0.1, // Simple margin calculation
      tx_hash: null,
      block_number: null,
      log_index: null,
      contract_address: null,
      event_type: 'api_demo',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    console.log('📝 [DEMO] Inserting order data:', orderData);
    console.log('⏱️ [DEMO] Adding 2-second delay for animation testing...');

    // Add 2-second delay for animation testing
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Insert order into Supabase
    const { data, error } = await supabase
      .from('orders')
      .insert([orderData])
      .select()
      .single();

    if (error) {
      console.error('❌ [DEMO] Error inserting order:', error);
      return NextResponse.json(
        { 
          error: 'Failed to insert order',
          details: error.message
        },
        { status: 500 }
      );
    }

    const processingTime = Date.now() - startTime;

    console.log('✅ [DEMO] Order inserted successfully:', data);
    console.log('📡 [DEMO] Supabase will automatically broadcast this change via real-time subscriptions');
    console.log('🔄 [DEMO] Database triggers will automatically consolidate duplicate orders');

    return NextResponse.json({
      success: true,
      orderId: orderId,
      status: 'PENDING',
      filledQuantity: 0,
      order: data,
      processingTime: `${processingTime}ms`,
      message: 'Demo order successfully inserted - automatic consolidation handled by database triggers'
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ [DEMO] Order insertion error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error',
        processingTime: `${processingTime}ms`
      },
      { status: 500 }
    );
  }
}

// Optional: GET method to retrieve demo orders
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricId = searchParams.get('metricId');
    const limit = parseInt(searchParams.get('limit') || '10');

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    
    if (!supabaseUrl || !supabaseKey) {
      return NextResponse.json(
        { error: 'Missing Supabase configuration' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    let query = supabase
      .from('orders')
      .select('*')
      .eq('event_type', 'api_demo')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (metricId) {
      query = query.eq('market_id', metricId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('❌ [DEMO] Error fetching orders:', error);
      return NextResponse.json(
        { error: 'Failed to fetch orders' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      orders: data,
      count: data?.length || 0
    });

  } catch (error) {
    console.error('❌ [DEMO] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
