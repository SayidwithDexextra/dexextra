import { NextRequest, NextResponse } from 'next/server';

export interface IconSearchResult {
  title: string;
  url: string;
  thumbnail: string;
  source: string;
  domain: string;
}

interface SerpApiImageResult {
  images_results?: Array<{
    title?: string;
    original?: string;
    thumbnail?: string;
    source?: string;
    link?: string;
  }>;
}

/**
 * POST /api/icon-search
 * Search for icon images using SerpApi Google Images
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { query, maxResults = 12 } = body;

    if (!query || typeof query !== 'string') {
      return NextResponse.json(
        { error: 'Missing or invalid query parameter' },
        { status: 400 }
      );
    }

    const apiKey = process.env.SERPAPI_KEY;
    if (!apiKey) {
      console.error('[icon-search] SERPAPI_KEY not configured');
      return NextResponse.json(
        { error: 'Image search not configured' },
        { status: 500 }
      );
    }

    // Build search query optimized for icons/logos
    const searchQuery = buildIconSearchQuery(query);

    const url = new URL('https://serpapi.com/search');
    url.searchParams.set('engine', 'google_images');
    url.searchParams.set('q', searchQuery);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('num', String(Math.min(maxResults, 20)));
    url.searchParams.set('safe', 'active');
    // Prefer transparent/logo-style images
    url.searchParams.set('tbs', 'ic:trans,isz:m'); // Transparent, medium size

    // Log request (without API key)
    const sanitizedUrl = new URL(url.toString());
    sanitizedUrl.searchParams.delete('api_key');
    console.log('[icon-search] Request:', {
      url: sanitizedUrl.toString(),
      query_preview: searchQuery.slice(0, 120),
    });

    const response = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'Unknown error');
      console.error('[icon-search] SerpApi error:', response.status, errorText);
      return NextResponse.json(
        { error: 'Image search failed' },
        { status: 502 }
      );
    }

    const data: SerpApiImageResult = await response.json();

    const results: IconSearchResult[] = (data.images_results || [])
      .slice(0, maxResults)
      .map((img) => ({
        title: img.title || '',
        url: img.original || '',
        thumbnail: img.thumbnail || img.original || '',
        source: img.source || '',
        domain: extractDomain(img.link || img.original || ''),
      }))
      .filter((r) => r.url && r.thumbnail);

    console.log('[icon-search] Response:', {
      result_count: results.length,
      sample: results.slice(0, 3).map((r) => ({
        title: r.title.slice(0, 60),
        domain: r.domain,
      })),
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('[icon-search] Error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

function buildIconSearchQuery(query: string): string {
  const base = query.trim();
  // Add modifiers to find logo/icon-style images
  return `${base} logo icon transparent`;
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
