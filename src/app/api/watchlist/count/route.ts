import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const marketId = searchParams.get('market_id');
    const userId = searchParams.get('user_id');

    if (!marketId && !userId) {
      return NextResponse.json(
        { success: false, error: 'market_id or user_id is required' },
        { status: 400 }
      );
    }

    let query = supabaseAdmin
      .from('user_watchlists')
      .select('*', { count: 'exact', head: true });

    if (userId) {
      query = query.eq('item_type', 'user').eq('watched_user_id', userId);
    } else if (marketId) {
      query = query.eq('item_type', 'market').eq('market_id', marketId);
    }

    const { count, error } = await query;

    if (error) {
      throw error;
    }

    return NextResponse.json({
      success: true,
      count: count || 0,
    });
  } catch (error) {
    console.error('Error fetching watchlist count:', error);
    return NextResponse.json(
      { success: false, error: 'Failed to fetch watchlist count' },
      { status: 500 }
    );
  }
}
