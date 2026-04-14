import { NextRequest, NextResponse } from 'next/server';
import { archiveMulti, type MultiArchiveResult, type ArchiveProvider } from '../../../lib/archiveMulti';

export const runtime = 'nodejs';
export const maxDuration = 60;

type ArchiveRequestBody = {
  /** URL to archive (required) */
  url: string;
  /** Specific providers to use (default: all) */
  providers?: ArchiveProvider[];
  /** Timeout per provider in ms (default: 25000) */
  providerTimeoutMs?: number;
  /** Total timeout in ms (default: 30000) */
  totalTimeoutMs?: number;
  /** Custom user agent */
  userAgent?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum age of acceptable existing archive in ms (default: 2 minutes). Set to 0 to accept any. */
  maxAgeMs?: number;
};

/**
 * UNIFIED ARCHIVE API
 * 
 * Single endpoint for all archiving needs in Dexextra.
 * Archives URLs to multiple providers (Internet Archive + Archive.today) in parallel.
 * 
 * POST /api/archive
 * 
 * Request body:
 * {
 *   "url": "https://example.com",           // Required
 *   "providers": ["internet_archive"],      // Optional, default: all
 *   "providerTimeoutMs": 25000,             // Optional
 *   "totalTimeoutMs": 30000,                // Optional
 *   "userAgent": "MyApp/1.0",               // Optional
 *   "debug": true                           // Optional
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "primaryUrl": "https://web.archive.org/web/...",
 *   "primaryProvider": "internet_archive",
 *   "archives": [
 *     { "provider": "internet_archive", "success": true, "url": "...", "durationMs": 5000 },
 *     { "provider": "archive_today", "success": true, "url": "...", "durationMs": 8000 }
 *   ],
 *   "timeToFirstSuccessMs": 5000
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ArchiveRequestBody;
    
    if (!body?.url || typeof body.url !== 'string') {
      return NextResponse.json(
        { success: false, error: 'Missing required field: url' },
        { status: 400 }
      );
    }

    const url = body.url.trim();
    if (!url) {
      return NextResponse.json(
        { success: false, error: 'URL cannot be empty' },
        { status: 400 }
      );
    }

    // Validate URL format
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return NextResponse.json(
          { success: false, error: 'Only http/https URLs are supported' },
          { status: 400 }
        );
      }
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid URL format' },
        { status: 400 }
      );
    }

    console.log(`[archive-api] Archiving: ${url}`);

    const result: MultiArchiveResult = await archiveMulti(url, {
      providers: body.providers,
      providerTimeoutMs: body.providerTimeoutMs,
      totalTimeoutMs: body.totalTimeoutMs,
      userAgent: body.userAgent || 'Dexextra/1.0',
      debug: body.debug,
      maxAgeMs: body.maxAgeMs,
    });

    if (result.success) {
      const successCount = result.archives.filter(a => a.success).length;
      console.log(`[archive-api] Success: ${successCount}/${result.archives.length} providers for ${url}`);
      console.log(`[archive-api] Primary: ${result.primaryUrl} (${result.primaryProvider})`);
    } else {
      console.warn(`[archive-api] Failed for ${url}: ${result.error}`);
    }

    return NextResponse.json(result, {
      status: result.success ? 200 : 502,
    });
  } catch (error: any) {
    console.error('[archive-api] Unexpected error:', error?.message || error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Unexpected server error' },
      { status: 500 }
    );
  }
}

/**
 * GET endpoint for simple URL archiving via query param.
 * 
 * GET /api/archive?url=https://example.com
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url');

  if (!url) {
    return NextResponse.json({
      success: false,
      error: 'Missing required query parameter: url',
      usage: {
        endpoint: '/api/archive',
        methods: ['GET', 'POST'],
        description: 'Unified archive API - archives URLs to Internet Archive + Archive.today',
        getExample: '/api/archive?url=https://example.com',
        postExample: {
          url: 'https://example.com',
          providers: ['internet_archive', 'archive_today'],
          totalTimeoutMs: 30000,
        },
        providers: ['internet_archive', 'archive_today'],
      },
    }, { status: 400 });
  }

  // Create a mock POST request
  const mockReq = new NextRequest(req.url, {
    method: 'POST',
    body: JSON.stringify({ url }),
  });

  return POST(mockReq);
}
