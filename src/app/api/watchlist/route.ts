import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { supabaseAdmin } from '@/lib/supabase-admin';

const WatchlistWalletSchema = z.object({
  wallet_address: z.string()
    .regex(/^0x[a-fA-F0-9]{40}$/, 'Invalid wallet address format')
    .transform(addr => addr.toLowerCase()),
});

const WatchlistMarketItemSchema = WatchlistWalletSchema.extend({
  market_id: z.string().uuid('Invalid market id'),
  metric_id: z.string().min(1, 'Metric id is required').optional(),
});

const WatchlistUserItemSchema = WatchlistWalletSchema.extend({
  watched_user_id: z.string().uuid('Invalid watched user id'),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const isUserItem = typeof body?.watched_user_id === 'string';
    const isMarketItem = typeof body?.market_id === 'string';

    if (!isUserItem && !isMarketItem) {
      return NextResponse.json(
        { success: false, error: 'Must provide market_id or watched_user_id' },
        { status: 400 }
      );
    }

    const parsed = isUserItem ? WatchlistUserItemSchema.parse(body) : WatchlistMarketItemSchema.parse(body);
    const wallet_address = parsed.wallet_address;

    // Resolve watcher profile (best-effort)
    const { data: watcherProfile } = await supabaseAdmin
      .from('user_profiles')
      .select('id')
      .eq('wallet_address', wallet_address)
      .maybeSingle();

    if (isUserItem) {
      const watched_user_id = (parsed as any).watched_user_id as string;

      // Prevent watching yourself (if profile exists)
      if (watcherProfile?.id && watcherProfile.id === watched_user_id) {
        return NextResponse.json({ success: true, status: 'exists' });
      }

      const { data: existing, error: existingError } = await supabaseAdmin
        .from('user_watchlists')
        .select('id')
        .eq('wallet_address', wallet_address)
        .eq('item_type', 'user')
        .eq('watched_user_id', watched_user_id)
        .maybeSingle();

      if (existingError && existingError.code !== 'PGRST116') throw existingError;

      if (existing) {
        return NextResponse.json({ success: true, status: 'exists' });
      }

      const { error: insertError } = await supabaseAdmin.from('user_watchlists').insert({
        wallet_address,
        user_id: watcherProfile?.id || null,
        item_type: 'user',
        watched_user_id,
        market_id: null,
        metric_id: null,
      });

      if (insertError) throw insertError;

      return NextResponse.json({ success: true, status: 'added' });
    }

    // Market item
    const { market_id, metric_id } = parsed as any as z.infer<typeof WatchlistMarketItemSchema>;

    const { data: existing, error: existingError } = await supabaseAdmin
      .from('user_watchlists')
      .select('id')
      .eq('wallet_address', wallet_address)
      .eq('item_type', 'market')
      .eq('market_id', market_id)
      .maybeSingle();

    if (existingError && existingError.code !== 'PGRST116') throw existingError;

    if (existing) {
      return NextResponse.json({ success: true, status: 'exists' });
    }

    const { error: insertError } = await supabaseAdmin.from('user_watchlists').insert({
      wallet_address,
      metric_id: metric_id || null,
      market_id,
      user_id: watcherProfile?.id || null,
      item_type: 'market',
      watched_user_id: null,
    });

    if (insertError) throw insertError;

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
    const isUserItem = typeof body?.watched_user_id === 'string';
    const isMarketItem = typeof body?.market_id === 'string';

    if (!isUserItem && !isMarketItem) {
      return NextResponse.json(
        { success: false, error: 'Must provide market_id or watched_user_id' },
        { status: 400 }
      );
    }

    const parsed = isUserItem
      ? WatchlistUserItemSchema.parse(body)
      : WatchlistMarketItemSchema.pick({ wallet_address: true, market_id: true }).parse(body);
    const wallet_address = parsed.wallet_address;

    const deleteQuery = isUserItem
      ? supabaseAdmin
          .from('user_watchlists')
          .delete()
          .eq('wallet_address', wallet_address)
          .eq('item_type', 'user')
          .eq('watched_user_id', (parsed as any).watched_user_id)
      : supabaseAdmin
          .from('user_watchlists')
          .delete()
          .eq('wallet_address', wallet_address)
          .eq('item_type', 'market')
          .eq('market_id', (parsed as any).market_id);

    const { error: deleteError } = await deleteQuery;

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

    const { wallet_address } = WatchlistWalletSchema.parse({
      wallet_address: wallet,
    });

    const { data: rows, error } = await supabaseAdmin
      .from('user_watchlists')
      .select(
        [
          'item_type',
          'market_id',
          'watched_user_id',
          // Include user profile details for UI rendering (best-effort)
          'watched_user:user_profiles!user_watchlists_watched_user_id_fkey(id,wallet_address,username,display_name,profile_image_url)',
        ].join(',')
      )
      .eq('wallet_address', wallet_address)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const marketIds = (rows || [])
      .filter((row: any) => row.item_type === 'market')
      .map((row: any) => row.market_id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

    const watchedUserIds = (rows || [])
      .filter((row: any) => row.item_type === 'user')
      .map((row: any) => row.watched_user_id)
      .filter((id: any): id is string => typeof id === 'string' && id.length > 0);

    const watchedUsers = (rows || [])
      .filter((row: any) => row.item_type === 'user')
      .map((row: any) => row.watched_user)
      .filter((u: any) => u && typeof u.id === 'string');

    // Fetch full market + ticker data for watchlisted market IDs
    let watchedMarkets: any[] = [];
    if (marketIds.length > 0) {
      const [marketsResult, tickersResult] = await Promise.all([
        supabaseAdmin
          .from('markets')
          .select(
            'id, market_identifier, symbol, name, category, icon_image_url, banner_image_url, market_address, chain_id, network, tick_size, decimals, is_active, market_status, total_volume, total_trades'
          )
          .in('id', marketIds),
        supabaseAdmin
          .from('market_tickers')
          .select('market_id, mark_price, last_update, is_stale')
          .in('market_id', marketIds),
      ]);

      if (!marketsResult.error && marketsResult.data) {
        const tickerMap = new Map<string, any>();
        if (!tickersResult.error && tickersResult.data) {
          for (const t of tickersResult.data) {
            tickerMap.set(t.market_id, t);
          }
        }

        // Preserve the watchlist ordering (most recently added first)
        const marketMap = new Map<string, any>();
        for (const m of marketsResult.data) {
          const ticker = tickerMap.get(m.id);
          marketMap.set(m.id, {
            market_id: m.id,
            market_identifier: m.market_identifier,
            symbol: m.symbol,
            name: m.name,
            category: m.category,
            icon_image_url: m.icon_image_url,
            banner_image_url: m.banner_image_url,
            market_address: m.market_address,
            chain_id: m.chain_id,
            network: m.network,
            tick_size: m.tick_size,
            decimals: m.decimals,
            is_active: m.is_active,
            market_status: m.market_status,
            total_volume: m.total_volume,
            total_trades: m.total_trades,
            mark_price: ticker?.mark_price ?? null,
            last_update: ticker?.last_update ?? null,
            is_stale: ticker?.is_stale ?? null,
          });
        }
        watchedMarkets = marketIds
          .map((id) => marketMap.get(id))
          .filter(Boolean);
      }
    }

    return NextResponse.json({
      success: true,
      market_ids: marketIds,
      watched_markets: watchedMarkets,
      watched_user_ids: watchedUserIds,
      watched_users: watchedUsers,
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
