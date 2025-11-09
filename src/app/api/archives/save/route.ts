import { NextRequest, NextResponse } from 'next/server';
import { archivePage } from '@/lib/archivePage';
import { env } from '@/lib/env';

type Body = {
  url?: string;
  captureOutlinks?: boolean;
  captureScreenshot?: boolean;
  skipIfRecentlyArchived?: boolean;
};

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const url = String(body?.url || '').trim();
    if (!url) {
      return NextResponse.json({ success: false, error: 'Missing url' }, { status: 400 });
    }

    // Optional Wayback Machine credentials (recommended for production). If present, attach LOW auth header.
    const access = (process.env.WAYBACK_API_ACCESS_KEY || (env as any).WAYBACK_API_ACCESS_KEY) as string | undefined;
    const secret = (process.env.WAYBACK_API_SECRET || (env as any).WAYBACK_API_SECRET) as string | undefined;
    const authHeader = access && secret ? `LOW ${access}:${secret}` : undefined;

    // Debug headers and content-location to diagnose missing wayback URLs
    console.log('[SPN] Using auth', { hasAccess: Boolean(access), hasSecret: Boolean(secret) });


    
    const res = await archivePage(url, {
      captureOutlinks: Boolean(body?.captureOutlinks),
      captureScreenshot: Boolean(body?.captureScreenshot),
      skipIfRecentlyArchived: Boolean(body?.skipIfRecentlyArchived),
      headers: {
        ...(authHeader ? { Authorization: authHeader } : {}),
        'User-Agent': `Dexextra/1.0 (+${env.APP_URL})`,
      },
      debug: true,
    });

    // Log outcome (link or error) for diagnostics
    if (res.success) {
      console.log('Wayback snapshot created:', res.waybackUrl, 'for', url, res.timestamp ? `(ts: ${res.timestamp})` : '');
    } else {
      console.warn('Wayback snapshot failed for', url, '-', res.error || 'unknown error');
    }

    const status = res.success ? 200 : 502;
    console.log('[SPN] Response status', status, 'for', url);
    return NextResponse.json(res, { status });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error?.message || 'Unexpected server error' }, { status: 500 });
  }
}


