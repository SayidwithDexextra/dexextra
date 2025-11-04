import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url');
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Missing url parameter' }, { status: 400 });
    }

    const res = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      headers: {
        'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const contentType = res.headers.get('content-type') || '';
    const html = await res.text();

    const response = NextResponse.json({
      ok: true,
      url,
      contentType,
      html,
      fetched_at: new Date().toISOString()
    });
    response.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    response.headers.set('Pragma', 'no-cache');
    response.headers.set('Expires', '0');
    return response;
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to fetch HTML' }, { status: 500 });
  }
}


