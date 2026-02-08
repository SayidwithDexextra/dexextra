import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';

export interface IconSearchResult {
  title: string;
  url: string;
  thumbnail: string;
  source: string;
  domain: string;
}

export const runtime = 'nodejs';
export const maxDuration = 30;

interface SerpApiImageResult {
  images_results?: Array<{
    title?: string;
    original?: string;
    thumbnail?: string;
    source?: string;
    link?: string;
  }>;
}

const BodySchema = z.object({
  query: z.string().min(1).max(500),
  description: z.string().max(3000).optional(),
  maxResults: z.number().int().min(1).max(20).optional().default(12),
});

/**
 * POST /api/icon-search
 * Search for market images using SerpApi Google Images.
 *
 * We infer user intent (short concept keywords) with AI, then suffix with "unsplash"
 * to strongly bias results toward Unsplash photos from Google Images.
 */
export async function POST(request: NextRequest) {
  try {
    const body = BodySchema.safeParse(await request.json());
    if (!body.success) {
      return NextResponse.json(
        { error: 'Missing or invalid request body', details: body.error.flatten() },
        { status: 400 }
      );
    }

    const { query, description, maxResults } = body.data;

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

    // Infer a concise "intent" phrase, then target Unsplash results via Google Images.
    const intent = await inferImageSearchIntent({ name: query, description });
    const primaryQuery = buildUnsplashSearchQuery(intent || query);

    const fetchSerp = async (q: string) => {
      const url = new URL('https://serpapi.com/search');
      url.searchParams.set('engine', 'google_images');
      url.searchParams.set('q', q);
      url.searchParams.set('api_key', apiKey);
      url.searchParams.set('num', String(Math.min(maxResults, 20)));
      url.searchParams.set('safe', 'active');
      // Prefer medium-ish images; we crop client-side.
      url.searchParams.set('tbs', 'isz:m');

      // Log request (without API key)
      const sanitizedUrl = new URL(url.toString());
      sanitizedUrl.searchParams.delete('api_key');
      console.log('[icon-search] Request:', {
        url: sanitizedUrl.toString(),
        input_preview: query.slice(0, 120),
        intent,
        query_preview: q.slice(0, 160),
      });

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        console.error('[icon-search] SerpApi error:', response.status, errorText);
        return { ok: false as const, status: response.status, data: null as any };
      }

      const data: SerpApiImageResult = await response.json();
      return { ok: true as const, status: 200, data };
    };

    const parse = (data: SerpApiImageResult): IconSearchResult[] =>
      (data.images_results || [])
      .slice(0, maxResults)
      .map((img) => ({
        title: img.title || '',
        url: img.original || '',
        thumbnail: img.thumbnail || img.original || '',
        source: img.source || '',
        domain: extractDomain(img.link || img.original || ''),
      }))
      .filter((r) => r.url && r.thumbnail);

    const primary = await fetchSerp(primaryQuery);
    if (!primary.ok) {
      return NextResponse.json({ error: 'Image search failed' }, { status: 502 });
    }

    let results: IconSearchResult[] = parse(primary.data);
    let usedFallback = false;

    // Fallback: if Unsplash-biased search yields nothing (common for crypto logos),
    // retry with a more general "logo/icon" query.
    if (results.length === 0) {
      const fallbackQuery = buildGenericSearchQuery(intent || query);
      const fallback = await fetchSerp(fallbackQuery);
      if (fallback.ok) {
        const fallbackResults = parse(fallback.data);
        if (fallbackResults.length > 0) {
          results = fallbackResults;
          usedFallback = true;
        }
      }
    }

    console.log('[icon-search] Response:', {
      result_count: results.length,
      used_fallback: usedFallback,
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

function buildUnsplashSearchQuery(intent: string): string {
  const base = String(intent || '').trim().replace(/\s+/g, ' ');
  // Keep "unsplash" as a suffix per product requirement.
  // Include site hint to bias toward Unsplash-hosted images without losing the suffix.
  const siteHint = 'site:unsplash.com';
  if (!base) return `${siteHint} unsplash`;
  const alreadyHasUnsplash = /\bunsplash\b/i.test(base);
  const alreadyHasSite = /\bsite:unsplash\.com\b/i.test(base);

  const parts: string[] = [];
  if (!alreadyHasSite) parts.push(siteHint);
  parts.push(base);
  if (!alreadyHasUnsplash) parts.push('unsplash');
  else if (!/\bunsplash\b/i.test(parts[parts.length - 1] || '')) parts.push('unsplash');
  return parts.join(' ').trim();
}

function buildGenericSearchQuery(intent: string): string {
  const base = String(intent || '').trim().replace(/\s+/g, ' ');
  const cleaned = base
    .replace(/\bsite:unsplash\.com\b/gi, '')
    .replace(/\bunsplash\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'logo icon';
  // Bias toward icon-like imagery without requiring Unsplash.
  const hasLogo = /\blogo\b/i.test(cleaned);
  const hasIcon = /\bicon\b/i.test(cleaned);
  const suffix = `${hasLogo ? '' : ' logo'}${hasIcon ? '' : ' icon'}`.trim();
  return `${cleaned} ${suffix}`.trim();
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

const IntentOutputSchema = z.object({
  intent: z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length > 0 && s.length <= 80, 'intent must be 1..80 chars'),
});

const intentCache = new Map<string, { intent: string; ts: number }>();
const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

async function inferImageSearchIntent(params: { name: string; description?: string }): Promise<string> {
  const name = String(params.name || '').trim();
  const description = String(params.description || '').trim();
  const cacheKey = `${name}\n---\n${description}`.slice(0, 1200);

  const cached = intentCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < INTENT_TTL_MS) return cached.intent;

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_ICON_SEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Fallback: deterministic heuristic when OpenAI isn't configured.
  if (!apiKey) {
    const fallback = heuristicIntentFromText([name, description].filter(Boolean).join(' '));
    intentCache.set(cacheKey, { intent: fallback, ts: Date.now() });
    return fallback;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const completion = await openai.chat.completions.create({
      model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `You turn verbose market/metric text into a short photo-search intent for Unsplash.

Return JSON only: {"intent": string}

Rules:
- intent is 1-4 words (max 40 chars preferred), all-lowercase.
- Capture the real-world visual subject (thing/place/commodity/person/object).
- Remove finance/contract jargon: futures, front-month, settlement, daily, price, index, c, contract, report, ICE, NYMEX, CME, etc.
- Remove source/site names: investing.com, fred, coingecko, etc.
- Do NOT include dates, tickers, units, or timeframes.

Example:
Name: "Front-Month Arabica Coffee C Futures Daily Settlement"
Description: "A market tracking ... (ICE) ..."
=> {"intent":"arabica coffee"}`,
        },
        {
          role: 'user',
          content: `Name: ${name || '(missing)'}\nDescription: ${description || '(missing)'}`,
        },
      ],
      max_tokens: 80,
    });

    const raw = completion.choices?.[0]?.message?.content || '';
    const parsed = IntentOutputSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) throw new Error('Invalid intent JSON');

    const intent = parsed.data.intent.toLowerCase();
    intentCache.set(cacheKey, { intent, ts: Date.now() });
    return intent;
  } catch (e) {
    const fallback = heuristicIntentFromText([name, description].filter(Boolean).join(' '));
    intentCache.set(cacheKey, { intent: fallback, ts: Date.now() });
    return fallback;
  } finally {
    // Tiny cache cleanup to prevent unbounded growth.
    if (intentCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of intentCache.entries()) {
        if (now - v.ts > INTENT_TTL_MS) intentCache.delete(k);
      }
    }
  }
}

function heuristicIntentFromText(text: string): string {
  const raw = String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const STOP = new Set([
    'front',
    'month',
    'front-month',
    'futures',
    'future',
    'contract',
    'contracts',
    'daily',
    'weekly',
    'monthly',
    'annual',
    'settlement',
    'settle',
    'price',
    'index',
    'rate',
    'reported',
    'report',
    'tracking',
    'market',
    'measurement',
    'using',
    'via',
    'ice',
    'cme',
    'nymex',
    'investing',
    'investingcom',
    'com',
    'api',
    'data',
    'series',
    'usd',
    'eur',
    'gbp',
    'jpy',
    'cad',
  ]);

  const tokens = raw
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 3)
    .filter((t) => !STOP.has(t))
    .filter((t) => !/^\d+$/.test(t));

  // Special-case common pairings to keep meaning.
  const hasArabica = tokens.includes('arabica');
  const hasCoffee = tokens.includes('coffee');
  if (hasArabica && hasCoffee) return 'arabica coffee';

  const uniq: string[] = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 3) break;
  }
  return uniq.join(' ') || raw.split(/\s+/).slice(0, 3).join(' ') || 'market';
}
