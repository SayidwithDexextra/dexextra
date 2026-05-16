import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { uploadScreenshot, UploadResult } from '../../../lib/uploadScreenshot';
import { VisionAnalysisResult } from '../../../lib/visionAnalysis';
import { analyzeWithConsensus, VisionConsensus } from '../../../lib/multiModelVision';
import { getHistoricalContext, formatHistoricalContextForPrompt, HistoricalStats } from '../../../lib/historicalContext';
import { validateExtractedValue, buildSecondOpinionPrompt, alignHistoricalStatsToExtracted } from '../../../lib/valueValidator';
import { discoverLocators, fastExtract, AiSourceLocatorData, DiscoveredSelector } from '../../../lib/autoLocatorDiscovery';
import { fetchWithJina, screenshotWithJina } from '../../../lib/jinaReader';

export const runtime = 'nodejs';
export const maxDuration = 120;

// ═══════════════════════════════════════════════════════════════════════════
// PIPELINE LOGGING - Structured trace logs for debugging extraction flow
// ═══════════════════════════════════════════════════════════════════════════
const PIPELINE_PREFIX = '🔬 [PIPELINE]';
const pipelineLog = (phase: string, data: Record<string, unknown>) => {
  const ts = new Date().toISOString();
  console.log(`${PIPELINE_PREFIX} [${ts}] ${phase}`, JSON.stringify(data, null, 2));
};

const InputSchema = z.object({
  metric: z.string().min(1).max(500),
  description: z.string().optional(),
  urls: z.array(z.string().url()).min(1).max(10),
  related_market_id: z.string().optional(),
  related_market_identifier: z.string().optional(),
  user_address: z.string().optional(),
  context: z.enum(['create', 'settlement']).optional(),
  callbackUrl: z.string().url().optional(),
  callbackSecret: z.string().optional(),
  callbackMeta: z.record(z.unknown()).optional(),
});

const MAX_RAW_HTML_CHARS = Number(process.env.METRIC_AI_MAX_RAW_HTML_CHARS || 250_000);
const MAX_SOURCE_DIGEST_CHARS = Number(process.env.METRIC_AI_MAX_SOURCE_DIGEST_CHARS || 9_000);
const MAX_SOURCES_JOIN_CHARS = Number(process.env.METRIC_AI_MAX_SOURCES_JOIN_CHARS || 30_000);
const MAX_KEY_LINES = Number(process.env.METRIC_AI_MAX_KEY_LINES || 60);
const MAX_CHART_SNIPPETS = Number(process.env.METRIC_AI_MAX_CHART_SNIPPETS || 8);
const MAX_NUMERIC_CANDIDATES = Number(process.env.METRIC_AI_MAX_NUMERIC_CANDIDATES || 30);

// Screenshot and vision analysis feature flag
const ENABLE_VISION_ANALYSIS = process.env.ENABLE_VISION_ANALYSIS !== 'false';

// Tiered OpenAI models for Phase 3 fusion
const OPENAI_MODEL_FULL = process.env.OPENAI_MODEL || 'gpt-4.1';
const OPENAI_MODEL_FAST = process.env.OPENAI_MODEL_FAST || 'gpt-4.1-mini';

// Vision short-circuit threshold: skip OpenAI when consensus is this strong
const VISION_SHORTCIRCUIT_CONFIDENCE = Number(process.env.VISION_SHORTCIRCUIT_CONFIDENCE || 0.7);

// Type for tracking screenshot and vision data per URL
interface ScreenshotResult {
  success: boolean;
  base64?: string;
  error?: string;
  captureTimeMs?: number;
  renderedText?: string;
  locatorExtractedValue?: string;
  locatorMethod?: string;
}

interface SourceScreenshotData {
  url: string;
  screenshotResult?: ScreenshotResult;
  uploadResult?: UploadResult;
  visionResult?: VisionAnalysisResult;
  visionConsensus?: VisionConsensus;
}

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) throw new Error('Supabase env missing');
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

function safeText(s: unknown) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

/** Best-effort numeric from vision outputs to align historical stats (micro vs decimal) before fusion. */
function pickVisionNumericHint(map: Map<string, SourceScreenshotData>): number | null {
  let bestN: number | null = null;
  let bestC = -1;
  const consider = (raw: unknown, conf: number) => {
    const x =
      typeof raw === 'number'
        ? raw
        : Number(String(raw ?? '').replace(/,/g, '').replace(/[^0-9.+-eE]/g, ''));
    if (!Number.isFinite(x) || x <= 0) return;
    const c = Number.isFinite(conf) ? conf : 0;
    if (c > bestC) {
      bestC = c;
      bestN = x;
    }
  };
  for (const d of map.values()) {
    if (d.visionConsensus?.numericValue != null) {
      consider(d.visionConsensus.numericValue, d.visionConsensus.confidence ?? 0);
    }
    if (d.visionResult?.numericValue != null) {
      consider(d.visionResult.numericValue, Number(d.visionResult.confidence) || 0);
    }
  }
  return bestN;
}

