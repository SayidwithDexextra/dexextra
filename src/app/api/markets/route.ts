import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getPreferredSystem, isDexV2Enabled } from '@/lib/contracts';

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

interface MarketAPIBody {
  symbol: string;
  description?: string;
  category: string[];
  oracle_address: string;
  initial_price: string | number;
  price_decimals?: number;
  banner_image_url?: string;
  icon_image_url?: string;
  supporting_photo_urls?: string[];
  deployment_fee?: string | number;
  is_active?: boolean;
  user_address: string;
  vamm_address?: string;
  vault_address?: string;
  market_id?: string;
  transaction_hash?: string;
  deployment_status?: string;
  // Enhanced metadata fields
  block_number?: number;
  gas_used?: string;
  template_type?: string;
  template_name?: string;
  metric_name?: string;
  metric_data_source?: string;
  settlement_period_days?: number;
  max_leverage?: number;
  trading_fee_rate?: number;
  volume_scale_factor?: number;
  collateral_token?: string;
  network?: string;
  // System Integration Fields
  metric_registry_address?: string;
  centralized_vault_address?: string;
  chain_id?: number;
  factory_address?: string;
  router_address?: string;
  collateral_token_address?: string;
  metric_id?: string;
}

export async function POST(request: NextRequest) {
  try {
    const body: MarketAPIBody = await request.json();
    
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

    // Create the market record - use basic fields first, then try enhanced fields
    const basicMarketData = {
      // Basic market information (guaranteed to exist)
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
      
      // Contract deployment details - use provided values or null if not available
      vamm_address: body.vamm_address || null,
      vault_address: body.vault_address || null,
      market_id: body.market_id || null,
      transaction_hash: body.transaction_hash || null,
      deployment_status: body.deployment_status || 'pending'
    };

    // Enhanced metadata fields - only include if they exist in schema
    const enhancedFields = {
      block_number: body.block_number || null,
      gas_used: body.gas_used || null,
      template_type: body.template_type || 'preset',
      template_name: body.template_name || 'standard',
      metric_name: body.metric_name || body.symbol,
      metric_data_source: body.metric_data_source || null,
      settlement_period_days: body.settlement_period_days || 7,
      max_leverage: body.max_leverage || 50,
      trading_fee_rate: body.trading_fee_rate || 30,
      volume_scale_factor: body.volume_scale_factor || 1000,
      collateral_token: body.collateral_token || null,
      network: body.network || 'polygon',
      
      // System Integration Fields (NEW! - Complete ecosystem tracking)
      metric_registry_address: body.metric_registry_address || null,
      centralized_vault_address: body.centralized_vault_address || null,
      chain_id: body.chain_id || 137,
      factory_address: body.factory_address || null,
      router_address: body.router_address || null,
      collateral_token_address: body.collateral_token_address || null,
      metric_id: body.metric_id || null
    };

    // Try to insert with enhanced fields first, fallback to basic fields
    let data, error;
    
    try {
      console.log('💾 Attempting to create market with enhanced metadata...');
      const fullMarketData = { ...basicMarketData, ...enhancedFields };
      
      console.log('📊 Full market data:', {
        symbol: fullMarketData.symbol,
        vamm_address: fullMarketData.vamm_address,
        vault_address: fullMarketData.vault_address,
        market_id: fullMarketData.market_id,
        deployment_status: fullMarketData.deployment_status,
        has_enhanced_fields: !!fullMarketData.template_type
      });

      const result = await supabase
        .from('vamm_markets')
        .insert([fullMarketData])
        .select()
        .single();
        
      data = result.data;
      error = result.error;
      
    } catch (enhancedError: any) {
      console.warn('⚠️ Enhanced fields failed, trying basic fields only:', enhancedError.message);
      
      // Fallback to basic fields only
      const result = await supabase
        .from('vamm_markets')
        .insert([basicMarketData])
        .select()
        .single();
        
      data = result.data;
      error = result.error;
    }

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

    // Also add VAMM to monitored_contracts table for automatic event tracking
    if (data?.vamm_address && data?.deployment_status === 'deployed') {
      try {
        const monitoredContractData = {
          name: `${data.symbol}_VAMM`,
          address: data.vamm_address,
          type: 'VAMM',
          network: 'polygon',
          is_active: true,
          description: `Specialized VAMM for ${data.symbol} - ${data.description}`,
          created_at: new Date().toISOString()
        };

        const { error: monitorError } = await supabase
          .from('monitored_contracts')
          .insert([monitoredContractData]);

        if (monitorError) {
          console.warn('⚠️ Failed to add VAMM to monitored_contracts:', monitorError);
          // Don't fail the entire request for this
        } else {
          console.log('✅ VAMM added to monitored_contracts for automatic event tracking');
        }

        // Also add vault to monitoring if provided
        if (data.vault_address) {
          const vaultMonitorData = {
            name: `${data.symbol}_VAULT`,
            address: data.vault_address,
            type: 'VAULT',
            network: 'polygon',
            is_active: true,
            description: `Vault for ${data.symbol} VAMM`,
            created_at: new Date().toISOString()
          };

          const { error: vaultMonitorError } = await supabase
            .from('monitored_contracts')
            .insert([vaultMonitorData]);

          if (vaultMonitorError) {
            console.warn('⚠️ Failed to add Vault to monitored_contracts:', vaultMonitorError);
          } else {
            console.log('✅ Vault added to monitored_contracts for automatic event tracking');
          }
        }
      } catch (monitoringError) {
        console.warn('⚠️ Error setting up contract monitoring:', monitoringError);
        // Don't fail the main operation
      }
    }

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
      // Decode the symbol in case it's URL-encoded
      const decodedSymbol = decodeURIComponent(symbol);
      
      // Try exact match first, then pattern matching as fallback
      query = query.or(`symbol.eq.${decodedSymbol},symbol.ilike.%${decodedSymbol}%`);
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