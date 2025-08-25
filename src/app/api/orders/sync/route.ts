import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { publicClient } from '@/lib/viemClient';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { metricId } = body as { metricId?: string };

    if (!metricId) {
      return NextResponse.json({ error: 'metricId is required' }, { status: 400 });
    }

    // Find market row
    const { data: markets, error: mErr } = await supabaseAdmin
      .from('orderbook_markets')
      .select('id')
      .eq('metric_id', metricId)
      .limit(1);

    if (mErr) return NextResponse.json({ error: 'Market lookup failed', details: mErr.message }, { status: 500 });
    if (!markets || markets.length === 0) return NextResponse.json({ error: 'Market not found' }, { status: 404 });

    const marketId = markets[0].id as string;

    // Fetch recent OrderPlaced logs for this metricId (last 1000 blocks to avoid RPC limits)
    const latestBlock = await publicClient.getBlockNumber();
    const fromBlock = latestBlock > 1000n ? latestBlock - 1000n : 0n;
    
    const logs = await publicClient.getLogs({
      address: CONTRACT_ADDRESSES.orderRouter,
      event: {
        type: 'event',
        name: 'OrderPlaced',
        inputs: [
          { indexed: true, name: 'orderId', type: 'uint256' },
          { indexed: true, name: 'trader', type: 'address' },
          { indexed: false, name: 'metricId', type: 'string' },
          { indexed: false, name: 'orderType', type: 'uint8' },
          { indexed: false, name: 'side', type: 'uint8' },
          { indexed: false, name: 'quantity', type: 'uint256' },
          { indexed: false, name: 'price', type: 'uint256' },
        ],
      } as const,
      fromBlock,
      toBlock: 'latest',
    });

    const matched = logs.filter((l: any) => l.args?.metricId === metricId);

    // Insert minimal rows if not present
    const rows = matched.map((l: any) => ({
      order_id: Number(l.args.orderId),
      market_id: marketId,
      trader_wallet_address: l.args.trader as `0x${string}`,
      order_type: 'LIMIT',
      side: (Number(l.args.side) === 0 ? 'BUY' : 'SELL') as 'BUY' | 'SELL',
      quantity: Number(l.args.quantity) / 1e18,
      price: Number(l.args.price) / 1e18,
      order_status: 'PENDING',
      time_in_force: 'GTC',
    }));

    if (rows.length === 0) {
      return NextResponse.json({ success: true, inserted: 0 });
    }

    const { error: upsertErr } = await supabaseAdmin
      .from('market_orders')
      .upsert(rows, { onConflict: 'order_id' });

    if (upsertErr) return NextResponse.json({ error: 'Upsert failed', details: upsertErr.message }, { status: 500 });

    return NextResponse.json({ success: true, inserted: rows.length });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', message: (error as Error).message }, { status: 500 });
  }
}


