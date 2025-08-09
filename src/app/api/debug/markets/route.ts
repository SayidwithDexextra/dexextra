import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

export async function GET(request: NextRequest) {
  try {
    if (!supabaseUrl || !supabaseServiceKey) {
      return NextResponse.json(
        { error: 'Supabase configuration missing' },
        { status: 500 }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    
    // Get recent markets
    const { data: markets, error } = await supabase
      .from('vamm_markets')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    
    if (error) {
      console.error('Database error:', error);
      return NextResponse.json(
        { error: 'Failed to fetch markets', details: error },
        { status: 500 }
      );
    }
    
    // Also get table schema info
    const { data: columns, error: schemaError } = await supabase.rpc('get_column_info', {
      table_name: 'vamm_markets'
    }).single();
    
    return NextResponse.json({
      success: true,
      totalMarkets: markets.length,
      markets: markets.map(market => ({
        id: market.id,
        symbol: market.symbol,
        description: market.description,
        status: market.deployment_status,
        vamm_address: market.vamm_address,
        vault_address: market.vault_address,
        created_at: market.created_at,
        user_address: market.user_address,
        has_template_data: !!(market.template_type && market.template_name),
        template_type: market.template_type,
        template_name: market.template_name
      })),
      schema_check: schemaError ? 'Schema function not available' : 'Schema accessible'
    });
    
  } catch (error) {
    console.error('Debug endpoint error:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: (error as Error).message },
      { status: 500 }
    );
  }
} 