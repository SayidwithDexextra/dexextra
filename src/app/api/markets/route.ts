import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client with service role key for full access
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

// GET endpoint to retrieve markets from the new unified markets table
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    
    // Query parameters
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const status = searchParams.get('status'); // ACTIVE, PENDING, SETTLED, EXPIRED
    const category = searchParams.get('category');
    const creator = searchParams.get('creator'); // wallet address
    const search = searchParams.get('search'); // text search
    const symbol = searchParams.get('symbol'); // exact/partial symbol search

    console.log('🔍 Fetching markets:', { limit, offset, status, category, creator, search });

    // Build query against the new markets table
    let query = supabase
      .from('markets')
      .select(`
        id,
        market_identifier,
        symbol,
        name,
        description,
        category,
        decimals,
        minimum_order_size,
        tick_size,
        settlement_date,
        trading_end_date,
        market_address,
        market_id_bytes32,
        total_volume,
        total_trades,
        open_interest_long,
        open_interest_short,
        last_trade_price,
        market_status,
        deployment_status,
        creator_wallet_address,
        banner_image_url,
        icon_image_url,
        created_at,
        deployed_at,
        chain_id,
        network
      `, { count: 'exact' })
      .order('created_at', { ascending: false });

    // Apply filters
    if (status) {
      query = query.eq('market_status', status);
    }
    
    if (category) {
      query = query.eq('category', category);
    }

    if (symbol) {
      // Support partial symbol match
      query = query.ilike('symbol', `%${symbol}%`);
    }

    if (creator) {
      query = query.eq('creator_wallet_address', creator);
    }

    if (search) {
      query = query.or(`market_identifier.ilike.%${search}%,description.ilike.%${search}%,name.ilike.%${search}%,symbol.ilike.%${search}%`);
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

    // Enrich with latest mark_price from market_tickers and compute initial_price
    let enrichedMarkets = markets || [];
    if (enrichedMarkets.length > 0) {
      const ids = enrichedMarkets.map((m: any) => m.id);
      const { data: tickers, error: tErr } = await supabase
        .from('market_tickers')
        .select('market_id, mark_price, last_update, is_stale')
        .in('market_id', ids);
      if (tErr) {
        console.warn('⚠️ ticker enrichment failed:', tErr.message);
      } else {
        const idToTicker = new Map<string, any>();
        (tickers || []).forEach((t: any) => idToTicker.set(t.market_id, t));
        enrichedMarkets = enrichedMarkets.map((m: any) => {
          const t = idToTicker.get(m.id);
          const decimals = Number(m.decimals || 6);
          const scale = Math.pow(10, decimals);
          const mark = t?.mark_price != null ? Number(t.mark_price) : null;
          const initial_price = mark != null ? (mark / scale) : m.tick_size || 0;
          return {
            ...m,
            initial_price,
            price_decimals: decimals,
            _ticker_last_update: t?.last_update || null,
            _ticker_is_stale: t?.is_stale ?? null,
          };
        });
      }
    }

    console.log(`✅ Retrieved ${markets?.length || 0} markets`);

    return NextResponse.json({
      success: true,
      markets: enrichedMarkets,
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
    const { market_identifier, id, ...updateData } = body;

    if (!market_identifier && !id) {
      return NextResponse.json(
        { error: 'market_identifier or id is required for updates' },
        { status: 400 }
      );
    }

    console.log('🔄 Updating market:', market_identifier || id);

    // Add updated_at timestamp
    const finalUpdateData = {
      ...updateData,
      updated_at: new Date().toISOString()
    };

    // If market is being deployed, set deployed_at
    if (updateData.deployment_status === 'DEPLOYED' && !updateData.deployed_at) {
      finalUpdateData.deployed_at = new Date().toISOString();
    }

    let query = supabase.from('markets').update(finalUpdateData);
    
    // Choose whether to query by ID or market_identifier
    if (id) {
      query = query.eq('id', id);
    } else {
      query = query.eq('market_identifier', market_identifier);
    }
    
    const { data: updatedMarket, error } = await query.select().single();

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

    console.log('✅ Market updated successfully:', updatedMarket.market_identifier);

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

// POST endpoint to create a new market
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    console.log('📝 Creating new market:', {
      market_identifier: body.market_identifier,
      name: body.name,
      symbol: body.symbol,
      user_address: body.user_address
    });

    // Validate required fields
    const requiredFields = [
      'market_identifier',
      'symbol',
      'name',
      'description', 
      'category',
      'decimals',
      'minimum_order_size',
      'settlement_date',
      'trading_end_date',
      'data_request_window_seconds',
      'oracle_provider',
      'chain_id',
      'network',
      'creator_wallet_address'
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

    // Insert new market
    const { data: insertedMarket, error: insertError } = await supabase
      .from('markets')
      .insert([body])
      .select()
      .single();

    if (insertError) {
      console.error('❌ Database insertion error:', insertError);
      
      // Handle specific error cases
      if (insertError.code === '23505') { // Unique constraint violation
        return NextResponse.json(
          { 
            error: 'Market with this identifier already exists',
            details: insertError.message,
            code: 'DUPLICATE_MARKET_IDENTIFIER'
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
      market_identifier: insertedMarket.market_identifier,
      market_address: insertedMarket.market_address
    });

    // Return success response
    return NextResponse.json({
      success: true,
      market: insertedMarket,
      message: 'Market created successfully'
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