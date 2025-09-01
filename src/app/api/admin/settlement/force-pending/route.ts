import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

/**
 * Force trades to PENDING status for blockchain settlement
 * This is an admin endpoint for debugging and manual settlement triggers
 */
export async function POST(request: NextRequest) {
  try {
    const { tradeMatchIds, marketId, force = false } = await request.json();

    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    console.log('🔄 Force pending settlement request:', {
      tradeMatchIds: tradeMatchIds?.length || 'all',
      marketId,
      force
    });

    // Build query conditions
    let query = supabase
      .from('trade_matches')
      .select('*');

    if (tradeMatchIds && tradeMatchIds.length > 0) {
      query = query.in('id', tradeMatchIds);
    } else if (marketId) {
      query = query.eq('market_id', marketId);
    } else if (!force) {
      return NextResponse.json(
        { error: 'Must specify tradeMatchIds, marketId, or set force=true to process all trades' },
        { status: 400 }
      );
    }

    // Add status filter unless forcing
    if (!force) {
      query = query.in('settlement_status', ['PENDING', 'FAILED']);
    }

    const { data: trades, error: fetchError } = await query;

    if (fetchError) {
      console.error('❌ Error fetching trades:', fetchError);
      return NextResponse.json(
        { error: `Failed to fetch trades: ${fetchError.message}` },
        { status: 500 }
      );
    }

    if (!trades || trades.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No trades found to process',
        processed: 0
      });
    }

    console.log(`📊 Found ${trades.length} trades to force to PENDING status`);

    // Update trades to PENDING status
    const tradeIds = trades.map(t => t.id);
    const { error: updateError } = await supabase
      .from('trade_matches')
      .update({
        settlement_status: 'PENDING',
        settlement_batch_id: null,
        settlement_requested_at: null,
        settlement_attempts: 0,
        updated_at: new Date().toISOString()
      })
      .in('id', tradeIds);

    if (updateError) {
      console.error('❌ Error updating trades to PENDING:', updateError);
      return NextResponse.json(
        { error: `Failed to update trades: ${updateError.message}` },
        { status: 500 }
      );
    }

    console.log(`✅ Successfully updated ${trades.length} trades to PENDING status`);

    // Return detailed response
    return NextResponse.json({
      success: true,
      message: `Successfully updated ${trades.length} trades to PENDING status`,
      processed: trades.length,
      trades: trades.map(t => ({
        id: t.id,
        match_id: t.match_id,
        market_id: t.market_id,
        trade_price: t.trade_price,
        trade_quantity: t.trade_quantity,
        previous_status: t.settlement_status
      }))
    });

  } catch (error) {
    console.error('❌ Force pending settlement error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * Get current settlement status and pending trades
 */
export async function GET(request: NextRequest) {
  try {
    if (!env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json(
        { error: 'Service role key not configured' },
        { status: 500 }
      );
    }

    const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

    // Get settlement status summary
    const { data: statusSummary, error: summaryError } = await supabase
      .from('trade_matches')
      .select('settlement_status')
      .then(result => {
        if (result.error) return result;
        
        const summary = result.data?.reduce((acc, trade) => {
          acc[trade.settlement_status] = (acc[trade.settlement_status] || 0) + 1;
          return acc;
        }, {} as Record<string, number>) || {};

        return { data: summary, error: null };
      });

    if (summaryError) {
      console.error('❌ Error getting status summary:', summaryError);
      return NextResponse.json(
        { error: `Failed to get status summary: ${summaryError.message}` },
        { status: 500 }
      );
    }

    // Get pending trades details
    const { data: pendingTrades, error: pendingError } = await supabase
      .from('trade_matches')
      .select(`
        id,
        match_id,
        market_id,
        settlement_status,
        trade_price,
        trade_quantity,
        buy_trader_wallet_address,
        sell_trader_wallet_address,
        matched_at,
        settlement_attempts,
        updated_at
      `)
      .eq('settlement_status', 'PENDING')
      .order('matched_at', { ascending: true })
      .limit(50);

    if (pendingError) {
      console.error('❌ Error getting pending trades:', pendingError);
      return NextResponse.json(
        { error: `Failed to get pending trades: ${pendingError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      summary: statusSummary,
      pending_trades: pendingTrades || [],
      pending_count: pendingTrades?.length || 0
    });

  } catch (error) {
    console.error('❌ Get settlement status error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}





