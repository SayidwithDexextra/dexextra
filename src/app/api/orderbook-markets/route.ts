import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key for full access
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('📝 Creating new orderbook market:', {
      metric_id: body.metric_id,
      description: body.description?.substring(0, 50) + '...',
      user_address: body.user_address
    });

    // Validate required fields
    const requiredFields = [
      'metric_id',
      'description', 
      'category',
      'decimals',
      'minimum_order_size',
      'settlement_date',
      'trading_end_date',
      'data_request_window_hours',
      'oracle_provider',
      'creation_fee',
      'user_address'
    ];

    const missingFields = requiredFields.filter(field => !body[field]);
    if (missingFields.length > 0) {
      console.error('❌ Missing required fields:', missingFields);
      return NextResponse.json(
        { 
          error: 'Missing required fields',
          missing_fields: missingFields,
          details: `Required fields: ${missingFields.join(', ')}`
        },
        { status: 400 }
      );
    }

    // Prepare market data for database insertion
    const marketData = {
      // Step 1: Market Information
      metric_id: body.metric_id,
      description: body.description,
      category: body.category, // Should be string, not array

      // Step 2: Trading Configuration  
      decimals: body.decimals,
      minimum_order_size: body.minimum_order_size,
      tick_size: body.tick_size || 0.01, // Fixed tick size
      requires_kyc: body.requires_kyc || false,

      // Step 3: Settlement Configuration
      settlement_date: body.settlement_date,
      trading_end_date: body.trading_end_date, 
      data_request_window_seconds: (body.data_request_window_hours || 24) * 3600,
      auto_settle: body.auto_settle !== false, // Default to true
      oracle_provider: body.oracle_provider,

      // Step 3: Initial Order Configuration (stored as JSONB)
      initial_order: body.initial_order_enabled ? {
        enabled: true,
        side: body.initial_order_side,
        quantity: body.initial_order_quantity,
        price: body.initial_order_price,
        time_in_force: body.initial_order_time_in_force,
        expiry_time: body.initial_order_expiry_time || null
      } : {
        enabled: false
      },

      // Step 4: Market Images
      banner_image_url: body.banner_image_url || null,
      icon_image_url: body.icon_image_url || null,
      supporting_photo_urls: body.supporting_photo_urls || [],

      // Step 5: Advanced Settings
      creation_fee: body.creation_fee,
      is_active: body.is_active !== false, // Default to true

      // Smart Contract Addresses (populated after deployment)
      market_address: body.market_address || null,
      factory_address: body.factory_address || null,
      central_vault_address: body.central_vault_address || null,
      order_router_address: body.order_router_address || null,
      uma_oracle_manager_address: body.uma_oracle_manager_address || null,

      // Blockchain Information
      chain_id: body.chain_id || 137, // Default to Polygon
      deployment_transaction_hash: body.transaction_hash || null,
      deployment_block_number: body.block_number || null,

      // Market Analytics (initialized with defaults)
      total_volume: 0,
      total_trades: 0,
      open_interest: 0,
      highest_price: null,
      lowest_price: null,
      current_price: body.initial_order_enabled ? body.initial_order_price : null,

      // Market Status
      market_status: body.deployment_status === 'deployed' ? 'active' : 'pending',
      deployment_status: body.deployment_status || 'pending',

      // User Information
      creator_wallet_address: body.user_address,
      creator_user_id: null, // Will be populated if user has profile

      // AI Metric Resolution Link (optional)
      metric_resolution_id: body.metric_resolution_id || null,

      // Metadata
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deployed_at: body.deployment_status === 'deployed' ? new Date().toISOString() : null,

      // Enhanced metadata
      network: body.network || 'hyperliquid',
      gas_used: body.gas_used || null,
      deployment_error: null
    };

    console.log('💾 Inserting market data into database...');

    // Insert into orderbook_markets table
    const { data: insertedMarket, error: insertError } = await supabase
      .from('orderbook_markets')
      .insert([marketData])
      .select()
      .single();

    if (insertError) {
      console.error('❌ Database insertion error:', insertError);
      
      // Handle specific error cases
      if (insertError.code === '23505') { // Unique constraint violation
        return NextResponse.json(
          { 
            error: 'Market with this metric ID already exists',
            details: insertError.message,
            code: 'DUPLICATE_METRIC_ID'
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { 
          error: 'Failed to create market',
          details: insertError.message,
          code: insertError.code
        },
        { status: 500 }
      );
    }

    console.log('✅ Market created successfully:', {
      id: insertedMarket.id,
      metric_id: insertedMarket.metric_id,
      market_address: insertedMarket.market_address
    });

    // Return success response
    return NextResponse.json({
      success: true,
      market: {
        id: insertedMarket.id,
        metric_id: insertedMarket.metric_id,
        market_address: insertedMarket.market_address,
        factory_address: insertedMarket.factory_address,
        deployment_status: insertedMarket.deployment_status,
        market_status: insertedMarket.market_status,
        created_at: insertedMarket.created_at
      },
      message: 'OrderBook market created successfully'
    }, { 
      status: 201,
      headers: {
        'Content-Type': 'application/json'
      }
    });

  } catch (error) {
    console.error('❌ API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error',
        details: 'Failed to process market creation request'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to retrieve markets
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Query parameters
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status'); // active, pending, settled, expired
    const category = searchParams.get('category');
    const creator = searchParams.get('creator'); // wallet address
    const search = searchParams.get('search'); // text search

    console.log('🔍 Fetching orderbook markets:', { limit, offset, status, category, creator, search });

    // Build query
    let query = supabase
      .from('orderbook_markets')
      .select(`
        id,
        metric_id,
        description,
        category,
        decimals,
        minimum_order_size,
        tick_size,
        settlement_date,
        trading_end_date,
        market_address,
        factory_address,
        total_volume,
        total_trades,
        open_interest_long,
        open_interest_short,
        last_trade_price,
        market_status,
        creator_wallet_address,
        banner_image_url,
        icon_image_url,
        created_at,
        deployed_at,
        chain_id
      `)
      .order('created_at', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('market_status', status);
    }
    
    if (category) {
      query = query.eq('category', category);
    }
    
    if (creator) {
      query = query.eq('creator_wallet_address', creator);
    }

    if (search) {
      query = query.or(`metric_id.ilike.%${search}%,description.ilike.%${search}%`);
    }

    // Apply pagination
    query = query.range(offset, offset + limit - 1);

    const { data: markets, error, count } = await query;

    if (error) {
      console.error('❌ Database query error:', error);
      return NextResponse.json(
        { 
          error: 'Failed to fetch markets',
          details: error.message
        },
        { status: 500 }
      );
    }

    console.log(`✅ Retrieved ${markets?.length || 0} markets`);

    return NextResponse.json({
      success: true,
      markets: markets || [],
      pagination: {
        limit,
        offset,
        total: count || markets?.length || 0
      }
    });

  } catch (error) {
    console.error('❌ GET API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// PUT endpoint to update market (e.g., after contract deployment)
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { metric_id, ...updateData } = body;

    if (!metric_id) {
      return NextResponse.json(
        { error: 'metric_id is required for updates' },
        { status: 400 }
      );
    }

    console.log('🔄 Updating orderbook market:', metric_id);

    // Add updated_at timestamp
    const finalUpdateData = {
      ...updateData,
      updated_at: new Date().toISOString()
    };

    // If market is being deployed, set deployed_at
    if (updateData.deployment_status === 'deployed' && !updateData.deployed_at) {
      finalUpdateData.deployed_at = new Date().toISOString();
    }

    const { data: updatedMarket, error } = await supabase
      .from('orderbook_markets')
      .update(finalUpdateData)
      .eq('metric_id', metric_id)
      .select()
      .single();

    if (error) {
      console.error('❌ Update error:', error);
      return NextResponse.json(
        { 
          error: 'Failed to update market',
          details: error.message
        },
        { status: 500 }
      );
    }

    if (!updatedMarket) {
      return NextResponse.json(
        { error: 'Market not found' },
        { status: 404 }
      );
    }

    console.log('✅ Market updated successfully:', updatedMarket.metric_id);

    return NextResponse.json({
      success: true,
      market: updatedMarket,
      message: 'Market updated successfully'
    });

  } catch (error) {
    console.error('❌ PUT API Error:', error);
    
    return NextResponse.json(
      { 
        error: 'Internal server error',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
