import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const url = searchParams.get('url');
    const delayMs = Math.max(0, Number(searchParams.get('delayMs') || '0'));
    const retries = Math.max(0, Number(searchParams.get('retries') || '0'));
    const retryDelayMs = Math.max(0, Number(searchParams.get('retryDelayMs') || '1000'));
    if (!url) {
      return NextResponse.json({ ok: false, error: 'Missing url parameter' }, { status: 400 });
    }
    const targetUrl = url as string;

    if (delayMs > 0) {
      await new Promise((r) => setTimeout(r, delayMs));
    }

    async function fetchOnce() {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(targetUrl, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.9',
            'Cache-Control': 'no-cache'
          },
          redirect: 'follow',
          cache: 'no-store',
          signal: controller.signal
        });
        return res;
      } finally {
        clearTimeout(timeout);
      }
    }

    let res = await fetchOnce();
    let attempt = 0;
    while (!res.ok && attempt < retries) {
      attempt += 1;
      if (retryDelayMs > 0) await new Promise((r) => setTimeout(r, retryDelayMs));
      res = await fetchOnce();
    }

    if (!res.ok) {
      try {
        console.log('[metric-source/fetch-html] upstream error', { status: res.status, redirected: res.redirected });
      } catch {}
      return NextResponse.json({ ok: false, error: `Upstream responded ${res.status}`, status: res.status, redirected: res.redirected }, { status: 502 });
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) {
      // Still try to parse; some sites mislabel. But mark type for debugging.
      // Fall-through: read as text regardless.
    }

    const html = await res.text();

    try {
      // Log the entire raw upstream HTML (can be large)
      // console.log('[metric-source/fetch-html] Raw upstream HTML:', html);
    } catch {}

    return NextResponse.json({
      ok: true,
      status: res.status,
      redirected: res.redirected,
      final_url: (res as any).url || url,
      content_type: contentType,
      html_length: typeof html === 'string' ? html.length : null,
      html,
      fetched_at: new Date().toISOString()
    }, { status: 200 });
  } catch (e: any) {
    const message = e?.name === 'AbortError' ? 'Request timed out' : (e?.message || 'Failed to fetch HTML');
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

 
