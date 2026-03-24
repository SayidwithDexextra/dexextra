import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { captureScreenshot, captureFullPageFallback, ScreenshotResult, SourceLocator, safeCloseBrowser } from '../../../lib/captureScreenshot';
import type { Browser, Page } from 'puppeteer-core';
import { uploadScreenshot, UploadResult } from '../../../lib/uploadScreenshot';
import { VisionAnalysisResult } from '../../../lib/visionAnalysis';
import { analyzeWithConsensus, VisionConsensus } from '../../../lib/multiModelVision';
import { getHistoricalContext, formatHistoricalContextForPrompt, HistoricalStats } from '../../../lib/historicalContext';
import { validateExtractedValue, buildSecondOpinionPrompt } from '../../../lib/valueValidator';
import { discoverLocators, fastExtract, AiSourceLocatorData, DiscoveredSelector } from '../../../lib/autoLocatorDiscovery';

export const runtime = 'nodejs';
export const maxDuration = 120;

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

// Type for tracking screenshot and vision data per URL
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
      
      const livePages = new Map<string, { page: Page; browser: Browser }>();
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const texts: string[] = [];
        const screenshotDataMap = new Map<string, SourceScreenshotData>();

        // --- Phase 0: Fetch ai_source_locator (new column) + historical context in parallel ---
        let sourceLocator: SourceLocator | undefined;
        let storedLocatorData: AiSourceLocatorData | null = null;
        let historicalStats: HistoricalStats = { lastValue: null, lastUpdatedAt: null, min: 0, max: 0, mean: 0, stdDev: 0, count: 0, suspiciousBelow: 0, suspiciousAbove: Infinity, source: 'none' };
        const marketId = input.related_market_id || '';

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

              // Read from dedicated column first, fall back to legacy market_config nesting
              const locatorCol = (data as any)?.ai_source_locator;
              if (locatorCol && Array.isArray(locatorCol.selectors) && locatorCol.selectors.length > 0) {
                storedLocatorData = locatorCol as AiSourceLocatorData;
                const best = locatorCol.selectors[0];
                sourceLocator = {
                  css_selector: best.type === 'css' ? best.selector : undefined,
                  xpath: best.type === 'xpath' ? best.xpath : undefined,
                  js_extractor: best.type === 'js_extractor' ? best.script : undefined,
                };
                console.log('[Metric-AI] ✓ Loaded ai_source_locator from column', {
                  selectorCount: locatorCol.selectors.length,
                  bestType: best.type,
                  successCount: locatorCol.success_count,
                });
              } else {
                const loc = (data as any)?.market_config?.ai_source_locator;
                if (loc && (loc.css_selector || loc.xpath || loc.js_extractor)) {
                  sourceLocator = {
                    css_selector: loc.css_selector || undefined,
                    xpath: loc.xpath || undefined,
                    js_extractor: loc.js_extractor || undefined,
                  };
                  console.log('[Metric-AI] ✓ Loaded ai_source_locator from market_config (legacy)');
                }
              }
            } catch {}
          })());
          phase0Promises.push((async () => {
            try {
              const metricName = input.metric || input.related_market_identifier || '';
              historicalStats = await getHistoricalContext(marketId, metricName);
              console.log('[Metric-AI] ✓ Historical context loaded', {
                source: historicalStats.source, count: historicalStats.count, lastValue: historicalStats.lastValue,
              });
            } catch {}
          })());
        }
        if (phase0Promises.length) await Promise.all(phase0Promises);
        storedLocatorData = storedLocatorData as AiSourceLocatorData | null;

        // --- Phase 0.5: Fast path — use stored selectors to skip full pipeline ---
        if (
          storedLocatorData &&
          storedLocatorData.selectors.length > 0 &&
          storedLocatorData.url &&
          input.context !== 'create' &&
          storedLocatorData.failure_count < 3
        ) {
          console.log('[Metric-AI] ⚡ Attempting fast-path extraction', {
            url: storedLocatorData.url,
            selectorCount: storedLocatorData.selectors.length,
            successCount: storedLocatorData.success_count,
          });

          const fastResult = await fastExtract(
            storedLocatorData.url,
            storedLocatorData.selectors as DiscoveredSelector[],
          );

          if (fastResult) {
            const fastValidation = validateExtractedValue(fastResult.value, historicalStats);

            if (fastValidation.valid || fastValidation.maxConfidence >= 0.6) {
              const fastConfidence = Math.min(0.95, fastValidation.maxConfidence);
              console.log('[Metric-AI] ⚡ Fast path SUCCESS', {
                jobId, value: fastResult.value,
                method: fastResult.method,
                extractTimeMs: fastResult.extractTimeMs,
                confidence: fastConfidence,
              });

              const fastResolution = {
                metric: input.metric,
                value: fastResult.value,
                unit: 'unknown',
                as_of: new Date().toISOString(),
                confidence: fastConfidence,
                asset_price_suggestion: fastResult.value,
                reasoning: `Fast-path extraction via stored ${fastResult.method} selector. Validated against historical context.`,
                sources: [{ url: storedLocatorData.url, quote: `Selector: ${fastResult.selector}`, match_score: fastConfidence }],
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
                    ...storedLocatorData,
                    last_successful_at: new Date().toISOString(),
                    success_count: (storedLocatorData.success_count || 0) + 1,
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

              await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'completed', fastResolution);

              return NextResponse.json({
                jobId, status: 'completed', result: fastResolution,
              });
            } else {
              console.log('[Metric-AI] ⚡ Fast path value failed validation, falling through to full pipeline', {
                value: fastResult.value, warnings: fastValidation.warnings,
              });
            }
          } else {
            console.log('[Metric-AI] ⚡ Fast path extraction returned null, falling through');
            // Increment failure_count
            if (marketId) {
              try {
                const updatedLocator = {
                  ...storedLocatorData,
                  failure_count: (storedLocatorData.failure_count || 0) + 1,
                };
                await supabase.from('markets').update({
                  ai_source_locator: updatedLocator,
                  updated_at: new Date().toISOString(),
                }).eq('id', marketId);
              } catch {}
            }
          }
        }

        const visionExpectedRange = historicalStats.source !== 'none' && historicalStats.lastValue
          ? { min: historicalStats.suspiciousBelow, max: historicalStats.suspiciousAbove }
          : undefined;

        console.log('[Metric-AI] 🌐 Phase 1: Fetching HTML and capturing screenshots', { urlCount: input.urls.length });

        const isCreateContext = input.context === 'create';

        // --- Phase 1: Fetch HTML + screenshot + DOM extraction + locator in parallel per URL ---
        const urlProcessingPromises = input.urls.map(async (url) => {
          const screenshotData: SourceScreenshotData = { url };
          
          try {
            const fetchedAt = new Date().toISOString();
            
            const safeScreenshotCapture = async (): Promise<ScreenshotResult | null> => {
              if (!ENABLE_VISION_ANALYSIS) return null;
              try {
                console.log(`[Metric-AI] 📸 Starting screenshot capture for ${url}`);
                const result = await captureScreenshot(url, {
                  width: 1280,
                  height: 900,
                  waitForNetworkIdle: true,
                  additionalWaitMs: 2000,
                  timeoutMs: 45000,
                  retryAttempts: 1,
                  locator: sourceLocator,
                  keepBrowserAlive: isCreateContext && !!marketId,
                });
                
                console.log(`[Metric-AI] 📸 Screenshot result for ${url}:`, {
                  success: result.success,
                  captureTimeMs: result.captureTimeMs,
                  hasRenderedText: !!result.renderedText,
                  locatorExtracted: result.locatorExtractedValue?.slice(0, 50) || null,
                  locatorMethod: result.locatorMethod || null,
                  error: result.error?.slice(0, 100),
                });
                
                return result;
              } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Metric-AI] ❌ Screenshot capture exception for ${url}:`, message);
                return { success: false, error: `Uncaught exception: ${message}`, captureTimeMs: 0 };
              }
            };

            const [htmlResponse, screenshotResult] = await Promise.all([
              fetch(url, {
                headers: { 'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'https://dexextra.com'})` }
              }),
              safeScreenshotCapture()
            ]);

            if (screenshotResult) {
              screenshotData.screenshotResult = screenshotResult;
              if (screenshotResult.livePage && screenshotResult.liveBrowser) {
                livePages.set(url, { page: screenshotResult.livePage, browser: screenshotResult.liveBrowser });
              }
            }

            const contentType = htmlResponse.headers.get('content-type') || '';
            const htmlRaw = (await htmlResponse.text()).slice(0, MAX_RAW_HTML_CHARS);

            const meta = extractMetaTags(htmlRaw);
            const textLines = stripTagsToLines(htmlRaw);
            const keyLines = collectKeyLines(textLines, [
              input.metric,
              ...(input.description ? input.description.split(/\s+/).slice(0, 8) : [])
            ]);
            const jsonLd = extractJsonLdPrices(htmlRaw);
            const chart = extractChartSignals(htmlRaw);
            const candidates = extractNumericCandidates(htmlRaw);

            const digestParts: string[] = [];
            digestParts.push(`URL: ${url}`);
            digestParts.push(`FETCHED_AT: ${fetchedAt}`);
            digestParts.push(`HTTP_STATUS: ${htmlResponse.status}`);
            if (contentType) digestParts.push(`CONTENT_TYPE: ${contentType}`);
            if (meta.title) digestParts.push(`TITLE: ${meta.title}`);
            if (meta.description) digestParts.push(`META_DESCRIPTION: ${meta.description}`);

            // Locator-extracted value (highest trust)
            if (screenshotResult?.locatorExtractedValue) {
              digestParts.push(`LOCATOR_EXTRACTED_VALUE: ${screenshotResult.locatorExtractedValue} (via ${screenshotResult.locatorMethod})`);
            }

            // Rendered DOM text (JS-rendered content from Puppeteer)
            if (screenshotResult?.renderedText) {
              const renderedKeyLines = collectKeyLines(screenshotResult.renderedText, [
                input.metric,
                ...(input.description ? input.description.split(/\s+/).slice(0, 8) : [])
              ]);
              if (renderedKeyLines.length > 0) {
                digestParts.push(`RENDERED_DOM_KEY_LINES (JS-rendered page content):`);
                for (const line of renderedKeyLines.slice(0, 30)) digestParts.push(`- ${line.slice(0, 500)}`);
              }
            }

            if (jsonLd.length) {
              digestParts.push(
                `JSON_LD_PRICE_CANDIDATES: ${jsonLd
                  .slice(0, 6)
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
            if (chart.snippets.length) {
              digestParts.push(`CHART_SNIPPETS:`);
              for (const snip of chart.snippets) digestParts.push(`- ${snip.slice(0, 900)}`);
            }
            digestParts.push(`KEY_LINES:`);
            for (const line of keyLines) digestParts.push(`- ${line.slice(0, 500)}`);

            const digest = digestParts.join('\n').slice(0, MAX_SOURCE_DIGEST_CHARS);
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
          htmlSourcesExtracted: htmlSuccessCount,
          screenshotsCaptured: screenshotSuccessCount,
          totalUrls: input.urls.length,
        });

        // --- Phase 2: Upload screenshots + multi-model vision consensus ---
        if (ENABLE_VISION_ANALYSIS) {
          console.log('[Metric-AI] 🖼️ Phase 2: Screenshots + multi-model vision consensus', { jobId });
          
          const screenshotsToProcess = Array.from(screenshotDataMap.values())
            .filter(data => data.screenshotResult?.success && data.screenshotResult.base64);

          const uploadPromises = screenshotsToProcess.map(async (data) => {
            if (!data.screenshotResult?.base64) return;
            try {
              data.uploadResult = await uploadScreenshot(data.screenshotResult.base64, jobId, data.url);
            } catch {}
          });
          await Promise.all(uploadPromises);

          console.log('[Metric-AI] 👁️ Running multi-model vision consensus', { jobId, screenshotsToAnalyze: screenshotsToProcess.length });
          
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

          // Hybrid fallback: if vision confidence is low, retry with full-page screenshot
          for (const data of screenshotsToProcess) {
            if (data.visionConsensus && data.visionConsensus.confidence < 0.4 && data.visionConsensus.agreement !== 'none') {
              console.log(`[Metric-AI] 🔄 Low vision confidence (${data.visionConsensus.confidence.toFixed(2)}), trying full-page for ${data.url}`);
              try {
                const fullPageResult = await captureFullPageFallback(data.url, {
                  width: 1280, height: 900, timeoutMs: 30000, retryAttempts: 0, locator: sourceLocator,
                });
                if (fullPageResult.success && fullPageResult.base64) {
                  const retryConsensus = await analyzeWithConsensus(
                    fullPageResult.base64, input.metric,
                    { description: input.description, expectedRange: visionExpectedRange }
                  );
                  if (retryConsensus.confidence > data.visionConsensus.confidence) {
                    console.log(`[Metric-AI] ✓ Full-page improved confidence: ${retryConsensus.confidence.toFixed(2)}`);
                    data.visionConsensus = retryConsensus;
                    const bestRetry = retryConsensus.models.find(m => m.success);
                    if (bestRetry) {
                      data.visionResult = {
                        success: true, value: retryConsensus.value,
                        numericValue: retryConsensus.numericValue !== undefined ? String(retryConsensus.numericValue) : bestRetry.numericValue,
                        confidence: retryConsensus.confidence, visualQuote: bestRetry.visualQuote,
                      };
                    }
                  }
                }
              } catch {}
            }
          }

          const visionSuccessCount = Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length;
          console.log('[Metric-AI] ✓ Vision analysis complete', { jobId, visionSuccessCount });
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

        // --- Phase 3: Enhanced fusion prompt ---
        const historicalPrompt = formatHistoricalContextForPrompt(historicalStats);

        const prompt = [
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
          // Historical context
          historicalPrompt,
          // Locator evidence (highest trust)
          locatorEvidenceParts.length > 0 ? `\nLOCATOR EVIDENCE:\n${locatorEvidenceParts.join('\n')}` : '',
          // Vision consensus
          visionConsensusParts.length > 0 ? `\nVISION CONSENSUS:\n${visionConsensusParts.join('\n')}` : '',
          // Legacy single-model vision
          visionEvidenceParts.length > 0 ? `\nVISION EVIDENCE:\n${visionEvidenceParts.join('\n')}` : '',
          // Screenshot failures
          screenshotFailures.length > 0 ? `\nSCREENSHOT FAILURES (${screenshotFailures.length}/${totalUrls}):\n${screenshotFailures.map(f => `- ${f}`).join('\n')}` : '',
          // HTML sources
          `\nHTML SOURCES:`,
          texts.join('\n\n').slice(0, MAX_SOURCES_JOIN_CHARS)
        ].filter(Boolean).join('\n');

        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1';
        const openaiStartTime = Date.now();
        
        console.log('[Metric-AI] 🤖 Phase 3: Calling OpenAI fusion', {
          jobId, model: openaiModel, promptLength: prompt.length,
          hasLocatorEvidence: locatorEvidenceParts.length > 0,
          hasVisionConsensus: visionConsensusParts.length > 0,
          hasHistoricalContext: historicalStats.source !== 'none',
        });

        const resp = await openai.chat.completions.create({
          model: openaiModel,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
            { role: 'user', content: prompt }
          ],
          max_tokens: 1400
        });

        const openaiDurationMs = Date.now() - openaiStartTime;
        console.log('[Metric-AI] ✓ OpenAI response received', {
          jobId, openaiDurationMs,
          finishReason: resp.choices[0]?.finish_reason,
          totalTokens: resp.usage?.total_tokens,
        });

        let content = resp.choices[0]?.message?.content?.trim() || '{}';
        try { content = content.replace(/```json|```/g, '').trim(); } catch {}
        let json = JSON.parse(content);

        // --- Phase 4: Post-extraction validation ---
        const validation = validateExtractedValue(json.asset_price_suggestion, historicalStats);
        let validationWarning: string | undefined;
        if (!validation.valid && validation.warnings.length > 0) {
          console.warn('[Metric-AI] ⚠ Value flagged by validator', { jobId, warnings: validation.warnings });

          // Attempt a second opinion if confidence is being capped significantly
          if (validation.maxConfidence <= 0.3) {
            try {
              const secondOpinion = buildSecondOpinionPrompt(json.asset_price_suggestion, validation.warnings, historicalStats);
              console.log('[Metric-AI] 🔄 Requesting second opinion from AI');
              const resp2 = await openai.chat.completions.create({
                model: openaiModel,
                response_format: { type: 'json_object' },
                messages: [
                  { role: 'system', content: 'You are an expert metric analyst. Return strict JSON only.' },
                  { role: 'user', content: prompt + '\n\n' + secondOpinion }
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
          value: json.value,
          assetPriceSuggestion: json.asset_price_suggestion,
          confidence: json.confidence,
          validationWarning: validationWarning || null,
        });

        // Build sources with screenshot URLs
        const sourcesWithScreenshots = Array.isArray(json.source_quotes) ? json.source_quotes.map((q: any) => {
          const sourceUrl = String(q.url || '');
          const screenshotData = screenshotDataMap.get(sourceUrl);
          return {
            url: sourceUrl,
            screenshot_url: screenshotData?.uploadResult?.publicUrl || '',
            quote: String(q.quote || '').slice(0, 800),
            match_score: typeof q.match_score === 'number' ? q.match_score : 0.5,
            vision_value: screenshotData?.visionResult?.numericValue || '',
            vision_confidence: screenshotData?.visionResult?.confidence || 0,
            vision_quote: screenshotData?.visionResult?.visualQuote?.slice(0, 300) || '',
            wayback_url: null as string | null,
            wayback_timestamp: null as string | null,
            wayback_screenshot_url: null as string | null,
          };
        }) : [];

        // Wayback archival (settlement context only)
        // Archives both the screenshot PNGs (reliable -- static files) and original source URLs (best-effort)
        let settlementWaybackUrl: string | null = null;
        let settlementWaybackTimestamp: string | null = null;
        let settlementWaybackPageUrl: string | null = null;
        if (input.context === 'settlement') {
          const { archivePage } = await import('../../../lib/archivePage');

          // Collect screenshot public URLs from successful uploads
          const screenshotPublicUrls: { sourceUrl: string; screenshotUrl: string }[] = [];
          for (const [url, data] of screenshotDataMap) {
            if (data.uploadResult?.publicUrl) {
              screenshotPublicUrls.push({ sourceUrl: url, screenshotUrl: data.uploadResult.publicUrl });
            }
          }

          const sourceUrls = input.urls.slice(0, 3);
          console.log(`[Metric-AI] 📦 Archiving to Wayback: ${screenshotPublicUrls.length} screenshot(s) + ${sourceUrls.length} source URL(s)`);

          // Archive screenshots (reliable -- static PNGs) and original pages (best-effort) in parallel
          const [screenshotArchiveResults, pageArchiveResults] = await Promise.all([
            Promise.allSettled(
              screenshotPublicUrls.map(({ screenshotUrl }) => archivePage(screenshotUrl, { timeoutMs: 30_000 }))
            ),
            Promise.allSettled(
              sourceUrls.map((url) => archivePage(url, { timeoutMs: 30_000 }))
            ),
          ]);

          // Process screenshot archive results (primary evidence)
          for (let i = 0; i < screenshotArchiveResults.length; i++) {
            const r = screenshotArchiveResults[i];
            const { sourceUrl, screenshotUrl } = screenshotPublicUrls[i];
            if (r.status === 'fulfilled' && r.value.success && r.value.waybackUrl) {
              console.log(`[Metric-AI] ✓ Screenshot archived: ${screenshotUrl} → ${r.value.waybackUrl}`);
              if (i === 0) {
                settlementWaybackUrl = r.value.waybackUrl;
                settlementWaybackTimestamp = r.value.timestamp || null;
              }
              const matchingSource = sourcesWithScreenshots.find((s: any) => s.url === sourceUrl);
              if (matchingSource) {
                matchingSource.wayback_screenshot_url = r.value.waybackUrl;
              }
            } else {
              const reason = r.status === 'rejected' ? r.reason?.message : r.value?.error;
              console.warn(`[Metric-AI] ⚠ Screenshot archive failed for ${screenshotUrl}: ${reason || 'unknown'}`);
            }
          }

          // Process original page archive results (best-effort bonus)
          for (let i = 0; i < pageArchiveResults.length; i++) {
            const r = pageArchiveResults[i];
            if (r.status === 'fulfilled' && r.value.success && r.value.waybackUrl) {
              console.log(`[Metric-AI] ✓ Page archived: ${sourceUrls[i]} → ${r.value.waybackUrl}`);
              if (i === 0) {
                settlementWaybackPageUrl = r.value.waybackUrl;
              }
              const matchingSource = sourcesWithScreenshots.find((s: any) => s.url === sourceUrls[i]);
              if (matchingSource) {
                matchingSource.wayback_url = r.value.waybackUrl;
                matchingSource.wayback_timestamp = r.value.timestamp || null;
              }
            } else {
              const reason = r.status === 'rejected' ? r.reason?.message : r.value?.error;
              console.warn(`[Metric-AI] ⚠ Page archive failed for ${sourceUrls[i]}: ${reason || 'unknown'}`);
            }
          }
        }

        const resolution = {
          metric: input.metric,
          value: json.value || 'N/A',
          unit: json.unit || 'unknown',
          as_of: json.as_of || new Date().toISOString(),
          confidence: typeof json.confidence === 'number' ? Math.min(Math.max(json.confidence, 0), 1) : 0.5,
          asset_price_suggestion: json.asset_price_suggestion || json.value || '50.00',
          reasoning: json.reasoning || '',
          sources: sourcesWithScreenshots,
          // Validation
          validation_warning: validationWarning || undefined,
          // Vision metadata
          vision_analysis_enabled: ENABLE_VISION_ANALYSIS,
          vision_sources_analyzed: Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length,
          vision_consensus_agreement: Array.from(screenshotDataMap.values()).find(d => d.visionConsensus)?.visionConsensus?.agreement || null,
          screenshots_captured: successfulScreenshots,
          screenshots_failed: screenshotFailures.length,
          screenshot_failure_reasons: screenshotFailures.length > 0 ? screenshotFailures : undefined,
          html_sources_extracted: texts.length,
          locator_used: !!sourceLocator,
          locator_value: Array.from(screenshotDataMap.values()).find(d => d.screenshotResult?.locatorExtractedValue)?.screenshotResult?.locatorExtractedValue || null,
          historical_context_source: historicalStats.source,
          historical_last_value: historicalStats.lastValue,
          data_sources_summary: `HTML: ${texts.length}/${totalUrls}, Screenshots: ${successfulScreenshots}/${totalUrls}, Vision: ${Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length}/${totalUrls}`,
          settlement_wayback_url: settlementWaybackUrl,
          settlement_wayback_timestamp: settlementWaybackTimestamp,
          settlement_wayback_page_url: settlementWaybackPageUrl,
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

        // --- Phase 5: Auto-discover locators on creation context for fast-path reuse ---
        // Gate on the raw AI confidence (pre-validation) or strong vision consensus,
        // NOT the post-validation confidence which can be crushed by stale historical data.
        const rawAiConfidence = typeof json.confidence === 'number' ? json.confidence : 0;
        const hasVisionAgreement = resolution.vision_consensus_agreement === 'full' || resolution.vision_consensus_agreement === 'partial';
        const discoveryEligible = rawAiConfidence >= 0.7 || hasVisionAgreement;
        if (
          input.context === 'create' &&
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

            const reusablePage = livePages.get(discoveryUrl)?.page;
            console.log('[Metric-AI] 🔍 Phase 5: Auto-discovering locators', {
              jobId, url: discoveryUrl, confirmedValue: resolution.asset_price_suggestion,
              reusingBrowser: !!reusablePage,
            });

            const discovered = await discoverLocators(
              discoveryUrl,
              resolution.asset_price_suggestion,
              primaryEvidence,
              reusablePage,
            );

            if (discovered) {
              await supabase.from('markets').update({
                ai_source_locator: discovered,
                updated_at: new Date().toISOString(),
              }).eq('id', marketId);

              console.log('[Metric-AI] ✓ Auto-discovered locators persisted', {
                jobId,
                selectorCount: discovered.selectors.length,
                bestSelector: discovered.selectors[0]?.type,
                bestConfidence: discovered.selectors[0]?.confidence,
              });
            } else {
              console.log('[Metric-AI] ⚠ No locators discovered for', discoveryUrl);
            }
          } catch (discoveryErr) {
            console.warn('[Metric-AI] ⚠ Locator discovery failed (non-fatal):', discoveryErr instanceof Error ? discoveryErr.message : discoveryErr);
          }
        }

        // Close any live browser sessions kept alive for Phase 5
        for (const [, { browser }] of livePages) {
          await safeCloseBrowser(browser);
        }
        livePages.clear();

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
          metric: input.metric,
          value: resolution.value,
          assetPriceSuggestion: resolution.asset_price_suggestion,
          confidence: resolution.confidence,
          dataSources: resolution.data_sources_summary,
          resolutionId,
        });
        console.log('[Metric-AI] ═══════════════════════════════════════════════════');

        await deliverCallback(input.callbackUrl, input.callbackSecret, input.callbackMeta, jobId, 'completed', resolution);
        
      } catch (err: any) {
        // Always clean up live browsers on error
        for (const [, { browser }] of livePages) {
          await safeCloseBrowser(browser);
        }
        livePages.clear();

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


