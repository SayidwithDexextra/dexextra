import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Read-only endpoint for homepage market overview with latest mark prices
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  // Use service role for reliable server-side access; RLS still enforced on views
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);

    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
      const status = searchParams.get('status');
    const category = searchParams.get('category');
    const search = searchParams.get('search');

    let query = supabase
      .from('market_overview')
      .select('*', { count: 'exact' })
      .order('symbol', { ascending: true });

      // Support multiple statuses via comma-separated list, e.g. status=ACTIVE,SETTLEMENT_REQUESTED
      if (status) {
        const statuses = status.split(',').map(s => s.trim()).filter(Boolean);
        if (statuses.length > 1) {
          query = query.in('market_status', statuses);
        } else if (statuses.length === 1) {
          query = query.eq('market_status', statuses[0]);
        }
      }
    if (category) query = query.contains('category', [category]);
    if (search) {
      query = query.or(
        `market_identifier.ilike.%${search}%,symbol.ilike.%${search}%,name.ilike.%${search}%`
      );
    }

    query = query.range(offset, offset + limit - 1);

    const { data, error, count } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      markets: data || [],
      pagination: {
        limit,
        offset,
        total: count || data?.length || 0
      }
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Unknown error' }, { status: 500 });
  }
}


