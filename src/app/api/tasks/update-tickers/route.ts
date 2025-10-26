import { NextRequest, NextResponse } from 'next/server';

export async function GET(_req: NextRequest) {
  try {
    const projectUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!projectUrl || !anonKey) {
      return NextResponse.json({ error: 'Supabase env not configured' }, { status: 500 });
    }
    const fnUrl = projectUrl.replace('supabase.co', 'functions.supabase.co') + '/update-tickers';

    const res = await fetch(fnUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${anonKey}`,
      },
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return NextResponse.json({ error: data?.error || 'Function error' }, { status: 500 });
    }
    return NextResponse.json({ success: true, data });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message || 'Unknown error' }, { status: 500 });
  }
}


