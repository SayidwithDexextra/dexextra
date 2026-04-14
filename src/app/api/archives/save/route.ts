import { NextRequest, NextResponse } from 'next/server';
import { archiveUrl, type ArchiveResult } from '@/lib/archive';
import { env } from '@/lib/env';

type Body = {
  url?: string;
  /** Total timeout in ms (default: 30000) */
  totalTimeoutMs?: number;
  /** Enable debug logging */
  debug?: boolean;
};

/**
 * Archive API Endpoint
 * 
 * This is a thin proxy to the metric-ai-worker's unified archive API.
 * All archiving logic lives in metric-ai-worker/lib/archiveMulti.ts
 * 
 * POST /api/archives/save
 * Body: { url: string, totalTimeoutMs?: number, debug?: boolean }
 * 
 * Returns archives from Internet Archive + Archive.today in parallel.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as Body;
    const url = String(body?.url || '').trim();
    
    if (!url) {
      return NextResponse.json({ success: false, error: 'Missing url' }, { status: 400 });
    }

    console.log('[Archive] Multi-archive via metric-ai-worker for:', url);

    const res: ArchiveResult = await archiveUrl(url, {
      userAgent: `Dexextra/1.0 (+${env.APP_URL})`,
      totalTimeoutMs: body?.totalTimeoutMs ?? 30_000,
      debug: body?.debug ?? true,
    });

    if (res.success) {
      const providers = res.archives.filter(a => a.success).map(a => a.provider);
      console.log(`[Archive] Multi-archive success: ${providers.join(', ')} for`, url);
      console.log('[Archive] Primary URL:', res.primaryUrl, 'from', res.primaryProvider);
    } else {
      console.warn('[Archive] Multi-archive failed for', url, '-', res.error);
    }

    return NextResponse.json({
      success: res.success,
      primaryUrl: res.primaryUrl,
      primaryProvider: res.primaryProvider,
      archives: res.archives,
      timeToFirstSuccessMs: res.timeToFirstSuccessMs,
      error: res.error,
      // Backward compatibility
      waybackUrl: res.archives.find(a => a.provider === 'internet_archive' && a.success)?.url || res.primaryUrl,
    }, { status: res.success ? 200 : 502 });
  } catch (error: any) {
    console.error('[Archive] Error:', error?.message || error);
    return NextResponse.json({ success: false, error: error?.message || 'Unexpected server error' }, { status: 500 });
  }
}
