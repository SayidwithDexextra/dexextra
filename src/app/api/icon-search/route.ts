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

type ImageKind = 'photo' | 'logo' | 'icon' | 'illustration';

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

    // Infer a concise intent + preferred image kind.
    // "photo" -> bias toward Unsplash; "logo/icon" -> bias toward logo/icon assets.
    const plan = await inferImageSearchPlan({ name: query, description });
    const intent = plan.intent || query;
    const kind: ImageKind = plan.kind || 'photo';

    const primaryQuery =
      kind === 'photo' ? buildUnsplashSearchQuery(intent) : buildLogoIconSearchQuery(intent);

    const fetchSerp = async (q: string, engine: string) => {
      const url = new URL('https://serpapi.com/search');
      url.searchParams.set('engine', engine);
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
        kind,
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

    let results: IconSearchResult[] = [];
    let usedFallback = false;
    let usedEngine = 'google_images';
    let usedQueryLabel: 'primary' | 'fallback' | 'backup_engine' = 'primary';

    // Attempt 1: primary query on Google Images.
    const primary = await fetchSerp(primaryQuery, 'google_images');
    if (!primary.ok) {
      return NextResponse.json({ error: 'Image search failed' }, { status: 502 });
    }
    results = parse(primary.data);

    // Attempt 2: fallback query on Google Images (switch intent style).
    if (results.length === 0) {
      const fallbackQuery =
        kind === 'photo'
          ? buildGenericPhotoSearchQuery(intent)
          : buildGenericSearchQuery(intent);
      const fallback = await fetchSerp(fallbackQuery, 'google_images');
      if (fallback.ok) {
        const fallbackResults = parse(fallback.data);
        if (fallbackResults.length > 0) {
          results = fallbackResults;
          usedFallback = true;
          usedQueryLabel = 'fallback';
        }
      }
    }

    // Attempt 3: backup SerpApi engine if Google Images yields nothing.
    // This covers cases where Google is sparse or blocked for certain terms.
    if (results.length === 0) {
      const backupQuery =
        kind === 'photo'
          ? buildGenericPhotoSearchQuery(intent)
          : buildGenericSearchQuery(intent);
      const backup = await fetchSerp(backupQuery, 'bing_images');
      if (backup.ok) {
        const backupResults = parse(backup.data);
        if (backupResults.length > 0) {
          results = backupResults;
          usedFallback = true;
          usedEngine = 'bing_images';
          usedQueryLabel = 'backup_engine';
        }
      }
    }

    console.log('[icon-search] Response:', {
      result_count: results.length,
      used_fallback: usedFallback,
      used_engine: usedEngine,
      used_query_label: usedQueryLabel,
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

function buildLogoIconSearchQuery(intent: string): string {
  const base = String(intent || '').trim().replace(/\s+/g, ' ');
  if (!base) return 'logo icon';
  const cleaned = base
    .replace(/\bsite:unsplash\.com\b/gi, '')
    .replace(/\bunsplash\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Bias toward icon assets and common deliverables.
  const wantsTransparent = /\btransparent\b/i.test(cleaned);
  const suffix = [
    'logo',
    'icon',
    wantsTransparent ? '' : 'transparent',
    'svg',
    'png',
  ]
    .filter(Boolean)
    .join(' ');
  return `${cleaned} ${suffix}`.trim();
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

function buildGenericPhotoSearchQuery(intent: string): string {
  const base = String(intent || '').trim().replace(/\s+/g, ' ');
  const cleaned = base
    .replace(/\bsite:unsplash\.com\b/gi, '')
    .replace(/\bunsplash\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'photo';
  // Keep it broad; we just want *some* visual candidates when Unsplash bias fails.
  const hasPhoto = /\bphoto\b/i.test(cleaned);
  const hasImage = /\bimage\b/i.test(cleaned);
  const suffix = `${hasPhoto ? '' : ' photo'}${hasImage ? '' : ' image'}`.trim();
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
  kind: z.enum(['photo', 'logo', 'icon', 'illustration']).optional().default('photo'),
});

const INTENT_TTL_MS = 24 * 60 * 60 * 1000;

const planCache = new Map<string, { plan: { intent: string; kind: ImageKind }; ts: number }>();

async function inferImageSearchPlan(params: {
  name: string;
  description?: string;
}): Promise<{ intent: string; kind: ImageKind }> {
  const name = String(params.name || '').trim();
  const description = String(params.description || '').trim();
  const cacheKey = `${name}\n---\n${description}`.slice(0, 1200);

  const cached = planCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < INTENT_TTL_MS) return cached.plan;

  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_ICON_SEARCH_MODEL || process.env.OPENAI_MODEL || 'gpt-4o-mini';

  // Fallback: deterministic heuristic when OpenAI isn't configured.
  if (!apiKey) {
    const fallback = heuristicPlanFromText([name, description].filter(Boolean).join(' '));
    planCache.set(cacheKey, { plan: fallback, ts: Date.now() });
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
          content: `You turn verbose market/metric text into an image-search plan.

Return JSON only: {"intent": string, "kind": "photo"|"logo"|"icon"|"illustration"}

Rules:
- intent is 1-4 words (max 40 chars preferred), all-lowercase.
- Capture the real-world visual subject (thing/place/commodity/person/object).
- Remove finance/contract jargon: futures, front-month, settlement, daily, price, index, c, contract, report, ICE, NYMEX, CME, etc.
- Remove source/site names: investing.com, fred, coingecko, etc.
- Do NOT include dates, tickers, units, or timeframes.
- kind guidance:
  - "photo": commodity, food, place, weather, person, physical object, general concept that can be photographed.
  - "logo" or "icon": branded assets (companies, crypto tokens), apps, protocols, exchanges, products where a logo is the best representation.
  - "illustration": highly abstract concepts where a photo is likely irrelevant (use sparingly).

Example:
Name: "Front-Month Arabica Coffee C Futures Daily Settlement"
Description: "A market tracking ... (ICE) ..."
=> {"intent":"arabica coffee","kind":"photo"}`,
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

    const plan = {
      intent: parsed.data.intent.toLowerCase(),
      kind: parsed.data.kind,
    };
    planCache.set(cacheKey, { plan, ts: Date.now() });
    return plan;
  } catch (e) {
    const fallback = heuristicPlanFromText([name, description].filter(Boolean).join(' '));
    planCache.set(cacheKey, { plan: fallback, ts: Date.now() });
    return fallback;
  } finally {
    // Tiny cache cleanup to prevent unbounded growth.
    if (planCache.size > 200) {
      const now = Date.now();
      for (const [k, v] of planCache.entries()) {
        if (now - v.ts > INTENT_TTL_MS) planCache.delete(k);
      }
    }
  }
}

function heuristicPlanFromText(text: string): { intent: string; kind: ImageKind } {
  const raw = String(text || '')
    .replace(/\([^)]*\)/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-zA-Z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const kind: ImageKind = (() => {
    // Strong logo/icon cues.
    if (/\b(logo|icon|brand|emblem|symbol)\b/i.test(raw)) return 'logo';

    // Crypto / token / exchange cues: logos are usually the best icon for these.
    if (/\b(crypto|token|coin|btc|eth|sol|usdt|usdc|binance|coinbase|kraken|uniswap)\b/i.test(raw)) {
      return 'logo';
    }

    // If the input looks like a ticker-only prompt, prefer a logo.
    if (/\b[a-z]{2,6}\b/.test(raw) && /\b(price|chart|spot)\b/i.test(raw)) return 'logo';

    return 'photo';
  })();

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
  if (hasArabica && hasCoffee) return { intent: 'arabica coffee', kind };

  const uniq: string[] = [];
  for (const t of tokens) {
    if (!uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 3) break;
  }
  const intent = uniq.join(' ') || raw.split(/\s+/).slice(0, 3).join(' ') || 'market';
  return { intent, kind };
}
