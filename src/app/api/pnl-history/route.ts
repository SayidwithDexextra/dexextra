import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseDataPipeline } from '@/lib/clickhouse-client';

export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const wallet = searchParams.get('wallet');
  const startDate = searchParams.get('startDate') || undefined;
  const endDate = searchParams.get('endDate') || undefined;
  const limit = parseInt(searchParams.get('limit') || '365', 10);

  if (!wallet) {
    return NextResponse.json(
      { error: 'wallet parameter is required' },
      { status: 400 }
    );
  }

  try {
    const clickhouse = getClickHouseDataPipeline();
    const history = await clickhouse.getUserPnlHistory(wallet, startDate, endDate, limit);

    return NextResponse.json({
      wallet: wallet.toLowerCase(),
      startDate,
      endDate,
      count: history.length,
      data: history,
    });
  } catch (error: any) {
    console.error('[pnl-history] Error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch P&L history', details: error?.message },
      { status: 500 }
    );
  }
}
