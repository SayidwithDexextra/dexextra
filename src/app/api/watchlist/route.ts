import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';

const WatchlistSchema = z.object({
  wallet_address: z.string().regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format'),
  market_id: z.string().uuid('Invalid market id'),
  metric_id: z.string().min(1, 'Metric id is required').optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, metric_id, market_id } = WatchlistSchema.parse(body);

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('user_watchlists')
      .select('id')
      .eq('wallet_address', wallet_address)
      .eq('market_id', market_id)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') {
      throw existingError;
    }

    if (existing) {
      return NextResponse.json({
        success: true,
        status: 'exists',
      });
    }

    const { data: userProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('wallet_address', wallet_address)
      .maybeSingle();

    const { error: insertError } = await supabaseAdmin.from('user_watchlists').insert({
      wallet_address,
      metric_id: metric_id || null,
      market_id,
      user_id: userProfile?.id || null,
    });

    if (insertError) {
      throw insertError;
    }

    return NextResponse.json({
      success: true,
      status: 'added',
    });
  } catch (error) {
    console.error('Error adding to watchlist:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid watchlist data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to add to watchlist',
      },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json();
    const { wallet_address, market_id } = WatchlistSchema.parse(body);

    const { error: deleteError } = await supabaseAdmin
      .from('user_watchlists')
      .delete()
      .eq('wallet_address', wallet_address)
      .eq('market_id', market_id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
      status: 'removed',
    });
  } catch (error) {
    console.error('Error removing from watchlist:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid watchlist data',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to remove from watchlist',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const wallet = searchParams.get('wallet');
    if (!wallet) {
      return NextResponse.json(
        { success: false, error: 'Wallet address required' },
        { status: 400 }
      );
    }

    const { wallet_address } = WatchlistSchema.pick({ wallet_address: true }).parse({
      wallet_address: wallet,
    });

    const { data, error } = await supabaseAdmin
      .from('user_watchlists')
      .select('market_id')
      .eq('wallet_address', wallet_address)
      .order('created_at', { ascending: false });

    if (error) {
      throw error;
    }

    const marketIds = (data || [])
      .map((row) => row.market_id)
      .filter((id): id is string => Boolean(id));

    return NextResponse.json({
      success: true,
      market_ids: marketIds,
    });
  } catch (error) {
    console.error('Error fetching watchlist:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: 'Invalid wallet address',
          details: error.errors,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch watchlist',
      },
      { status: 500 }
    );
  }
}
