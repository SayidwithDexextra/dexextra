import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Helper function to validate Ethereum addresses
function isValidEthereumAddress(address: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
}

/**
 * Deployment Status Workflow:
 * 
 * 1. 'pending' - Default status when market is created but deployment hasn't started
 * 2. 'deployed' - Contract deployment successful, vamm_address and vault_address populated
 * 3. 'failed' - Contract deployment failed, addresses remain null
 * 
 * Only markets with 'deployed' status are:
 * - Loaded by EventDatabase for event monitoring
 * - Shown with green status in the UI
 * - Available for trading
 */

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase environment variables:', {
    supabaseUrl: !!supabaseUrl,
    supabaseServiceKey: !!supabaseServiceKey
  });
  throw new Error('Missing Supabase environment variables');
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    // Validate required fields
    const requiredFields = [
      'symbol', 
      'description', 
      'category', 
      'oracle_address', 
      'initial_price',
      'user_address'
    ];
    
    for (const field of requiredFields) {
      if (!body[field]) {
        return NextResponse.json(
          { error: `Missing required field: ${field}` },
          { status: 400 }
        );
      }
    }

    // Validate category is an array
    if (!Array.isArray(body.category) || body.category.length === 0) {
      return NextResponse.json(
        { error: 'Category must be an array with at least one item' },
        { status: 400 }
      );
    }

    // Validate Ethereum addresses
    if (!isValidEthereumAddress(body.oracle_address)) {
      return NextResponse.json(
        { error: 'Invalid oracle address format' },
        { status: 400 }
      );
    }

    if (!isValidEthereumAddress(body.user_address)) {
      return NextResponse.json(
        { error: 'Invalid user address format' },
        { status: 400 }
      );
    }

    // Validate contract addresses if provided
    if (body.vamm_address && !isValidEthereumAddress(body.vamm_address)) {
      return NextResponse.json(
        { error: 'Invalid vAMM address format' },
        { status: 400 }
      );
    }

    if (body.vault_address && !isValidEthereumAddress(body.vault_address)) {
      return NextResponse.json(
        { error: 'Invalid vault address format' },
        { status: 400 }
      );
    }

    // Validate transaction hash if provided
    if (body.transaction_hash && !/^0x[a-fA-F0-9]{64}$/.test(body.transaction_hash)) {
      return NextResponse.json(
        { error: 'Invalid transaction hash format' },
        { status: 400 }
      );
    }

    // Create the market record
    const marketData = {
      symbol: body.symbol,
      description: body.description,
      category: body.category,
      oracle_address: body.oracle_address,
      initial_price: parseFloat(body.initial_price),
      price_decimals: body.price_decimals || 8,
      banner_image_url: body.banner_image_url || null,
      icon_image_url: body.icon_image_url || null,
      supporting_photo_urls: body.supporting_photo_urls || [],
      deployment_fee: parseFloat(body.deployment_fee || '0.1'),
      is_active: body.is_active !== undefined ? body.is_active : true,
      user_address: body.user_address,
      created_at: new Date().toISOString(),
      // Contract deployment details - use provided values or null if not available
      vamm_address: body.vamm_address || null,
      vault_address: body.vault_address || null,
      market_id: body.market_id || null,
      transaction_hash: body.transaction_hash || null,
      deployment_status: body.deployment_status || 'pending'
    };

    console.log('💾 Creating market with data:', {
      symbol: marketData.symbol,
      vamm_address: marketData.vamm_address,
      vault_address: marketData.vault_address,
      market_id: marketData.market_id,
      deployment_status: marketData.deployment_status
    });

    const { data, error } = await supabase
      .from('vamm_markets')
      .insert([marketData])
      .select()
      .single();

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: 'Failed to create market record' },
        { status: 500 }
      );
    }

    console.log('✅ Market created successfully:', {
      id: data.id,
      symbol: data.symbol,
      vamm_address: data.vamm_address,
      vault_address: data.vault_address,
      deployment_status: data.deployment_status
    });

    return NextResponse.json({
      success: true,
      market: data,
      message: 'Market created successfully'
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const limit = searchParams.get('limit') || '10';
    const offset = searchParams.get('offset') || '0';
    const category = searchParams.get('category');
    const status = searchParams.get('status');
    const symbol = searchParams.get('symbol');

    let query = supabase
      .from('vamm_markets')
      .select('*')
      .order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

    if (category) {
      query = query.eq('category', category);
    }

    if (status) {
      query = query.eq('deployment_status', status);
    }

    if (symbol) {
      query = query.ilike('symbol', symbol);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Supabase error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch markets' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      markets: data,
      count: data.length
    });

  } catch (error) {
    console.error('API error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
} 