function decodeBasicEntities(input: string) {
  return input
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripTagsToLines(html: string) {
  // Keep line breaks so we can select "price-looking" lines instead of one giant blob.
  const withBreaks = html
    .replace(/<script[\s\S]*?<\/script>/gi, '\n')
    .replace(/<style[\s\S]*?<\/style>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h1|h2|h3|h4|h5|h6|section|article|header|footer|br)\s*>/gi, '\n')
    .replace(/<(br|hr)\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');

  return decodeBasicEntities(withBreaks)
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function collectKeyLines(text: string, extraKeywords: string[]) {
  const base = [
    'price',
    'last',
    'close',
    'closing',
    'settle',
    'settlement',
    'open',
    'high',
    'low',
    'quote',
    'bid',
    'ask',
    'index',
    'spot',
    'usd',
    'eur',
    'gbp',
    'btc',
    'eth',
    'per ',
    '$',
  ];
  const kw = [...base, ...extraKeywords].map(k => k.toLowerCase());
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);

  const picked: string[] = [];
  for (const line of lines) {
    const low = line.toLowerCase();
    const hasKw = kw.some(k => (k === '$' ? low.includes('$') : low.includes(k)));
    const hasNumber = /[-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?/.test(line);
    if (hasKw && hasNumber) picked.push(line);
    if (picked.length >= MAX_KEY_LINES) break;
  }

  // If we found nothing, fall back to the first few dense numeric lines.
  if (picked.length === 0) {
    for (const line of lines) {
      if ((line.match(/\d/g) || []).length >= 6) picked.push(line);
      if (picked.length >= Math.min(20, MAX_KEY_LINES)) break;
    }
  }

  return picked;
}

function normalizeNumberString(raw: string) {
  const s = safeText(raw);
  // Keep leading sign, remove thousand separators/spaces.
  return s.replace(/,/g, '').replace(/\s+/g, '');
}

function uniqBy<T>(items: T[], key: (t: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function extractNumericCandidates(rawHtml: string) {
  // Goal: surface "quote-like" numeric values even when page is mostly JS-rendered.
  // We do NOT execute JS; we only pattern-match common payloads.
  const html = rawHtml;
  const out: Array<{ label: string; value: string; context: string }> = [];

  // A) Common JSON keys in inline state blobs / scripts.
  // Examples: "last": 123.45, "price":"123.45", "regularMarketPrice":{ "raw": 123.45 }
  const jsonKeyRe =
    /["'](last|price|close|settle(?:ment)?|regularMarketPrice|currentPrice|markPrice|indexPrice|spotPrice|value|latest|lastPrice)["']\s*:\s*(\{[^{}]{0,300}\}|"[^"]{1,40}"|'[^']{1,40}'|[-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/gi;
  let jm: RegExpExecArray | null;
  while ((jm = jsonKeyRe.exec(html))) {
    const label = jm[1];
    const rhs = (jm[2] || '').trim();
    let value = '';
    // Pull a number out of object/string/number RHS.
    const num =
      rhs.match(/[-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?/)?.[0] ||
      rhs.match(/"raw"\s*:\s*([-+]?\d+(?:\.\d+)?)/i)?.[1] ||
      rhs.match(/'raw'\s*:\s*([-+]?\d+(?:\.\d+)?)/i)?.[1] ||
      '';
    if (num) value = normalizeNumberString(num);
    if (value) out.push({ label, value, context: 'inline_json_key' });
    if (out.length >= MAX_NUMERIC_CANDIDATES) break;
  }

  // B) Human-visible label patterns in raw HTML/text.
  const textish = stripTagsToLines(html);
  const labelPatterns: Array<{ label: string; re: RegExp }> = [
    { label: 'last', re: /\b(last|last price)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
    { label: 'price', re: /\b(price)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
    { label: 'close', re: /\b(close|closing)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
    { label: 'settle', re: /\b(settle|settlement)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
    { label: 'bid', re: /\b(bid)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
    { label: 'ask', re: /\b(ask)\b[^0-9-+]{0,20}([-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?)/i },
  ];

  for (const line of textish.split('\n').map(l => l.trim()).filter(Boolean)) {
    for (const p of labelPatterns) {
      const m = line.match(p.re);
      if (m?.[2]) {
        const value = normalizeNumberString(m[2]);
        if (value) out.push({ label: p.label, value, context: `text_line:${line.slice(0, 180)}` });
      }
    }
    if (out.length >= MAX_NUMERIC_CANDIDATES) break;
  }

  // C) Meta tags occasionally contain a quote/price in content.
  // (We keep this generic and low-trust; model will decide.)
  const metaRe =
    /<meta[^>]+(?:name|property)=["']([^"']{1,80})["'][^>]+content=["']([^"']{1,200})["'][^>]*>/gi;
  let mm: RegExpExecArray | null;
  while ((mm = metaRe.exec(html))) {
    const key = (mm[1] || '').toLowerCase();
    if (!/(price|last|close|quote|value)/i.test(key)) continue;
    const num = (mm[2] || '').match(/[-+]?\d{1,3}(?:[,\d]{0,12})?(?:\.\d+)?/)?.[0];
    if (num) out.push({ label: key.slice(0, 40), value: normalizeNumberString(num), context: 'meta_tag' });
    if (out.length >= MAX_NUMERIC_CANDIDATES) break;
  }

  // Deduplicate; keep the earliest occurrences (usually closer to top-of-page).
  return uniqBy(out, x => `${x.label}:${x.value}`).slice(0, MAX_NUMERIC_CANDIDATES);
}

function extractMetaTags(html: string) {
  const readMeta = (re: RegExp) => {
    const m = html.match(re);
    return m?.[1] ? decodeBasicEntities(m[1]).trim() : '';
  };
  const title = readMeta(/<title[^>]*>([\s\S]{0,500}?)<\/title>/i);
  const ogTitle = readMeta(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']{0,500})["'][^>]*>/i);
  const desc = readMeta(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{0,800})["'][^>]*>/i);
  const ogDesc = readMeta(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']{0,800})["'][^>]*>/i);
  return {
    title: safeText(ogTitle || title),
    description: safeText(ogDesc || desc),
  };
}

function extractJsonLdPrices(html: string) {
  // Look for Product/Offer style JSON-LD where price is structured.
  const out: Array<{ currency?: string; price?: string; context?: string }> = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const raw = (m[1] || '').trim();
    if (!raw) continue;
    try {
      const json = JSON.parse(raw);
      const stack: any[] = [json];
      while (stack.length) {
        const cur = stack.pop();
        if (!cur) continue;
        if (Array.isArray(cur)) {
          for (const x of cur) stack.push(x);
          continue;
        }
        if (typeof cur === 'object') {
          // Offer-like nodes
          const price = cur.price ?? cur.lowPrice ?? cur.highPrice;
          const currency = cur.priceCurrency ?? cur.currency;
          if (price != null) {
            out.push({
              currency: currency ? String(currency) : undefined,
              price: String(price),
              context: cur['@type'] ? String(cur['@type']) : undefined
            });
          }
          for (const v of Object.values(cur)) stack.push(v);
        }
      }
    } catch {
      // ignore invalid json-ld
    }
    if (out.length >= 10) break;
  }
  return out;
}

function extractChartSignals(rawHtml: string) {
  // Many "chart" pages render price data inside inline scripts / embedded JSON.
  // We do NOT execute JS; we just pattern-match likely OHLC/candlestick payloads.
  const html = rawHtml;
  const snippets: string[] = [];

  // 1) OHLC arrays: [ts, open, high, low, close]
  const ohlcRe = /\[\s*(\d{10,13})\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*,\s*([-+]?\d+(?:\.\d+)?)\s*\]/g;
  let lastOhlc: { ts: string; open: string; high: string; low: string; close: string } | null = null;
  let om: RegExpExecArray | null;
  while ((om = ohlcRe.exec(html))) {
    lastOhlc = { ts: om[1], open: om[2], high: om[3], low: om[4], close: om[5] };
  }

  // 2) Object-based candlesticks: {time:..., open:..., high:..., low:..., close:...}
  const objRe = /\{\s*[^{}]{0,2000}?\bopen\s*:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*\bhigh\s*:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*\blow\s*:\s*([-+]?\d+(?:\.\d+)?)\s*,\s*\bclose\s*:\s*([-+]?\d+(?:\.\d+)?)\s*[,}]/g;
  let lastObj: { open: string; high: string; low: string; close: string } | null = null;
  let jm: RegExpExecArray | null;
  while ((jm = objRe.exec(html))) {
    lastObj = { open: jm[1], high: jm[2], low: jm[3], close: jm[4] };
  }

  // 3) Keyword windows (candlestick / ohlc / series / dataset)
  const keyRe = /\b(candlestick|ohlc|open|high|low|close|tradingview|highcharts|chartjs|chart\.js|lightweight-charts)\b/gi;
  let km: RegExpExecArray | null;
  while ((km = keyRe.exec(html))) {
    const start = Math.max(0, km.index - 350);
    const end = Math.min(html.length, km.index + 450);
    const chunk = html.slice(start, end).replace(/\s+/g, ' ').trim();
    if (chunk.length > 0) snippets.push(chunk);
    if (snippets.length >= MAX_CHART_SNIPPETS) break;
  }

  const derivedClose = lastOhlc?.close || lastObj?.close || '';
  return {
    derivedClose: derivedClose ? String(derivedClose) : '',
    derivedOhlc: lastOhlc || lastObj || null,
    snippets: Array.from(new Set(snippets)).slice(0, MAX_CHART_SNIPPETS),
  };
}

async function deliverCallback(
  callbackUrl: string | undefined,
  callbackSecret: string | undefined,
  callbackMeta: Record<string, unknown> | undefined,
  jobId: string,
  status: 'completed' | 'failed',
  result: Record<string, unknown> | null,
  error?: string,
) {
  if (!callbackUrl) return;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (callbackSecret) headers['x-callback-secret'] = callbackSecret;
    const res = await fetch(callbackUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobId, status, result, error: error || null, meta: callbackMeta || {} }),
    });
    console.log(`[Metric-AI] 📡 Callback delivered to ${callbackUrl}`, { status: res.status, jobId });
  } catch (err: any) {
    console.error(`[Metric-AI] ❌ Callback delivery failed`, { callbackUrl, jobId, error: err?.message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CLICKHOUSE METRIC SERIES - Post extracted values for charting
// ═══════════════════════════════════════════════════════════════════════════
const CLICKHOUSE_PREFIX = '📊 [CLICKHOUSE]';

async function postToClickHouse(opts: {
  marketId: string | null | undefined;
  metricName: string;
  value: number;
  confidence: number;
  source: 'fast_path' | 'full_pipeline';
  jobId: string;
}): Promise<boolean> {
  const { marketId, metricName, value, confidence, source, jobId } = opts;
  
  // Require marketId for ClickHouse (we key by Supabase market UUID)
  if (!marketId) {
    console.log(`${CLICKHOUSE_PREFIX} ⏭️ Skipped: no marketId provided`, { jobId, metricName });
    return false;
  }
  
  // Validate numeric value
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`${CLICKHOUSE_PREFIX} ⏭️ Skipped: invalid value`, { jobId, metricName, value });
    return false;
  }
  
  // Get main app URL (metric-ai-worker runs separately from main app)
  const appUrl = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || '').replace(/\/+$/, '');
  if (!appUrl) {
    console.warn(`${CLICKHOUSE_PREFIX} ⏭️ Skipped: APP_URL not configured`, { jobId, metricName });
    return false;
  }
  
  const endpoint = `${appUrl}/api/charts/metric`;
  const nowMs = Date.now();
  
  console.log(`${CLICKHOUSE_PREFIX} 📤 Posting metric value to ClickHouse`, {
    jobId,
    marketId,
    metricName,
    value,
    confidence,
    source,
    endpoint,
  });
  
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        marketId,
        metricName,
        source: source === 'fast_path' ? 'ai_fast_path' : 'ai_full_pipeline',
        version: nowMs % 2_147_483_647,
        points: { ts: nowMs, value },
        confidence,
      }),
    });
    
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.error(`${CLICKHOUSE_PREFIX} ❌ POST failed`, {
        jobId,
        marketId,
        metricName,
        status: res.status,
        error: errText.slice(0, 200),
      });
      return false;
    }
    
    const body = await res.json().catch(() => ({}));
    console.log(`${CLICKHOUSE_PREFIX} ✅ Successfully posted to ClickHouse`, {
      jobId,
      marketId,
      metricName,
      value,
      source,
      inserted: body?.inserted || 1,
      table: body?.meta?.table || 'metric_series_raw',
    });
    return true;
  } catch (err: any) {
    console.error(`${CLICKHOUSE_PREFIX} ❌ POST exception`, {
      jobId,
      marketId,
      metricName,
      error: err?.message || String(err),
    });
    return false;
  }
}

function corsHeaders(origin?: string) {
  const allowRaw = process.env.ALLOW_ORIGIN || '*';
  // Always vary on Origin so CDNs/CDN cache correctly
  const varyHeader = { 'Vary': 'Origin' as const };
  if (allowRaw === '*') {
    return {
      ...varyHeader,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400'
    };
  }
  // Support comma-separated allow-list: e.g. "https://www.dexetera.xyz,http://localhost:3000"
  const allowList = allowRaw.split(',').map(s => s.trim()).filter(Boolean);
  const isAllowed = origin && allowList.some(allowed => origin === allowed || (allowed && origin!.endsWith(allowed)));
  const acao = isAllowed ? (origin as string) : (allowList[0] || '*');
  return {
    ...varyHeader,
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': 'POST,GET,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

export async function OPTIONS(req: NextRequest) {
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get('origin') || undefined) });
}

export async function POST(req: NextRequest) {
  const requestStartTime = Date.now();
  
  try {
    const body = await req.json();
    const input = InputSchema.parse(body);

    console.log('[Metric-AI] ═══════════════════════════════════════════════════');
    console.log('[Metric-AI] 📥 INCOMING REQUEST', {
      metric: input.metric,
      description: input.description?.slice(0, 100),
      urls: input.urls,
      urlCount: input.urls.length,
      context: input.context,
      mode: 'jina-reader',
      relatedMarketId: input.related_market_id,
      timestamp: new Date().toISOString(),
    });
    console.log('[Metric-AI] ═══════════════════════════════════════════════════');

    const supabase = getSupabase();
    const jobId = `metric_ai_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;

    console.log('[Metric-AI] 📝 Creating job in database', { jobId });

    await supabase.from('metric_oracle_jobs').insert([{
      job_id: jobId,
      status: 'processing',
      progress: 0,
      metric_input: {
        metric: input.metric,
        description: input.description || null,
        urls: input.urls
      },
      created_at: new Date()
    }]);

    console.log('[Metric-AI] ✓ Job created, starting background processing', { jobId });

    after(async () => {
      const started = Date.now();
      console.log('[Metric-AI] ▶ Background worker started', { jobId, timestamp: new Date().toISOString() });
      
      // ═══════════════════════════════════════════════════════════════════════════
      // PIPELINE START - Track the extraction path taken
      // ═══════════════════════════════════════════════════════════════════════════
      pipelineLog('START', {
        jobId,
        metric: input.metric,
        urls: input.urls,
        context: input.context || 'unknown',
        marketId: input.related_market_id || 'none',
        isNewMetric: input.context === 'create',
      });
      
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const texts: string[] = [];
        const screenshotDataMap = new Map<string, SourceScreenshotData>();

        // --- Phase 0: Fetch ai_source_locator + historical context in parallel ---
        let storedLocatorData: AiSourceLocatorData | null = null;
        let historicalStats: HistoricalStats = { lastValue: null, lastUpdatedAt: null, min: 0, max: 0, mean: 0, stdDev: 0, count: 0, suspiciousBelow: 0, suspiciousAbove: Infinity, source: 'none' };
        const marketId = input.related_market_id || '';

        pipelineLog('PHASE_0_START', {
          phase: 'Load stored locators + historical context',
          marketId: marketId || 'none',
          hasMarketId: !!marketId,
        });

        const phase0Promises: Promise<void>[] = [];
        if (marketId) {
          phase0Promises.push((async () => {
            try {
              const { data } = await supabase
                .from('markets')
                .select('ai_source_locator, market_config, market_identifier')
                .eq('id', marketId)
                .limit(1)
                .maybeSingle();

              const locatorCol = (data as any)?.ai_source_locator;
              if (locatorCol && Array.isArray(locatorCol.selectors) && locatorCol.selectors.length > 0) {
                storedLocatorData = locatorCol as AiSourceLocatorData;
                pipelineLog('LOCATOR_FOUND', {
                  hasStoredLocator: true,
                  selectorCount: locatorCol.selectors.length,
                  bestSelector: locatorCol.selectors[0]?.selector?.slice(0, 80),
                  bestType: locatorCol.selectors[0]?.type,
                  bestConfidence: locatorCol.selectors[0]?.confidence,
                  successCount: locatorCol.success_count,
                  failureCount: locatorCol.failure_count,
                  lastSuccessfulAt: locatorCol.last_successful_at,
                  storedUrl: locatorCol.url,
                });
              } else {
                pipelineLog('LOCATOR_NOT_FOUND', {
                  hasStoredLocator: false,
                  reason: 'No ai_source_locator in database or empty selectors',
                  willRunFullPipeline: true,
                });
              }
            } catch (e: any) {
              pipelineLog('LOCATOR_LOAD_ERROR', { error: e?.message });
            }
          })());
          phase0Promises.push((async () => {
            try {
              const metricName = input.metric || input.related_market_identifier || '';
              historicalStats = await getHistoricalContext(marketId, metricName);
              pipelineLog('HISTORICAL_CONTEXT_LOADED', {
                source: historicalStats.source,
                count: historicalStats.count,
                lastValue: historicalStats.lastValue,
                lastUpdatedAt: historicalStats.lastUpdatedAt,
                expectedRange: `${historicalStats.suspiciousBelow?.toFixed(2)} - ${historicalStats.suspiciousAbove?.toFixed(2)}`,
              });
            } catch (e: any) {
              pipelineLog('HISTORICAL_CONTEXT_ERROR', { error: e?.message });
            }
          })());
        }
        if (phase0Promises.length) await Promise.all(phase0Promises);
        storedLocatorData = storedLocatorData as AiSourceLocatorData | null;
        
        pipelineLog('PHASE_0_COMPLETE', {
          durationMs: Date.now() - started,
          hasStoredLocator: !!storedLocatorData,
          hasHistoricalContext: historicalStats.source !== 'none',
        });

        // --- Phase 0.5: Fast path — use stored CSS selectors via Jina HTML + cheerio ---
        // If ai_source_locator exists with valid selectors → use fast-path
        // Context doesn't matter - if we have working selectors, use them
        const fastPathEligible = 
          storedLocatorData &&
          storedLocatorData.selectors.length > 0 &&
          storedLocatorData.url &&
          storedLocatorData.failure_count < 3;
        
        pipelineLog('FAST_PATH_CHECK', {
          eligible: fastPathEligible,
          reasons: {
            hasStoredLocator: !!storedLocatorData,
            hasSelectors: (storedLocatorData?.selectors?.length || 0) > 0,
            hasUrl: !!storedLocatorData?.url,
            failureCountOk: (storedLocatorData?.failure_count || 0) < 3,
          },
          context: input.context || 'none',
          decision: fastPathEligible ? '⚡ ATTEMPTING FAST PATH (locators exist)' : '🐢 WILL RUN FULL PIPELINE (no locators)',
        });
        
        if (fastPathEligible) {
          const fastPathStart = Date.now();
          pipelineLog('FAST_PATH_START', {
            url: storedLocatorData!.url,
            selectorCount: storedLocatorData!.selectors.length,
            topSelector: storedLocatorData!.selectors[0]?.selector?.slice(0, 100),
            successCount: storedLocatorData!.success_count,
            failureCount: storedLocatorData!.failure_count,
          });

          const fastResult = await fastExtract(
            storedLocatorData!.url,
            storedLocatorData!.selectors as DiscoveredSelector[],
          );

          if (fastResult) {
            const fastValidation = validateExtractedValue(fastResult.value, historicalStats);
            
            pipelineLog('FAST_PATH_EXTRACTED', {
              value: fastResult.value,
              method: fastResult.method,
              selector: fastResult.selector?.slice(0, 100),
              extractTimeMs: fastResult.extractTimeMs,
              validationResult: {
                valid: fastValidation.valid,
                maxConfidence: fastValidation.maxConfidence,
                warnings: fastValidation.warnings,
              },
            });

            if (fastValidation.valid || fastValidation.maxConfidence >= 0.6) {
              const fastConfidence = Math.min(0.95, fastValidation.maxConfidence);
              const totalFastPathMs = Date.now() - started;
              
              pipelineLog('FAST_PATH_SUCCESS', {
                jobId,
                value: fastResult.value,
                confidence: fastConfidence,
                totalTimeMs: totalFastPathMs,
                extractTimeMs: fastResult.extractTimeMs,
                timeSavedEstimate: '~30-60 seconds (skipped full AI pipeline)',
                method: fastResult.method,
                selector: fastResult.selector?.slice(0, 100),
              });

              const fastResolution = {
                // Core result
                metric: input.metric,
                value: fastResult.value,
                asset_price_suggestion: fastResult.value,
                confidence: fastConfidence,
                as_of: new Date().toISOString(),
                
                // Pipeline metadata (concise)
                pipeline: {
                  path: 'FAST_PATH',
                  extractTimeMs: fastResult.extractTimeMs,
                  method: fastResult.method,
                  selector: fastResult.selector?.slice(0, 100),
                  timeSaved: '~30-60s (skipped full AI)',
                },
                
                // Validation context
                validation: {
                  historicalSource: historicalStats.source,
                  lastKnownValue: historicalStats.lastValue,
                  expectedRange: historicalStats.source !== 'none' 
                    ? `${historicalStats.suspiciousBelow?.toFixed(2)} - ${historicalStats.suspiciousAbove?.toFixed(2)}`
                    : null,
                },
                
                // Source reference
                sources: [{ 
                  url: storedLocatorData!.url, 
                  selector: fastResult.selector?.slice(0, 80),
                  match_score: fastConfidence 
                }],
                
                // Legacy fields for compatibility
                unit: 'unknown',
                reasoning: `Fast-path extraction via stored ${fastResult.method} selector.`,
                fast_path: true,
                fast_path_method: fastResult.method,
                fast_path_extract_time_ms: fastResult.extractTimeMs,
                historical_context_source: historicalStats.source,
                historical_last_value: historicalStats.lastValue,
              };

              // Persist resolution
              let resolutionId: string | null = null;
              try {
                const { data: resData, error: resErr } = await supabase
                  .from('metric_oracle_resolutions')
                  .insert([{
                    metric_name: input.metric,
                    metric_description: input.description || null,
                    source_urls: input.urls,
                    resolution_data: fastResolution,
                    confidence_score: fastConfidence,
                    processing_time_ms: Date.now() - started,
                    user_address: input.user_address || null,
                    related_market_id: marketId || null,
                    created_at: new Date(),
                  }])
                  .select('id')
                  .single();
                if (!resErr) resolutionId = resData?.id || null;
              } catch {}

              // Update market link + bump locator success_count
              if (marketId) {
                try {
                  const updatedLocator = {
                    ...storedLocatorData!,
                    last_successful_at: new Date().toISOString(),
                    success_count: (storedLocatorData!.success_count || 0) + 1,
                  };
                  const updatePayload: any = {
                    ai_source_locator: updatedLocator,
                    updated_at: new Date().toISOString(),
                  };
                  if (resolutionId) updatePayload.metric_resolution_id = resolutionId;
                  await supabase.from('markets').update(updatePayload).eq('id', marketId);
                } catch {}
              }

              const totalMs = Date.now() - started;

              await supabase.from('metric_oracle_jobs').update({
                status: 'completed',
                progress: 100,
                result: fastResolution,
                processing_time_ms: totalMs,
                completed_at: new Date(),
              }).eq('job_id', jobId);

              console.log('[Metric-AI] ⚡ FAST PATH COMPLETED', {
                jobId, totalMs, value: fastResult.value, confidence: fastConfidence,
              });


              // Post to ClickHouse for charting
              await postToClickHouse({
                marketId,
                metricName: input.metric,
                value: parseFloat(fastResult.value),
                confidence: fastConfidence,
                source: 'fast_path',
                jobId,
              });
              await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'completed', fastResolution);

              return NextResponse.json({
                jobId, status: 'completed', result: fastResolution,
              });
            } else {
              pipelineLog('FAST_PATH_VALIDATION_FAILED', {
                value: fastResult.value,
                warnings: fastValidation.warnings,
                maxConfidence: fastValidation.maxConfidence,
                decision: 'Falling through to FULL PIPELINE',
                reason: 'Extracted value failed historical validation',
              });
            }
          } else {
            pipelineLog('FAST_PATH_EXTRACTION_FAILED', {
              reason: 'fastExtract returned null - selector may be stale',
              url: storedLocatorData!.url,
              selectorCount: storedLocatorData!.selectors.length,
              decision: 'Falling through to FULL PIPELINE + incrementing failure_count',
            });
            // Increment failure_count
            if (marketId) {
              try {
                const updatedLocator = {
                  ...storedLocatorData,
                  failure_count: (storedLocatorData!.failure_count || 0) + 1,
                };
                await supabase.from('markets').update({
                  ai_source_locator: updatedLocator,
                  updated_at: new Date().toISOString(),
                }).eq('id', marketId);
                pipelineLog('LOCATOR_FAILURE_COUNT_INCREMENTED', {
                  newFailureCount: updatedLocator.failure_count,
                  willDisableFastPathAt: 3,
                });
              } catch {}
            }
          }
        }
        
        // If we reach here, fast path was not used or failed
        pipelineLog('FULL_PIPELINE_START', {
          reason: !fastPathEligible ? 'Fast path not eligible' : 'Fast path failed',
          context: input.context || 'unknown',
          urlCount: input.urls.length,
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // PHASE 0.7: RAW HTML FAST MODE
        // Try raw HTML extraction first - if we get confident candidates, skip Jina/Vision
        // This is much faster (~2-3s) than the full pipeline (~30-60s)
        // ═══════════════════════════════════════════════════════════════════════════
        let rawHtmlFastModeUsed = false;
        let rawHtmlFastModeResult: { value: string; confidence: number; candidates: any[] } | null = null;
        
        pipelineLog('RAW_HTML_FAST_MODE_START', {
          purpose: 'Try raw HTML extraction before Jina/Vision - faster for server-rendered pages',
          urls: input.urls,
        });
        
        const rawHtmlFastModeStartTime = Date.now();
        
        try {
          // Fetch raw HTML for all URLs in parallel
          const rawHtmlResults = await Promise.all(
            input.urls.slice(0, 3).map(async (url) => {
              try {
                const response = await fetch(url, {
                  headers: { 'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'https://dexextra.com'})` },
                  signal: AbortSignal.timeout(10_000),
                });
                if (!response.ok) return { url, html: null, error: `HTTP ${response.status}` };
                const html = await response.text();
                return { url, html: html.slice(0, MAX_RAW_HTML_CHARS), error: null };
              } catch (e: any) {
                return { url, html: null, error: e?.message || 'fetch failed' };
              }
            })
          );
          
          const successfulHtmls = rawHtmlResults.filter(r => r.html);
          
          if (successfulHtmls.length > 0) {
            // Extract candidates from all HTMLs
            const allCandidates: Array<{ label: string; value: string; context: string; url: string }> = [];
            
            for (const { url, html } of successfulHtmls) {
              if (!html) continue;
              const candidates = extractNumericCandidates(html);
              const jsonLd = extractJsonLdPrices(html);
              const chart = extractChartSignals(html);
              
              // Add candidates with URL tracking
              for (const c of candidates) {
                allCandidates.push({ ...c, url });
              }
              
              // Add JSON-LD prices as high-confidence candidates
              for (const jld of jsonLd) {
                if (jld.price) {
                  allCandidates.push({
                    label: 'json_ld_price',
                    value: String(jld.price).replace(/[^0-9.-]/g, ''),
                    context: `JSON-LD ${jld.context || 'structured data'}`,
                    url,
                  });
                }
              }
              
              // Add chart-derived close as candidate
              if (chart.derivedClose) {
                allCandidates.push({
                  label: 'chart_close',
                  value: chart.derivedClose,
                  context: 'Chart OHLC derived close',
                  url,
                });
              }
            }
            
            pipelineLog('RAW_HTML_FAST_MODE_CANDIDATES', {
              urlsProcessed: successfulHtmls.length,
              totalCandidates: allCandidates.length,
              topCandidates: allCandidates.slice(0, 5).map(c => ({
                label: c.label,
                value: c.value,
                context: c.context?.slice(0, 50),
              })),
            });
            
            // Check if we have high-confidence candidates
            // Criteria: multiple candidates agreeing on similar values, or strong label matches
            const priceLabels = ['price', 'last', 'close', 'value', 'json_ld_price', 'chart_close'];
            const strongCandidates = allCandidates.filter(c => 
              priceLabels.some(l => c.label.toLowerCase().includes(l))
            );
            
            // Group by similar values (within 1% tolerance)
            const valueGroups: Map<string, typeof allCandidates> = new Map();
            for (const c of strongCandidates) {
              const numVal = parseFloat(c.value);
              if (!Number.isFinite(numVal) || numVal <= 0) continue;
              
              let foundGroup = false;
              for (const [key, group] of valueGroups) {
                const groupVal = parseFloat(key);
                const diff = Math.abs(numVal - groupVal) / groupVal;
                if (diff < 0.01) { // Within 1%
                  group.push(c);
                  foundGroup = true;
                  break;
                }
              }
              if (!foundGroup) {
                valueGroups.set(c.value, [c]);
              }
            }
            
            // Find the group with most agreement
            let bestGroup: typeof allCandidates = [];
            let bestValue = '';
            for (const [value, group] of valueGroups) {
              if (group.length > bestGroup.length) {
                bestGroup = group;
                bestValue = value;
              }
            }
            
            // Decide if we have enough confidence to use raw HTML fast mode
            // Criteria: 2+ agreeing candidates OR 1 candidate with strong label (json_ld, chart)
            const hasStrongSingleCandidate = strongCandidates.some(c => 
              c.label === 'json_ld_price' || c.label === 'chart_close'
            );
            const hasAgreement = bestGroup.length >= 2;
            
            const rawHtmlConfident = hasStrongSingleCandidate || hasAgreement;
            
            pipelineLog('RAW_HTML_FAST_MODE_ANALYSIS', {
              strongCandidatesCount: strongCandidates.length,
              valueGroupsCount: valueGroups.size,
              bestGroupSize: bestGroup.length,
              bestValue,
              hasStrongSingleCandidate,
              hasAgreement,
              decision: rawHtmlConfident ? '⚡ USING RAW HTML FAST MODE' : '🐢 Escalating to Jina/Vision',
            });
            
            if (rawHtmlConfident && bestValue) {
              rawHtmlFastModeUsed = true;
              const confidence = hasAgreement ? Math.min(0.85, 0.6 + bestGroup.length * 0.1) : 0.7;
              rawHtmlFastModeResult = {
                value: bestValue,
                confidence,
                candidates: bestGroup,
              };
              
              const fastModeDurationMs = Date.now() - rawHtmlFastModeStartTime;
              pipelineLog('RAW_HTML_FAST_MODE_SUCCESS', {
                value: bestValue,
                confidence,
                agreementCount: bestGroup.length,
                durationMs: fastModeDurationMs,
                timeSavedEstimate: '~25-55 seconds (skipped Jina + Vision)',
                sources: bestGroup.map(c => ({ label: c.label, context: c.context?.slice(0, 50) })),
              });
            }
          }
        } catch (e: any) {
          pipelineLog('RAW_HTML_FAST_MODE_ERROR', { error: e?.message || String(e) });
        }
        
        // If raw HTML fast mode succeeded, skip to lightweight OpenAI fusion
        if (rawHtmlFastModeUsed && rawHtmlFastModeResult) {
          pipelineLog('RAW_HTML_FAST_MODE_FUSION', {
            skipping: 'Jina, Vision, Full OpenAI fusion',
            using: 'Lightweight OpenAI confirmation',
          });
          
          // Build a minimal prompt for OpenAI to confirm/format the value
          const fastModePrompt = `
METRIC: ${input.metric}
${input.description ? `DESCRIPTION: ${input.description}` : ''}

RAW HTML EXTRACTION FOUND THESE CANDIDATES:
${rawHtmlFastModeResult.candidates.slice(0, 5).map(c => `- ${c.label}: ${c.value} (${c.context})`).join('\n')}

BEST CANDIDATE: ${rawHtmlFastModeResult.value} (${rawHtmlFastModeResult.candidates.length} sources agree)

TASK: Confirm this is the correct value for the metric. Return JSON:
{ "value": "...", "confidence": 0.0-1.0, "asset_price_suggestion": "numeric_only", "reasoning": "brief" }

If the extracted value looks wrong for this metric, set confidence < 0.5 and explain why.
`;

          try {
            const fastFusionStart = Date.now();
            const fastResp = await openai.chat.completions.create({
              model: OPENAI_MODEL_FAST,
              response_format: { type: 'json_object' },
              messages: [
                { role: 'system', content: 'You are confirming an extracted metric value. Return strict JSON only.' },
                { role: 'user', content: fastModePrompt },
              ],
              max_tokens: 500,
            });
            
            let fastRaw = fastResp.choices[0]?.message?.content?.trim() || '{}';
            try { fastRaw = fastRaw.replace(/```json|```/g, '').trim(); } catch {}
            const fastJson = JSON.parse(fastRaw);
            
            const fastFusionDurationMs = Date.now() - fastFusionStart;
            const totalFastModeMs = Date.now() - rawHtmlFastModeStartTime;
            
            // If OpenAI confirms (confidence >= 0.5), use raw HTML fast mode result
            if (typeof fastJson.confidence === 'number' && fastJson.confidence >= 0.5) {
              const finalValue = fastJson.asset_price_suggestion || fastJson.value || rawHtmlFastModeResult.value;
              const finalConfidence = Math.min(rawHtmlFastModeResult.confidence, fastJson.confidence);
              
              pipelineLog('RAW_HTML_FAST_MODE_CONFIRMED', {
                value: finalValue,
                confidence: finalConfidence,
                openaiConfidence: fastJson.confidence,
                totalDurationMs: totalFastModeMs,
                fusionDurationMs: fastFusionDurationMs,
              });
              
              const fastResolution = {
                metric: input.metric,
                value: finalValue,
                asset_price_suggestion: finalValue,
                confidence: finalConfidence,
                as_of: new Date().toISOString(),
                
                pipeline: {
                  path: 'RAW_HTML_FAST_MODE',
                  totalTimeMs: totalFastModeMs,
                  method: 'raw_html_extraction + lightweight_openai',
                  candidatesFound: rawHtmlFastModeResult.candidates.length,
                  timeSaved: '~25-55s (skipped Jina + Vision)',
                },
                
                validation: {
                  historicalSource: historicalStats.source,
                  lastKnownValue: historicalStats.lastValue,
                },
                
                reasoning: fastJson.reasoning || 'Raw HTML extraction with OpenAI confirmation',
                sources: rawHtmlFastModeResult.candidates.slice(0, 3).map(c => ({
                  url: c.url,
                  quote: `${c.label}: ${c.value}`,
                  match_score: finalConfidence,
                })),
                
                // Legacy compatibility
                unit: 'unknown',
                fast_path: false,
                raw_html_fast_mode: true,
                fusion_tier: 'raw_html_fast',
                fusion_model: OPENAI_MODEL_FAST,
              };
              
              // Persist resolution
              let resolutionId: string | null = null;
              try {
                const { data: resData, error: resErr } = await supabase
                  .from('metric_oracle_resolutions')
                  .insert([{
                    metric_name: input.metric,
                    metric_description: input.description || null,
                    source_urls: input.urls,
                    resolution_data: fastResolution,
                    confidence_score: finalConfidence,
                    processing_time_ms: totalFastModeMs,
                    user_address: input.user_address || null,
                    related_market_id: marketId || null,
                    created_at: new Date(),
                  }])
                  .select('id')
                  .single();
                if (!resErr) resolutionId = resData?.id || null;
              } catch {}
              
              // Link to market
              if (marketId && resolutionId) {
                try {
                  await supabase.from('markets').update({
                    metric_resolution_id: resolutionId,
                    updated_at: new Date().toISOString(),
                  }).eq('id', marketId);
                } catch {}
              }
              
              // Discover locators if confident enough
              if (finalConfidence >= 0.7 && marketId && input.urls.length > 0) {
                try {
                  const discovered = await discoverLocators(
                    input.urls[0],
                    finalValue,
                    'raw_html_fast_mode',
                  );
                  if (discovered) {
                    await supabase.from('markets').update({
                      ai_source_locator: discovered,
                      updated_at: new Date().toISOString(),
                    }).eq('id', marketId);
                    
                    pipelineLog('RAW_HTML_FAST_MODE_LOCATORS_DISCOVERED', {
                      selectorCount: discovered.selectors.length,
                      futureImpact: 'Next fetch will use CSS SELECTOR FAST PATH (~1-2s)',
                    });
                  }
                } catch {}
              }
              
              await supabase.from('metric_oracle_jobs').update({
                status: 'completed',
                progress: 100,
                result: fastResolution,
                processing_time_ms: totalFastModeMs,
                completed_at: new Date(),
              }).eq('job_id', jobId);
              
              pipelineLog('PIPELINE_COMPLETE', {
                jobId,
                totalTimeMs: totalFastModeMs,
                pathTaken: 'RAW_HTML_FAST_MODE',
                result: { value: finalValue, confidence: finalConfidence },
                nextFetchExpectation: finalConfidence >= 0.7 
                  ? 'Next fetch may use CSS SELECTOR FAST PATH (locators discovered)'
                  : 'Next fetch will try RAW_HTML_FAST_MODE again',
              });

              // Post to ClickHouse for charting
              await postToClickHouse({
                marketId,
                metricName: input.metric,
                value: parseFloat(String(finalValue)),
                confidence: finalConfidence,
                source: 'fast_path',
                jobId,
              });
              
              await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'completed', fastResolution);
              return;
            } else {
              pipelineLog('RAW_HTML_FAST_MODE_REJECTED', {
                reason: 'OpenAI confidence too low',
                openaiConfidence: fastJson.confidence,
                openaiReasoning: fastJson.reasoning,
                decision: 'Escalating to full pipeline (Jina + Vision)',
              });
            }
          } catch (e: any) {
            pipelineLog('RAW_HTML_FAST_MODE_FUSION_ERROR', {
              error: e?.message || String(e),
              decision: 'Escalating to full pipeline',
            });
          }
        }

        const visionExpectedRange = historicalStats.source !== 'none' && historicalStats.lastValue
          ? { min: historicalStats.suspiciousBelow, max: historicalStats.suspiciousAbove }
          : undefined;

        // ═══════════════════════════════════════════════════════════════════════════
        // ARCHIVE-FIRST SETTLEMENT FLOW
        // For settlement context, we archive the live page FIRST, then analyze
        // the archived Wayback URL. This ensures perfect congruence between
        // the evidence URL and the AI-extracted settlement price.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Archive-first flow tracking variables
        let archiveFirstFlow = false;
        let archiveFallbackUsed = false;
        let textExtractedValue: number | null = null;
        let visionExtractedValue: number | null = null;
        let extractionConfidenceMatch = false;
        let valueSource: 'text' | 'vision' | 'consensus' | 'fallback' = 'fallback';
        const analyzedUrlsMap: Map<string, { liveUrl: string; analyzedUrl: string; isArchived: boolean; waybackTimestamp?: string }> = new Map();
        
        // Determine which URLs to analyze (archived or live)
        let urlsToAnalyze = [...input.urls];
        
        // ARCHIVE-FIRST: For settlement, archive live pages FIRST before any analysis
        if (input.context === 'settlement' && ENABLE_VISION_ANALYSIS) {
          console.log('[Metric-AI] 📦 ARCHIVE-FIRST SETTLEMENT MODE');
          console.log('[Metric-AI] 📦 Phase 0: Archiving live pages FIRST (before any analysis)');
          
          const { archiveMulti } = await import('../../../lib/archiveMulti');
          
          // Archive all live URLs in parallel
          // Use longer timeouts for live pages (they require full page render + crawl)
          const archiveStartTime = Date.now();
          const archiveResults = await Promise.allSettled(
            input.urls.map(url => archiveMulti(url, { 
              totalTimeoutMs: 60_000,      // 60s total timeout
              providerTimeoutMs: 55_000,   // 55s per provider (live pages take longer)
            }))
          );
          
          const archivedUrls: { liveUrl: string; waybackUrl: string; timestamp?: string }[] = [];
          const failedUrls: string[] = [];
          
          for (let i = 0; i < input.urls.length; i++) {
            const result = archiveResults[i];
            const liveUrl = input.urls[i];
            
            if (result.status === 'fulfilled' && result.value.success && result.value.primaryUrl) {
              const iaResult = result.value.archives?.find((a: any) => a.provider === 'internet_archive' && a.success);
              archivedUrls.push({
                liveUrl,
                waybackUrl: result.value.primaryUrl,
                timestamp: iaResult?.timestamp,
              });
              console.log(`[Metric-AI] ✓ Archived: ${liveUrl} → ${result.value.primaryUrl}`);
            } else {
              const reason = result.status === 'rejected' 
                ? result.reason?.message 
                : result.value?.error || 'unknown';
              failedUrls.push(liveUrl);
              console.warn(`[Metric-AI] ⚠ Archive failed for ${liveUrl}: ${reason}`);
            }
          }
          
          console.log(`[Metric-AI] 📦 Phase 0 complete in ${Date.now() - archiveStartTime}ms`, {
            archived: archivedUrls.length,
            failed: failedUrls.length,
          });
          
          if (archivedUrls.length > 0) {
            archiveFirstFlow = true;
            
            // Use archived Wayback URLs for analysis instead of live URLs
            urlsToAnalyze = archivedUrls.map(a => a.waybackUrl);
            
            // Track the mapping for resolution
            for (const archived of archivedUrls) {
              analyzedUrlsMap.set(archived.waybackUrl, {
                liveUrl: archived.liveUrl,
                analyzedUrl: archived.waybackUrl,
                isArchived: true,
                waybackTimestamp: archived.timestamp,
              });
            }
            
            // Add failed URLs as fallback (will analyze live)
            for (const failedUrl of failedUrls) {
              urlsToAnalyze.push(failedUrl);
              analyzedUrlsMap.set(failedUrl, {
                liveUrl: failedUrl,
                analyzedUrl: failedUrl,
                isArchived: false,
              });
              archiveFallbackUsed = true;
            }
            
            // ── WAYBACK AVAILABILITY CHECK WITH EXPONENTIAL BACKOFF ──
            // Freshly archived URLs may take a moment to become accessible.
            // We verify with exponential backoff: 2s, 4s, 8s delays.
            console.log('[Metric-AI] ⏳ Verifying Wayback URLs are accessible...');
            
            const verifyWaybackUrl = async (waybackUrl: string, maxRetries = 3): Promise<boolean> => {
              const delays = [2000, 4000, 8000]; // Exponential backoff
              
              for (let attempt = 0; attempt < maxRetries; attempt++) {
                try {
                  const response = await fetch(waybackUrl, {
                    method: 'HEAD',
                    headers: { 'User-Agent': 'Dexextra/1.0' },
                    signal: AbortSignal.timeout(10_000),
                  });
                  
                  if (response.ok || response.status === 200 || response.status === 302) {
                    console.log(`[Metric-AI] ✓ Wayback URL accessible (attempt ${attempt + 1}): ${waybackUrl}`);
                    return true;
                  }
                  
                  console.log(`[Metric-AI] ⏳ Wayback not ready (status ${response.status}), attempt ${attempt + 1}/${maxRetries}`);
                } catch (err: any) {
                  console.log(`[Metric-AI] ⏳ Wayback check failed (attempt ${attempt + 1}): ${err?.message || 'timeout'}`);
                }
                
                if (attempt < maxRetries - 1) {
                  const delay = delays[attempt] || delays[delays.length - 1];
                  console.log(`[Metric-AI] ⏳ Waiting ${delay}ms before retry...`);
                  await new Promise(resolve => setTimeout(resolve, delay));
                }
              }
              
              return false;
            };
            
            // Verify first archived URL (representative check)
            const firstArchivedUrl = archivedUrls[0]?.waybackUrl;
            if (firstArchivedUrl) {
              const isAccessible = await verifyWaybackUrl(firstArchivedUrl);
              if (!isAccessible) {
                console.warn('[Metric-AI] ⚠ Wayback URL not accessible after retries, proceeding anyway');
              }
            }
            
          } else {
            // All archiving failed - fall back to current flow (analyze live pages)
            archiveFallbackUsed = true;
            for (const url of input.urls) {
              analyzedUrlsMap.set(url, {
                liveUrl: url,
                analyzedUrl: url,
                isArchived: false,
              });
            }
            console.warn('[Metric-AI] ⚠ All archiving failed, falling back to live URL analysis');
          }
        } else {
          // Non-settlement context - use live URLs directly
          for (const url of input.urls) {
            analyzedUrlsMap.set(url, {
              liveUrl: url,
              analyzedUrl: url,
              isArchived: false,
            });
          }
        }

        console.log('[Metric-AI] 🌐 Phase 1: Fetching content and capturing screenshots via Jina', {
          urlCount: urlsToAnalyze.length,
          archiveFirstFlow,
          archiveFallbackUsed,
          rawHtmlFastModeTried: !rawHtmlFastModeUsed,
          escalationReason: rawHtmlFastModeResult 
            ? 'Raw HTML candidates found but OpenAI rejected'
            : 'No confident candidates from raw HTML',
        });

        // --- Phase 1: Fetch content + screenshots in parallel per URL ---
        // In archive-first mode, these are Wayback URLs; otherwise live pages.
        const urlProcessingPromises = urlsToAnalyze.map(async (url) => {
          const screenshotData: SourceScreenshotData = { url };
          
          try {
            const fetchedAt = new Date().toISOString();

              // ── Pass 1: Speed-first — all three via "direct" engine in parallel ──
              console.log(`[Metric-AI] 🔗 Pass 1 (direct): Starting speed-first parallel fetch for ${url}`);
              const pass1Start = Date.now();

              const [jinaResultDirect, screenshotDirect, htmlResponse] = await Promise.all([
                fetchWithJina(url, { timeoutMs: 15_000, engine: 'direct' }).catch(err => ({
                  success: false as const, error: String(err?.message || err), durationMs: 0,
                  title: undefined, description: undefined, content: undefined, engine: undefined,
                })),
                ENABLE_VISION_ANALYSIS
                  ? screenshotWithJina(url, { timeoutMs: 15_000, engine: 'direct' })
                      .catch(() => ({ success: false as const, error: 'exception', captureTimeMs: 0, base64: undefined, engine: undefined }))
                  : Promise.resolve(null),
                fetch(url, {
                  headers: { 'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'https://dexextra.com'})` },
                  signal: AbortSignal.timeout(15_000),
                }).catch(() => null),
              ]);

              const pass1Ms = Date.now() - pass1Start;
              console.log(`[Metric-AI] ⏱️ Pass 1 (direct) completed in ${pass1Ms}ms for ${url}`, {
                text: jinaResultDirect.success ? 'ok' : 'fail',
                screenshot: screenshotDirect?.success ? 'ok' : screenshotDirect ? 'fail' : 'skip',
                rawHtml: htmlResponse?.ok ? 'ok' : 'fail',
              });

              // Screenshot is ready from direct — lock it in immediately
              let extScreenshot = screenshotDirect;

              // ── Pass 2: Retry only the pieces that failed, with fallback engines ──
              // Screenshot already succeeded via direct? Great — don't wait for it again.
              // Text or raw HTML failed? Retry them (they don't block the screenshot).
              const needsTextRetry = !jinaResultDirect.success || !jinaResultDirect.content || jinaResultDirect.content.length < 50;
              const needsScreenshotRetry = ENABLE_VISION_ANALYSIS && (!screenshotDirect || !screenshotDirect.success);

              let jinaResult = jinaResultDirect;

              if (needsTextRetry || needsScreenshotRetry) {
                console.log(`[Metric-AI] 🔄 Pass 2 (fallback): Retrying failed fetches for ${url}`, {
                  retryText: needsTextRetry,
                  retryScreenshot: needsScreenshotRetry,
                });
                const pass2Start = Date.now();

                const retryPromises: Promise<void>[] = [];

                if (needsTextRetry) {
                  retryPromises.push((async () => {
                    const retried = await fetchWithJina(url, { timeoutMs: 30_000 }).catch(err => ({
                      success: false as const, error: String(err?.message || err), durationMs: 0,
                      title: undefined, description: undefined, content: undefined, engine: undefined,
                    }));
                    if (retried.success) jinaResult = retried;
                  })());
                }

                if (needsScreenshotRetry) {
                  retryPromises.push((async () => {
                    const retried = await screenshotWithJina(url, { timeoutMs: 45_000 })
                      .catch(() => ({ success: false as const, error: 'exception', captureTimeMs: 0, base64: undefined, engine: undefined }));
                    if (retried.success) extScreenshot = retried;
                  })());
                }

                await Promise.all(retryPromises);
                console.log(`[Metric-AI] ⏱️ Pass 2 (fallback) completed in ${Date.now() - pass2Start}ms for ${url}`);
              }

              // Log final results
              if (jinaResult.success) {
                console.log(`[Metric-AI] 📝 Jina text result for ${url}:`, {
                  engine: (jinaResult as any).engine || 'direct',
                  contentLength: jinaResult.content?.length || 0,
                  title: jinaResult.title?.slice(0, 80) || null,
                  durationMs: jinaResult.durationMs,
                });
              } else {
                console.log(`[Metric-AI] ❌ Jina text extraction FAILED for ${url}:`, {
                  error: jinaResult.error?.slice(0, 200),
                });
              }

              if (extScreenshot) {
                if (extScreenshot.success) {
                  const imgSizeKB = extScreenshot.base64 ? Math.round(extScreenshot.base64.length * 0.75 / 1024) : 0;
                  console.log(`[Metric-AI] 📸 Jina screenshot result for ${url}:`, {
                    engine: (extScreenshot as any).engine || 'direct',
                    imageSizeKB: imgSizeKB,
                    captureTimeMs: extScreenshot.captureTimeMs,
                  });
                } else {
                  console.log(`[Metric-AI] ❌ Jina screenshot FAILED for ${url}:`, {
                    error: extScreenshot.error?.slice(0, 200),
                  });
                }
              }

              // Screenshot → ScreenshotResult shape
              if (extScreenshot && extScreenshot.success) {
                screenshotData.screenshotResult = {
                  success: true,
                  base64: extScreenshot.base64,
                  captureTimeMs: extScreenshot.captureTimeMs,
                };
              } else if (extScreenshot) {
                screenshotData.screenshotResult = {
                  success: false,
                  error: extScreenshot.error,
                  captureTimeMs: extScreenshot.captureTimeMs,
                };
              }
              
              // Store Jina text content for dual analysis (used in settlement archive-first flow)
              if (jinaResult.success && jinaResult.content) {
                (screenshotData as any).jinaTextContent = jinaResult.content;
              }

              // Build digest from Jina content + raw HTML supplements
              const digestParts: string[] = [];
              digestParts.push(`URL: ${url}`);
              digestParts.push(`FETCHED_AT: ${fetchedAt}`);

              if (jinaResult.title) digestParts.push(`TITLE: ${jinaResult.title}`);
              if (jinaResult.description) digestParts.push(`META_DESCRIPTION: ${jinaResult.description}`);

              if (jinaResult.success && jinaResult.content) {
                const jinaKeyLines = collectKeyLines(jinaResult.content, [
                  input.metric,
                  ...(input.description ? input.description.split(/\s+/).slice(0, 8) : []),
                ]);
                console.log(`[Metric-AI] 🔑 Jina key lines extracted for ${url}:`, {
                  keyLinesFound: jinaKeyLines.length,
                  totalContentChars: jinaResult.content.length,
                  sample: jinaKeyLines[0]?.slice(0, 120) || null,
                });
                if (jinaKeyLines.length > 0) {
                  digestParts.push(`RENDERED_CONTENT_KEY_LINES (JS-rendered via Jina Reader):`);
                  for (const line of jinaKeyLines.slice(0, 30)) digestParts.push(`- ${line.slice(0, 500)}`);
                }
              } else if (jinaResult.error) {
                digestParts.push(`JINA_READER_ERROR: ${jinaResult.error.slice(0, 200)}`);
              }

              // Supplement with raw HTML for structured data extraction
              if (htmlResponse?.ok) {
                const htmlRaw = (await htmlResponse.text()).slice(0, MAX_RAW_HTML_CHARS);
                const jsonLd = extractJsonLdPrices(htmlRaw);
                const chart = extractChartSignals(htmlRaw);
                const candidates = extractNumericCandidates(htmlRaw);

                console.log(`[Metric-AI] 📊 Raw HTML structured data for ${url}:`, {
                  jsonLdPrices: jsonLd.length,
                  numericCandidates: candidates.length,
                  chartDerivedClose: chart.derivedClose || null,
                  chartSnippets: chart.snippets.length,
                  usingRawHtmlAsFallback: !jinaResult.success,
                });

                if (!jinaResult.success) {
                  console.log(`[Metric-AI] ⚠️ Jina failed — falling back to raw HTML text extraction for ${url}`);
                  const meta = extractMetaTags(htmlRaw);
                  if (meta.title) digestParts.push(`TITLE: ${meta.title}`);
                  if (meta.description) digestParts.push(`META_DESCRIPTION: ${meta.description}`);
                  const textLines = stripTagsToLines(htmlRaw);
                  const keyLines = collectKeyLines(textLines, [
                    input.metric,
                    ...(input.description ? input.description.split(/\s+/).slice(0, 8) : []),
                  ]);
                  if (keyLines.length > 0) {
                    digestParts.push(`KEY_LINES (raw HTML fallback):`);
                    for (const line of keyLines) digestParts.push(`- ${line.slice(0, 500)}`);
                  }
                }

                if (jsonLd.length) {
                  digestParts.push(
                    `JSON_LD_PRICE_CANDIDATES: ${jsonLd.slice(0, 6)
                      .map(x => `${x.price}${x.currency ? ' ' + x.currency : ''}${x.context ? ' (' + x.context + ')' : ''}`)
                      .join(' | ')}`
                  );
                }
                if (candidates.length) {
                  digestParts.push(`NUMERIC_CANDIDATES:`);
                  for (const c of candidates.slice(0, 18)) digestParts.push(`- ${c.label}: ${c.value} (${c.context})`);
                }
                if (chart.derivedClose) {
                  digestParts.push(`CHART_DERIVED_LAST_CLOSE: ${chart.derivedClose}`);
                  if (chart.derivedOhlc) digestParts.push(`CHART_DERIVED_OHLC: ${JSON.stringify(chart.derivedOhlc).slice(0, 500)}`);
                }
              } else if (!htmlResponse?.ok) {
                console.log(`[Metric-AI] ⚠️ Raw HTML fetch failed for ${url} — structured data extraction skipped`);
              }

              const digest = digestParts.join('\n').slice(0, MAX_SOURCE_DIGEST_CHARS);
              console.log(`[Metric-AI] 📋 Digest built for ${url}:`, {
                digestLength: digest.length,
                maxAllowed: MAX_SOURCE_DIGEST_CHARS,
                sources: [
                  jinaResult.success ? 'jina-text' : null,
                  extScreenshot?.success ? 'jina-screenshot' : null,
                  htmlResponse?.ok ? 'raw-html' : null,
                ].filter(Boolean).join(', '),
              });
              return { url, digest, screenshotData };
          } catch {
            return { url, digest: null, screenshotData };
          }
        });

        const urlResults = await Promise.all(urlProcessingPromises);
        const phase1DurationMs = Date.now() - started;

        for (const result of urlResults) {
          if (result.digest) texts.push(`SOURCE:\n${result.digest}`);
          screenshotDataMap.set(result.url, result.screenshotData);
        }

        const htmlSuccessCount = texts.length;
        const screenshotSuccessCount = Array.from(screenshotDataMap.values()).filter(d => d.screenshotResult?.success).length;
        
        console.log('[Metric-AI] ✓ Phase 1 complete', {
          jobId, phase1DurationMs,
          mode: 'jina-reader',
          htmlSourcesExtracted: htmlSuccessCount,
          screenshotsCaptured: screenshotSuccessCount,
          totalUrls: input.urls.length,
        });

        // Settlement Wayback URLs - declared at this scope for use in resolution object
        // In archive-first mode, these are set from Phase 0 archiving
        // In fallback mode, these are set from Phase 2b screenshot archiving
        let settlementWaybackUrl: string | null = null;
        let settlementWaybackTimestamp: string | null = null;
        let settlementWaybackPageUrl: string | null = null;
        
        // In archive-first mode, populate settlement URLs from the already-archived pages
        if (archiveFirstFlow) {
          const firstArchivedEntry = Array.from(analyzedUrlsMap.values()).find(e => e.isArchived);
          if (firstArchivedEntry) {
            settlementWaybackUrl = firstArchivedEntry.analyzedUrl;
            settlementWaybackTimestamp = firstArchivedEntry.waybackTimestamp || null;
            settlementWaybackPageUrl = firstArchivedEntry.analyzedUrl;
          }
        }

        // --- Phase 2: Upload screenshots + multi-model vision consensus ---
        if (ENABLE_VISION_ANALYSIS) {
          console.log('[Metric-AI] 🖼️ Phase 2: Screenshots + multi-model vision consensus', { jobId });
          
          const screenshotsToProcess = Array.from(screenshotDataMap.values())
            .filter(data => data.screenshotResult?.success && data.screenshotResult.base64);
          
          if (input.context === 'settlement') {
            console.log('[Metric-AI] 📤 Phase 2a: Uploading screenshots to Supabase (settlement run)');
            const uploadPromises = screenshotsToProcess.map(async (data) => {
              if (!data.screenshotResult?.base64) return;
              try {
                data.uploadResult = await uploadScreenshot(data.screenshotResult.base64, jobId, data.url);
              } catch {}
            });
            await Promise.all(uploadPromises);

            // In archive-first mode, we already archived the live pages in Phase 0
            // Now we archive the SCREENSHOTS of those archived pages for additional evidence
            if (archiveFirstFlow) {
              console.log('[Metric-AI] 📦 Phase 2b: Archiving screenshots of archived pages (archive-first mode)');
              const { archiveMulti } = await import('../../../lib/archiveMulti');
              
              // Collect screenshot public URLs from successful uploads
              const screenshotPublicUrls: { sourceUrl: string; screenshotUrl: string }[] = [];
              for (const [url, data] of screenshotDataMap) {
                if (data.uploadResult?.publicUrl) {
                  screenshotPublicUrls.push({ sourceUrl: url, screenshotUrl: data.uploadResult.publicUrl });
                }
              }
              
              if (screenshotPublicUrls.length > 0) {
                const screenshotArchiveResults = await Promise.allSettled(
                  screenshotPublicUrls.map(({ screenshotUrl }) => archiveMulti(screenshotUrl, { totalTimeoutMs: 30_000 }))
                );
                
                for (let i = 0; i < screenshotArchiveResults.length; i++) {
                  const r = screenshotArchiveResults[i];
                  const { sourceUrl, screenshotUrl } = screenshotPublicUrls[i];
                  if (r.status === 'fulfilled' && r.value.success && r.value.primaryUrl) {
                    const successCount = r.value.archives.filter((a: any) => a.success).length;
                    console.log(`[Metric-AI] ✓ Screenshot archived to ${successCount} provider(s): ${screenshotUrl} → ${r.value.primaryUrl}`);
                    const matchingData = screenshotDataMap.get(sourceUrl);
                    if (matchingData) {
                      (matchingData as any).waybackScreenshotUrl = r.value.primaryUrl;
                      (matchingData as any).archiveSnapshots = r.value.archives.filter((a: any) => a.success);
                    }
                  }
                }
              }
              
              console.log('[Metric-AI] ✓ Phase 2b complete (archive-first): Primary evidence from Phase 0 archiving', {
                primaryEvidenceUrl: settlementWaybackUrl,
                archiveFirstFlow: true,
              });
              
            } else {
              // FALLBACK MODE: Archive screenshots and live pages (original behavior)
              // This ensures the archive snapshots capture the exact same content the AI analyzed
              console.log('[Metric-AI] 📦 Phase 2b: Multi-archiving (FALLBACK mode - archiving live content)');
              const { archiveMulti } = await import('../../../lib/archiveMulti');

              // Collect screenshot public URLs from successful uploads
              const screenshotPublicUrls: { sourceUrl: string; screenshotUrl: string }[] = [];
              for (const [url, data] of screenshotDataMap) {
                if (data.uploadResult?.publicUrl) {
                  screenshotPublicUrls.push({ sourceUrl: url, screenshotUrl: data.uploadResult.publicUrl });
                }
              }

              const sourceUrls = input.urls.slice(0, 3);
              console.log(`[Metric-AI] 📦 Multi-archiving: ${screenshotPublicUrls.length} screenshot(s) + ${sourceUrls.length} source URL(s)`);

              // Archive screenshots (PRIMARY evidence) and original pages (secondary) in parallel to MULTIPLE archives
              const [screenshotArchiveResults, pageArchiveResults] = await Promise.all([
                Promise.allSettled(
                  screenshotPublicUrls.map(({ screenshotUrl }) => archiveMulti(screenshotUrl, { totalTimeoutMs: 30_000 }))
                ),
                Promise.allSettled(
                  sourceUrls.map((url) => archiveMulti(url, { totalTimeoutMs: 30_000 }))
                ),
              ]);

              // Process screenshot archive results (PRIMARY evidence - congruent with AI analysis)
              for (let i = 0; i < screenshotArchiveResults.length; i++) {
                const r = screenshotArchiveResults[i];
                const { sourceUrl, screenshotUrl } = screenshotPublicUrls[i];
                if (r.status === 'fulfilled' && r.value.success && r.value.primaryUrl) {
                  const successCount = r.value.archives.filter((a: any) => a.success).length;
                  console.log(`[Metric-AI] ✓ Screenshot archived to ${successCount} provider(s) (PRIMARY): ${screenshotUrl} → ${r.value.primaryUrl}`);
                  if (i === 0) {
                    settlementWaybackUrl = r.value.primaryUrl;
                    // Try to get timestamp from IA result if available
                    const iaResult = r.value.archives.find((a: any) => a.provider === 'internet_archive' && a.success);
                    settlementWaybackTimestamp = iaResult?.timestamp || null;
                  }
                  // Store all archive URLs on screenshotDataMap for later use in sources
                  const matchingData = screenshotDataMap.get(sourceUrl);
                  if (matchingData) {
                    (matchingData as any).waybackScreenshotUrl = r.value.primaryUrl;
                    (matchingData as any).archiveSnapshots = r.value.archives.filter((a: any) => a.success);
                  }
                } else {
                  const reason = r.status === 'rejected' ? r.reason?.message : r.value?.error;
                  console.warn(`[Metric-AI] ⚠ Screenshot multi-archive failed for ${screenshotUrl}: ${reason || 'unknown'}`);
                }
              }

              // Process original page archive results (secondary - best-effort, may differ from screenshot)
              for (let i = 0; i < pageArchiveResults.length; i++) {
                const r = pageArchiveResults[i];
                if (r.status === 'fulfilled' && r.value.success && r.value.primaryUrl) {
                  const successCount = r.value.archives.filter((a: any) => a.success).length;
                  console.log(`[Metric-AI] ✓ Page archived to ${successCount} provider(s) (secondary): ${sourceUrls[i]} → ${r.value.primaryUrl}`);
                  if (i === 0) {
                    settlementWaybackPageUrl = r.value.primaryUrl;
                  }
                  // Store all archive URLs on screenshotDataMap for later use in sources
                  const matchingData = screenshotDataMap.get(sourceUrls[i]);
                  if (matchingData) {
                    (matchingData as any).waybackPageUrl = r.value.primaryUrl;
                    const iaPageResult = r.value.archives.find((a: any) => a.provider === 'internet_archive' && a.success);
                    (matchingData as any).waybackPageTimestamp = iaPageResult?.timestamp || null;
                    (matchingData as any).pageArchiveSnapshots = r.value.archives.filter((a: any) => a.success);
                  }
                } else {
                  const reason = r.status === 'rejected' ? r.reason?.message : r.value?.error;
                  console.warn(`[Metric-AI] ⚠ Page multi-archive failed for ${sourceUrls[i]}: ${reason || 'unknown'}`);
                }
              }

              console.log('[Metric-AI] ✓ Phase 2b complete (fallback): Multi-archival done BEFORE AI analysis', {
                primaryEvidenceUrl: settlementWaybackUrl,
                secondaryPageUrl: settlementWaybackPageUrl,
              });
            }
          }

          console.log('[Metric-AI] 👁️ Phase 2c: Running multi-model vision consensus', { jobId, screenshotsToAnalyze: screenshotsToProcess.length });
          
          const visionPromises = screenshotsToProcess.map(async (data) => {
            if (!data.screenshotResult?.base64) return;
            try {
              const consensus = await analyzeWithConsensus(
                data.screenshotResult.base64,
                input.metric,
                { description: input.description, expectedRange: visionExpectedRange }
              );
              data.visionConsensus = consensus;
              console.log(`[Metric-AI] Vision consensus:`, {
                agreement: consensus.agreement, value: consensus.value,
                numericValue: consensus.numericValue, confidence: consensus.confidence?.toFixed(2),
                modelsSucceeded: consensus.models.filter(m => m.success).length,
              });
              const bestModel = consensus.models.find(m => m.success);
              console.log(`[Metric-AI] Best model:`, bestModel ? { model: bestModel.model, success: bestModel.success, value: bestModel.value } : 'NONE');
              if (bestModel) {
                data.visionResult = {
                  success: true,
                  value: consensus.value,
                  numericValue: consensus.numericValue !== undefined ? String(consensus.numericValue) : bestModel.numericValue,
                  confidence: consensus.confidence,
                  visualQuote: bestModel.visualQuote,
                };
                console.log(`[Metric-AI] Set visionResult:`, { success: data.visionResult.success, value: data.visionResult.value, numericValue: data.visionResult.numericValue });
              }
            } catch (err: any) {
              console.error(`[Metric-AI] Vision consensus ERROR:`, err?.message || err);
            }
          });
          await Promise.all(visionPromises);

          // Jina screenshots used — no separate full-page fallback needed.

          const visionSuccessCount = Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length;
          console.log('[Metric-AI] ✓ Vision analysis complete', { jobId, visionSuccessCount });
          
          // ═══════════════════════════════════════════════════════════════════════════
          // DUAL ANALYSIS: Extract numeric value from text content AND compare with vision
          // For settlement context, we use both text extraction and vision analysis
          // to increase confidence in the extracted value.
          // ═══════════════════════════════════════════════════════════════════════════
          if (input.context === 'settlement' && archiveFirstFlow) {
            console.log('[Metric-AI] 🔍 Phase 2d: Dual Analysis (text + vision comparison)');
            
            // Extract numeric value from text content using LLM
            const textExtractionPromise = (async () => {
              // Collect all text content from Jina extractions
              const textContents: string[] = [];
              for (const [, data] of screenshotDataMap) {
                if ((data as any).jinaTextContent) {
                  textContents.push((data as any).jinaTextContent);
                }
              }
              
              // Also use the digest texts we collected
              const allTextContent = [...textContents, ...texts].join('\n\n---\n\n').slice(0, 50_000);
              
              if (!allTextContent || allTextContent.length < 50) {
                console.log('[Metric-AI] ⚠ No text content available for text extraction');
                return null;
              }
              
              try {
                const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
                const textExtractionPrompt = `You are extracting a precise numeric value from archived webpage content.

METRIC TO EXTRACT: "${input.metric}"
${input.description ? `DESCRIPTION: "${input.description}"` : ''}

INSTRUCTIONS:
1. Find the EXACT current value for the specified metric in the content below
2. Return ONLY the numeric value (no currency symbols, units, or text)
3. Use decimal notation (e.g., 95123.45, not "$95,123.45")
4. If multiple values exist, use the most recent/current one
5. If the value cannot be found, respond with "NOT_FOUND"

ARCHIVED PAGE CONTENT:
${allTextContent.slice(0, 30_000)}

EXTRACTED NUMERIC VALUE:`;

                const textResponse = await openai.chat.completions.create({
                  model: OPENAI_MODEL_FAST,
                  messages: [{ role: 'user', content: textExtractionPrompt }],
                  temperature: 0,
                  max_tokens: 100,
                });
                
                const extractedText = textResponse.choices[0]?.message?.content?.trim() || '';
                
                if (extractedText === 'NOT_FOUND' || !extractedText) {
                  console.log('[Metric-AI] ⚠ Text extraction could not find value');
                  return null;
                }
                
                // Parse the numeric value
                const cleanedValue = extractedText.replace(/[^0-9.+-]/g, '');
                const numericValue = parseFloat(cleanedValue);
                
                if (!Number.isFinite(numericValue)) {
                  console.log('[Metric-AI] ⚠ Text extraction returned non-numeric:', extractedText);
                  return null;
                }
                
                console.log('[Metric-AI] ✓ Text extraction result:', { 
                  rawValue: extractedText, 
                  numericValue 
                });
                return numericValue;
              } catch (err: any) {
                console.error('[Metric-AI] Text extraction error:', err?.message || err);
                return null;
              }
            })();
            
            // Wait for text extraction
            textExtractedValue = await textExtractionPromise;
            
            // Get vision extracted value from the best consensus
            const bestVisionConsensus = Array.from(screenshotDataMap.values())
              .map(d => d.visionConsensus)
              .filter((c): c is VisionConsensus => !!c && c.numericValue !== undefined)
              .sort((a, b) => b.confidence - a.confidence)[0];
            
            if (bestVisionConsensus?.numericValue !== undefined) {
              visionExtractedValue = bestVisionConsensus.numericValue;
            }
            
            // Compare text and vision values for confidence
            if (textExtractedValue !== null && visionExtractedValue !== null) {
              const tolerance = 0.01; // 1% tolerance
              const diff = Math.abs(textExtractedValue - visionExtractedValue);
              const maxVal = Math.max(Math.abs(textExtractedValue), Math.abs(visionExtractedValue));
              const relativeDiff = maxVal > 0 ? diff / maxVal : 0;
              
              extractionConfidenceMatch = relativeDiff < tolerance;
              
              if (extractionConfidenceMatch) {
                valueSource = 'consensus';
                console.log('[Metric-AI] ✓ DUAL ANALYSIS: Text and Vision AGREE', {
                  textValue: textExtractedValue,
                  visionValue: visionExtractedValue,
                  relativeDiff: (relativeDiff * 100).toFixed(3) + '%',
                });
              } else {
                // Prefer vision value when there's a mismatch (more reliable for rendered content)
                valueSource = 'vision';
                console.warn('[Metric-AI] ⚠ DUAL ANALYSIS: Text/Vision MISMATCH', {
                  textValue: textExtractedValue,
                  visionValue: visionExtractedValue,
                  relativeDiff: (relativeDiff * 100).toFixed(3) + '%',
                  using: 'vision (more reliable for rendered content)',
                });
              }
            } else if (visionExtractedValue !== null) {
              valueSource = 'vision';
              console.log('[Metric-AI] ℹ Using vision value only (text extraction unavailable)');
            } else if (textExtractedValue !== null) {
              valueSource = 'text';
              console.log('[Metric-AI] ℹ Using text value only (vision extraction unavailable)');
            } else {
              valueSource = 'fallback';
              console.warn('[Metric-AI] ⚠ Both text and vision extraction failed, will rely on fusion');
            }
            
            console.log('[Metric-AI] ✓ Phase 2d complete: Dual analysis done', {
              textExtractedValue,
              visionExtractedValue,
              extractionConfidenceMatch,
              valueSource,
            });
          }
        }

        // --- Build evidence sections for the enhanced prompt ---
        const locatorEvidenceParts: string[] = [];
        const visionConsensusParts: string[] = [];
        const renderedDomParts: string[] = [];
        const visionEvidenceParts: string[] = [];
        const screenshotFailures: string[] = [];

        for (const [url, data] of screenshotDataMap) {
          if (data.screenshotResult && !data.screenshotResult.success) {
            screenshotFailures.push(`${url}: ${(data.screenshotResult.error || 'Unknown error').slice(0, 150)}`);
          }

          // Locator evidence
          if (data.screenshotResult?.locatorExtractedValue) {
            locatorEvidenceParts.push(`LOCATOR_EXTRACTED (${url}, method: ${data.screenshotResult.locatorMethod}): ${data.screenshotResult.locatorExtractedValue}`);
          }

          // Multi-model vision consensus
          if (data.visionConsensus) {
            visionConsensusParts.push(`VISION_CONSENSUS (${url}):`);
            visionConsensusParts.push(`- Agreement: ${data.visionConsensus.agreement}`);
            visionConsensusParts.push(`- Consensus Value: ${data.visionConsensus.value || 'N/A'}`);
            visionConsensusParts.push(`- Confidence: ${data.visionConsensus.confidence.toFixed(2)}`);
            visionConsensusParts.push(`- ${data.visionConsensus.summary}`);
            for (const m of data.visionConsensus.models) {
              const status = m.success ? `${m.numericValue} (conf: ${m.confidence?.toFixed(2)})` : `FAILED: ${m.error?.slice(0, 80)}`;
              visionConsensusParts.push(`  - ${m.model}: ${status}`);
            }
          } else if (data.visionResult?.success) {
            visionEvidenceParts.push(`VISION_ANALYSIS (${url}):`);
            if (data.visionResult.value) visionEvidenceParts.push(`- Extracted Value: ${data.visionResult.value}`);
            if (data.visionResult.numericValue) visionEvidenceParts.push(`- Numeric Value: ${data.visionResult.numericValue}`);
            visionEvidenceParts.push(`- Confidence: ${data.visionResult.confidence?.toFixed(2) || 'N/A'}`);
            if (data.visionResult.visualQuote) visionEvidenceParts.push(`- Visual Quote: ${data.visionResult.visualQuote.slice(0, 300)}`);
          }

          // Rendered DOM text summary
          if (data.screenshotResult?.renderedText) {
            const preview = data.screenshotResult.renderedText.slice(0, 500).replace(/\n+/g, ' | ');
            renderedDomParts.push(`RENDERED_DOM (${url}): ${preview}`);
          }
        }

        const successfulScreenshots = Array.from(screenshotDataMap.values()).filter(d => d.screenshotResult?.success).length;
        const totalUrls = input.urls.length;

        // --- Phase 3: Three-tier fusion ---
        //
        // Tier 1 — Vision short-circuit: full consensus agreement at high
        //          confidence → use the vision value directly, skip OpenAI.
        // Tier 2 — Lightweight fusion: partial vision/locator evidence →
        //          trimmed prompt + gpt-4.1-mini.
        // Tier 3 — Full fusion: no vision data → full prompt + gpt-4.1.

        // Collect the strongest vision consensus across all URLs (before building prompts).
        const allConsensus = Array.from(screenshotDataMap.values())
          .map(d => d.visionConsensus)
          .filter((c): c is VisionConsensus => !!c);
        const bestConsensus = allConsensus
          .filter(c => c.agreement === 'full' && c.numericValue !== undefined)
          .sort((a, b) => b.confidence - a.confidence)[0] || null;

        const visionHint = bestConsensus?.numericValue ?? pickVisionNumericHint(screenshotDataMap);
        const statsForHistoricalPrompt =
          typeof visionHint === 'number' && Number.isFinite(visionHint) && visionHint > 0
            ? alignHistoricalStatsToExtracted(historicalStats, visionHint)
            : historicalStats;
        const historicalPrompt = formatHistoricalContextForPrompt(statsForHistoricalPrompt);

        let json: any;
        let fusionTier: 'vision_shortcircuit' | 'lightweight' | 'full';
        let fusionPrompt: string | null = null;
        let fusionModel: string | null = null;

        const hasAnyVisionOrLocator = visionConsensusParts.length > 0 ||
          visionEvidenceParts.length > 0 ||
          locatorEvidenceParts.length > 0;

        // ── Tier 1: Vision short-circuit ────────────────────────────────
        if (bestConsensus && bestConsensus.confidence >= VISION_SHORTCIRCUIT_CONFIDENCE) {
          fusionTier = 'vision_shortcircuit';
          const numVal = bestConsensus.numericValue!;
          const strVal = String(numVal);

          const visionSources = Array.from(screenshotDataMap.entries())
            .filter(([, d]) => d.visionConsensus || d.visionResult?.success)
            .map(([url, d]) => ({
              url,
              quote: d.visionResult?.visualQuote?.slice(0, 300) || bestConsensus.summary.slice(0, 300),
              match_score: bestConsensus.confidence,
            }));

          json = {
            value: strVal,
            unit: 'unknown',
            confidence: bestConsensus.confidence,
            asset_price_suggestion: strVal,
            reasoning: bestConsensus.summary,
            source_quotes: visionSources,
          };

          console.log('[Metric-AI] ⚡ Phase 3 TIER 1: Vision short-circuit (OpenAI skipped)', {
            jobId,
            value: strVal,
            confidence: bestConsensus.confidence.toFixed(2),
            agreement: bestConsensus.agreement,
            modelsUsed: bestConsensus.models.filter(m => m.success).map(m => m.model).join(', '),
          });

        // ── Tier 2: Lightweight fusion ──────────────────────────────────
        } else if (hasAnyVisionOrLocator) {
          fusionTier = 'lightweight';
          fusionModel = OPENAI_MODEL_FAST;

          // Trimmed prompt: only vision + locator + top key lines + historical
          const topKeyLines = texts
            .join('\n')
            .split('\n')
            .filter(l => /KEY_LINES:|^- /.test(l))
            .slice(0, 15);

          fusionPrompt = [
            `METRIC: ${input.metric}`,
            input.description ? `DESCRIPTION: ${input.description}` : '',
            `TASK: Determine the current numeric value and a tradable asset_price_suggestion.`,
            `Return JSON: { "value": "...", "confidence": 0.0-1.0, "asset_price_suggestion": "123.45", "reasoning": "...", "source_quotes": [{ "url": "...", "quote": "...", "match_score": 0.0-1.0 }] }`,
            ``,
            `EVIDENCE (use the best available; cite it):`,
            `- LOCATOR_EXTRACTED_VALUE: highest trust (pre-validated selector).`,
            `- VISION_CONSENSUS: multi-model screenshot analysis.`,
            `- KEY_LINES: pattern-matched from HTML.`,
            ``,
            `OUTPUT RULES:`,
            `- asset_price_suggestion: numeric only, no units, 5 significant figures.`,
            `- If your result differs from HISTORICAL CONTEXT, explain why.`,
            ``,
            historicalPrompt,
            locatorEvidenceParts.length > 0 ? `\nLOCATOR EVIDENCE:\n${locatorEvidenceParts.join('\n')}` : '',
            visionConsensusParts.length > 0 ? `\nVISION CONSENSUS:\n${visionConsensusParts.join('\n')}` : '',
            visionEvidenceParts.length > 0 ? `\nVISION EVIDENCE:\n${visionEvidenceParts.join('\n')}` : '',
            topKeyLines.length > 0 ? `\nKEY LINES:\n${topKeyLines.join('\n')}` : '',
          ].filter(Boolean).join('\n');

          const openaiStartTime = Date.now();
          console.log('[Metric-AI] 🤖 Phase 3 TIER 2: Lightweight fusion', {
            jobId, model: fusionModel, promptLength: fusionPrompt.length,
          });

          const resp = await openai.chat.completions.create({
            model: fusionModel,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
              { role: 'user', content: fusionPrompt },
            ],
            max_tokens: 1400,
          });

          const openaiDurationMs = Date.now() - openaiStartTime;
          console.log('[Metric-AI] ✓ Tier 2 response received', {
            jobId, openaiDurationMs,
            finishReason: resp.choices[0]?.finish_reason,
            totalTokens: resp.usage?.total_tokens,
          });

          let raw = resp.choices[0]?.message?.content?.trim() || '{}';
          try { raw = raw.replace(/```json|```/g, '').trim(); } catch {}
          json = JSON.parse(raw);

        // ── Tier 3: Full fusion (existing behavior) ─────────────────────
        } else {
          fusionTier = 'full';
          fusionModel = OPENAI_MODEL_FULL;

          fusionPrompt = [
            `METRIC: ${input.metric}`,
            input.description ? `DESCRIPTION: ${input.description}` : '',
            `TASK: Determine the current numeric value and a tradable asset_price_suggestion.`,
            `Return JSON: { "value": "...", "confidence": 0.0-1.0, "asset_price_suggestion": "123.45", "reasoning": "...", "source_quotes": [{ "url": "...", "quote": "...", "match_score": 0.0-1.0 }] }`,
            ``,
            `EVIDENCE PRIORITY (highest trust to lowest — use the best available; cite it):`,
            `1. LOCATOR_EXTRACTED_VALUE — Pre-validated CSS/XPath/JS selector from market creation. If present and numeric, this is almost certainly correct.`,
            `2. VISION_CONSENSUS — Multi-model agreement on screenshot analysis (GPT-4o + Claude + Gemini). Higher agreement = higher trust.`,
            `3. RENDERED_DOM_KEY_LINES — JS-rendered page content captured by headless browser. More reliable than raw HTML for dynamic pages.`,
            `4. JSON_LD_PRICE_CANDIDATES — Structured pricing from schema.org markup.`,
            `5. CHART_DERIVED_LAST_CLOSE — OHLC data extracted from inline scripts.`,
            `6. KEY_LINES / NUMERIC_CANDIDATES — Pattern-matched from raw HTML (lowest trust).`,
            ``,
            `CROSS-VALIDATION (IMPORTANT):`,
            `- When multiple evidence types AGREE on the value, boost confidence significantly.`,
            `- When they DISAGREE, prefer higher-priority evidence but reduce confidence and explain the discrepancy.`,
            `- If only one source type has data, use it but note in reasoning that cross-validation was not possible.`,
            ``,
            `DISAMBIGUATION RULES:`,
            `- Ignore numbers that look like axis ticks, timestamps, percent changes, volumes, page counters, or unrelated KPIs.`,
            `- If multiple plausible candidates exist, choose the one most consistent with the metric name/description and HISTORICAL CONTEXT.`,
            ``,
            `OUTPUT RULES:`,
            `- asset_price_suggestion must be the best tradable "quote-like" number (not an axis label). Numeric only, no units.`,
            `- The final numeric price MUST have exactly 5 significant figures (use standard rounding).`,
            `- If your result differs significantly from HISTORICAL CONTEXT, explain why in your reasoning.`,
            ``,
            `CHART RULES:`,
            `- Prefer the latest CLOSE for OHLC/candlestick data, not OPEN.`,
            ``,
            `MISSING DATA:`,
            `- You MUST still return a result even if some evidence types are missing.`,
            `- If both HTML and vision fail completely, return value: "N/A", asset_price_suggestion: "0", confidence <= 0.2.`,
            ``,
            historicalPrompt,
            locatorEvidenceParts.length > 0 ? `\nLOCATOR EVIDENCE:\n${locatorEvidenceParts.join('\n')}` : '',
            visionConsensusParts.length > 0 ? `\nVISION CONSENSUS:\n${visionConsensusParts.join('\n')}` : '',
            visionEvidenceParts.length > 0 ? `\nVISION EVIDENCE:\n${visionEvidenceParts.join('\n')}` : '',
            screenshotFailures.length > 0 ? `\nSCREENSHOT FAILURES (${screenshotFailures.length}/${totalUrls}):\n${screenshotFailures.map(f => `- ${f}`).join('\n')}` : '',
            `\nHTML SOURCES:`,
            texts.join('\n\n').slice(0, MAX_SOURCES_JOIN_CHARS),
          ].filter(Boolean).join('\n');

          const openaiStartTime = Date.now();
          console.log('[Metric-AI] 🤖 Phase 3 TIER 3: Full fusion', {
            jobId, model: fusionModel, promptLength: fusionPrompt.length,
            hasLocatorEvidence: locatorEvidenceParts.length > 0,
            hasVisionConsensus: visionConsensusParts.length > 0,
            hasHistoricalContext: historicalStats.source !== 'none',
          });

          const resp = await openai.chat.completions.create({
            model: fusionModel,
            response_format: { type: 'json_object' },
            messages: [
              { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
              { role: 'user', content: fusionPrompt },
            ],
            max_tokens: 1400,
          });

          const openaiDurationMs = Date.now() - openaiStartTime;
          console.log('[Metric-AI] ✓ Tier 3 response received', {
            jobId, openaiDurationMs,
            finishReason: resp.choices[0]?.finish_reason,
            totalTokens: resp.usage?.total_tokens,
          });

          let raw = resp.choices[0]?.message?.content?.trim() || '{}';
          try { raw = raw.replace(/```json|```/g, '').trim(); } catch {}
          json = JSON.parse(raw);
        }

        // --- Phase 4: Post-extraction validation ---
        const validation = validateExtractedValue(json.asset_price_suggestion, historicalStats);
        let validationWarning: string | undefined;
        if (!validation.valid && validation.warnings.length > 0) {
          console.warn('[Metric-AI] ⚠ Value flagged by validator', { jobId, warnings: validation.warnings });

          // Second opinion only when an OpenAI call was made (skip for vision short-circuit)
          if (validation.maxConfidence <= 0.3 && fusionTier !== 'vision_shortcircuit' && fusionPrompt) {
            try {
              const secondOpinionModel = fusionModel || OPENAI_MODEL_FULL;
              const secondOpinionExtracted = Number(
                String(json.asset_price_suggestion ?? '').replace(/[^0-9.+-eE]/g, '')
              );
              const statsForSecondOpinion = alignHistoricalStatsToExtracted(
                historicalStats,
                Number.isFinite(secondOpinionExtracted) && secondOpinionExtracted > 0 ? secondOpinionExtracted : 0
              );
              const secondOpinion = buildSecondOpinionPrompt(
                json.asset_price_suggestion,
                validation.warnings,
                statsForSecondOpinion
              );
              console.log('[Metric-AI] 🔄 Requesting second opinion from AI', { model: secondOpinionModel });
              const resp2 = await openai.chat.completions.create({
                model: secondOpinionModel,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
                  { role: 'user', content: fusionPrompt + '\n\n' + secondOpinion }
                ],
                max_tokens: 1400
              });
              let content2 = resp2.choices[0]?.message?.content?.trim() || '';
              try { content2 = content2.replace(/```json|```/g, '').trim(); } catch {}
              const json2 = JSON.parse(content2);
              const validation2 = validateExtractedValue(json2.asset_price_suggestion, historicalStats);
              if (validation2.maxConfidence > validation.maxConfidence) {
                console.log('[Metric-AI] ✓ Second opinion improved validation', {
                  original: json.asset_price_suggestion, revised: json2.asset_price_suggestion,
                });
                json = json2;
              }
            } catch {}
          }

          const finalValidation = validateExtractedValue(json.asset_price_suggestion, historicalStats);
          if (!finalValidation.valid) {
            validationWarning = finalValidation.warnings.join('; ');
            json.confidence = Math.min(json.confidence || 0.5, finalValidation.maxConfidence);
          }
        }
        
        console.log('[Metric-AI] 📋 Final result', {
          jobId,
          fusionTier,
          value: json.value,
          assetPriceSuggestion: json.asset_price_suggestion,
          confidence: json.confidence,
          validationWarning: validationWarning || null,
        });

        // Build sources with screenshot URLs
        // Build sources with screenshots and already-archived Wayback URLs (archived in Phase 2b)
        const sourcesWithScreenshots = Array.isArray(json.source_quotes) ? json.source_quotes.map((q: any) => {
          const sourceUrl = String(q.url || '');
          const screenshotData = screenshotDataMap.get(sourceUrl) as any;
          return {
            url: sourceUrl,
            screenshot_url: screenshotData?.uploadResult?.publicUrl || '',
            quote: String(q.quote || '').slice(0, 800),
            match_score: typeof q.match_score === 'number' ? q.match_score : 0.5,
            vision_value: screenshotData?.visionResult?.numericValue || '',
            vision_confidence: screenshotData?.visionResult?.confidence || 0,
            vision_quote: screenshotData?.visionResult?.visualQuote?.slice(0, 300) || '',
            // Use wayback URLs captured in Phase 2b (before AI analysis)
            wayback_url: screenshotData?.waybackPageUrl || null,
            wayback_timestamp: screenshotData?.waybackPageTimestamp || null,
            wayback_screenshot_url: screenshotData?.waybackScreenshotUrl || null,
          };
        }) : [];

        const totalProcessingTimeForResolution = Date.now() - started;
        
        // Check if we already have working locators (used for resolution metadata)
        // If we're here in the full pipeline, locators either didn't exist or failed
        const hadWorkingLocatorsBefore = storedLocatorData && 
          storedLocatorData.selectors.length > 0 && 
          storedLocatorData.failure_count < 3;
        
        const resolution = {
          // Core result
          metric: input.metric,
          value: json.value || 'N/A',
          asset_price_suggestion: json.asset_price_suggestion || json.value || '50.00',
          confidence: typeof json.confidence === 'number' ? Math.min(Math.max(json.confidence, 0), 1) : 0.5,
          as_of: json.as_of || new Date().toISOString(),
          
          // Pipeline metadata (concise)
          pipeline: {
            path: 'FULL_PIPELINE',
            totalTimeMs: totalProcessingTimeForResolution,
            fusionTier,
            fusionModel,
            dataSources: `HTML: ${texts.length}/${totalUrls}, Screenshots: ${successfulScreenshots}/${totalUrls}, Vision: ${Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length}/${totalUrls}`,
          },
          
          // Validation context
          validation: {
            warning: validationWarning || undefined,
            historicalSource: historicalStats.source,
            lastKnownValue: historicalStats.lastValue,
          },
          
          // Locator status for future fast-path
          locator: {
            existedBefore: !!storedLocatorData,
            wasWorking: hadWorkingLocatorsBefore,
          },
          
          reasoning: json.reasoning || '',
          sources: sourcesWithScreenshots,
          
          // Legacy fields for compatibility
          unit: json.unit || 'unknown',
          validation_warning: validationWarning || undefined,
          fusion_tier: fusionTier,
          fusion_model: fusionModel,
          vision_analysis_enabled: ENABLE_VISION_ANALYSIS,
          vision_sources_analyzed: Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length,
          vision_consensus_agreement: Array.from(screenshotDataMap.values()).find(d => d.visionConsensus)?.visionConsensus?.agreement || null,
          screenshots_captured: successfulScreenshots,
          screenshots_failed: screenshotFailures.length,
          screenshot_failure_reasons: screenshotFailures.length > 0 ? screenshotFailures : undefined,
          html_sources_extracted: texts.length,
          locator_used: !!storedLocatorData,
          locator_value: null,
          historical_context_source: historicalStats.source,
          historical_last_value: historicalStats.lastValue,
          data_sources_summary: `HTML: ${texts.length}/${totalUrls}, Screenshots: ${successfulScreenshots}/${totalUrls}, Vision: ${Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length}/${totalUrls}`,
          settlement_wayback_url: settlementWaybackUrl,
          settlement_wayback_timestamp: settlementWaybackTimestamp,
          settlement_wayback_page_url: settlementWaybackPageUrl,
          archive_first_flow: archiveFirstFlow,
          archive_fallback_used: archiveFallbackUsed,
          analyzed_urls: Array.from(analyzedUrlsMap.values()),
          text_extracted_value: textExtractedValue,
          vision_extracted_value: visionExtractedValue,
          extraction_confidence_match: extractionConfidenceMatch,
          value_source: valueSource,
        };

        let resolutionId: string | null = null;
        try {
          const { data, error } = await supabase
            .from('metric_oracle_resolutions')
            .insert([{
              metric_name: input.metric,
              metric_description: input.description || null,
              source_urls: input.urls,
              resolution_data: resolution,
              confidence_score: resolution.confidence,
              processing_time_ms: Date.now() - started,
              user_address: input.user_address || null,
              related_market_id: input.related_market_id || input.related_market_identifier || null,
              created_at: new Date()
            }])
            .select('id')
            .single();
          if (error) throw error;
          resolutionId = data?.id || null;
        } catch (e) { /* log-only */ }

        if (resolutionId && (input.related_market_id || input.related_market_identifier)) {
          const update: any = { metric_resolution_id: resolutionId, updated_at: new Date().toISOString() };
          try {
            if (input.related_market_id) {
              await supabase.from('markets').update(update).eq('id', input.related_market_id);
            } else {
              await supabase.from('markets').update(update).eq('market_identifier', input.related_market_identifier);
            }
            console.log('[Metric-AI] ✓ Market linked to resolution', { jobId, resolutionId });
          } catch {}
        }

        // --- Phase 5: Auto-discover locators for fast-path reuse ---
        // Discover locators anytime we ran full pipeline and got a confident result
        // This enables fast-path for ALL future fetches (live tracking, settlement, etc.)
        // Only skip if we already have working locators (we used fast-path above)
        const rawAiConfidence = typeof json.confidence === 'number' ? json.confidence : 0;
        const hasVisionAgreement = resolution.vision_consensus_agreement === 'full' || resolution.vision_consensus_agreement === 'partial';
        const discoveryEligible = rawAiConfidence >= 0.7 || hasVisionAgreement;
        
        pipelineLog('LOCATOR_DISCOVERY_CHECK', {
          hadWorkingLocatorsBefore,
          hasMarketId: !!marketId,
          rawAiConfidence,
          hasVisionAgreement,
          discoveryEligible,
          hasValidValue: resolution.asset_price_suggestion && resolution.asset_price_suggestion !== '0',
          hasUrls: input.urls.length > 0,
          context: input.context || 'none',
          decision: (!hadWorkingLocatorsBefore && marketId && discoveryEligible) 
            ? '🔍 WILL DISCOVER LOCATORS FOR FUTURE FAST-PATH' 
            : hadWorkingLocatorsBefore
              ? '⏭️ SKIPPING - already have working locators'
              : '⏭️ SKIPPING - confidence too low or missing data',
        });
        
        // Discover locators if:
        // 1. We don't already have working locators (or they failed)
        // 2. We have a market ID to store them against
        // 3. We got a confident extraction result
        if (
          !hadWorkingLocatorsBefore &&
          marketId &&
          discoveryEligible &&
          resolution.asset_price_suggestion &&
          resolution.asset_price_suggestion !== '0' &&
          input.urls.length > 0
        ) {
          try {
            const discoveryUrl = input.urls[0];
            const primaryEvidence = resolution.vision_consensus_agreement === 'full' ? 'vision_consensus'
              : resolution.locator_used ? 'locator'
              : 'fusion';

            pipelineLog('LOCATOR_DISCOVERY_START', {
              url: discoveryUrl,
              confirmedValue: resolution.asset_price_suggestion,
              primaryEvidence,
              purpose: 'Finding CSS selectors to enable fast-path on future fetches',
            });

            const discovered = await discoverLocators(
              discoveryUrl,
              resolution.asset_price_suggestion,
              primaryEvidence,
            );

            if (discovered) {
              await supabase.from('markets').update({
                ai_source_locator: discovered,
                updated_at: new Date().toISOString(),
              }).eq('id', marketId);

              pipelineLog('LOCATOR_DISCOVERY_SUCCESS', {
                marketId,
                selectorCount: discovered.selectors.length,
                selectors: discovered.selectors.slice(0, 3).map(s => ({
                  type: s.type,
                  selector: s.selector?.slice(0, 80),
                  confidence: s.confidence,
                  sampleValue: s.sample_value,
                })),
                storedUrl: discovered.url,
                textPattern: discovered.text_pattern,
                futureImpact: 'Next fetch for this market will use FAST PATH (~1-2s instead of ~30-60s)',
              });
            } else {
              pipelineLog('LOCATOR_DISCOVERY_NO_MATCH', {
                url: discoveryUrl,
                confirmedValue: resolution.asset_price_suggestion,
                reason: 'No CSS selectors found that match the confirmed value',
                futureImpact: 'Next fetch will still use full pipeline',
              });
            }
          } catch (discoveryErr) {
            pipelineLog('LOCATOR_DISCOVERY_ERROR', {
              error: discoveryErr instanceof Error ? discoveryErr.message : String(discoveryErr),
              nonFatal: true,
            });
          }
        }

        const totalProcessingTimeMs = Date.now() - started;
        
        await supabase.from('metric_oracle_jobs').update({
          status: 'completed',
          progress: 100,
          result: resolution,
          processing_time_ms: totalProcessingTimeMs,
          completed_at: new Date()
        }).eq('job_id', jobId);

        console.log('[Metric-AI] ═══════════════════════════════════════════════════');
        console.log('[Metric-AI] ✅ JOB COMPLETED SUCCESSFULLY', {
          jobId,
          totalProcessingTimeMs,
          mode: 'jina-reader',
          metric: input.metric,
          value: resolution.value,
          assetPriceSuggestion: resolution.asset_price_suggestion,
          confidence: resolution.confidence,
          fusionTier: resolution.fusion_tier,
          dataSources: resolution.data_sources_summary,
          resolutionId,
        });
        console.log('[Metric-AI] ═══════════════════════════════════════════════════');
        
        // Final pipeline summary
        pipelineLog('PIPELINE_COMPLETE', {
          jobId,
          totalTimeMs: totalProcessingTimeMs,
          pathTaken: resolution.pipeline.path === 'FAST_PATH' ? 'FAST_PATH' : 'FULL_PIPELINE',
          fusionTier: resolution.fusion_tier || 'N/A',
          result: {
            value: resolution.asset_price_suggestion,
            confidence: resolution.confidence,
          },
          locatorStatus: {
            hadWorkingLocators: hadWorkingLocatorsBefore,
            wasDiscoveredThisRun: !hadWorkingLocatorsBefore && discoveryEligible,
          },
          nextFetchExpectation: resolution.pipeline.path === 'FAST_PATH' 
            ? 'Will continue using FAST PATH'
            : (!hadWorkingLocatorsBefore && discoveryEligible)
              ? 'Next fetch will use FAST PATH (locators discovered this run)'
              : 'Next fetch will use FULL PIPELINE (no locators discovered)',
        });

        // Post to ClickHouse for charting
        await postToClickHouse({
          marketId,
          metricName: input.metric,
          value: parseFloat(String(resolution.asset_price_suggestion ?? resolution.value)),
          confidence: resolution.confidence,
          source: 'full_pipeline',
          jobId,
        });

        await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'completed', resolution);
        
      } catch (err: any) {
        const totalProcessingTimeMs = Date.now() - started;
        
        console.error('[Metric-AI] ═══════════════════════════════════════════════════');
        console.error('[Metric-AI] ❌ JOB FAILED', {
          jobId,
          totalProcessingTimeMs,
          error: err?.message || 'unknown',
          stack: err?.stack?.slice(0, 500),
        });
        console.error('[Metric-AI] ═══════════════════════════════════════════════════');
        
        await supabase.from('metric_oracle_jobs').update({
          status: 'failed',
          progress: 100,
          error: err?.message || 'unknown',
          completed_at: new Date()
        }).eq('job_id', jobId);

        await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'failed', null, err?.message || 'unknown');
      }
    });

    const requestDurationMs = Date.now() - requestStartTime;
    
    console.log('[Metric-AI] 📤 Returning 202 Accepted', {
      jobId,
      requestDurationMs,
      statusUrl: `/api/metric-ai?jobId=${jobId}`,
    });

    return NextResponse.json(
      {
        status: 'processing',
        jobId,
        statusUrl: `/api/metric-ai?jobId=${jobId}`,
        message: 'AI metric analysis started'
      },
      { status: 202, headers: corsHeaders(req.headers.get('origin') || undefined) }
    );
  } catch (e: any) {
    const requestDurationMs = Date.now() - requestStartTime;
    
    // Provide structured validation details for easier debugging (esp. local dev).
    const isZod = e && typeof e === 'object' && (e as any).name === 'ZodError';
    const issues = isZod ? (e as any).issues : undefined;
    
    console.error('[Metric-AI] ✖ Request validation FAILED', {
      requestDurationMs,
      error: e?.message,
      isZodError: isZod,
      issues,
    });
    
    return NextResponse.json(
      { error: 'Invalid input', message: e?.message || 'Unknown error', ...(issues ? { issues } : {}) },
      { status: 400, headers: corsHeaders(req.headers.get('origin') || undefined) }
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const jobId = searchParams.get('jobId');
    if (!jobId) {
      return NextResponse.json({ error: 'Missing jobId' }, { status: 400, headers: corsHeaders(req.headers.get('origin') || undefined) });
    }
    const supabase = getSupabase();
    const { data, error } = await supabase.from('metric_oracle_jobs').select('*').eq('job_id', jobId).single();
    if (error) {
      return NextResponse.json({ error: 'Job not found' }, { status: 404, headers: corsHeaders(req.headers.get('origin') || undefined) });
    }
    return NextResponse.json(data, { headers: corsHeaders(req.headers.get('origin') || undefined) });
  } catch (e: any) {
    return NextResponse.json({ error: 'Failed to fetch job' }, { status: 500, headers: corsHeaders(req.headers.get('origin') || undefined) });
  }
}


