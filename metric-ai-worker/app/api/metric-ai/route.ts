import { NextRequest, NextResponse } from 'next/server';
import { after } from 'next/server';
import { z } from 'zod';
import OpenAI from 'openai';
import { createClient } from '@supabase/supabase-js';
import { captureScreenshot, ScreenshotResult } from '../../../lib/captureScreenshot';
import { uploadScreenshot, UploadResult } from '../../../lib/uploadScreenshot';
import { analyzeScreenshotWithVision, VisionAnalysisResult } from '../../../lib/visionAnalysis';

export const runtime = 'nodejs';
export const maxDuration = 120;

const InputSchema = z.object({
  metric: z.string().min(1).max(500),
  description: z.string().optional(),
  urls: z.array(z.string().url()).min(1).max(10),
  related_market_id: z.string().optional(),
  related_market_identifier: z.string().optional(),
  user_address: z.string().optional(),
  context: z.enum(['create', 'settlement']).optional()
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
      
      try {
        const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const texts: string[] = [];
        const screenshotDataMap = new Map<string, SourceScreenshotData>();

        console.log('[Metric-AI] 🌐 Phase 1: Fetching HTML and capturing screenshots', { urlCount: input.urls.length });

        // Phase 1: Fetch HTML and capture screenshots in parallel for each URL
        const urlProcessingPromises = input.urls.map(async (url) => {
          const screenshotData: SourceScreenshotData = { url };
          
          try {
            const fetchedAt = new Date().toISOString();
            
            // Wrap screenshot capture in its own try-catch to prevent uncaught exceptions
            const safeScreenshotCapture = async (): Promise<ScreenshotResult | null> => {
              if (!ENABLE_VISION_ANALYSIS) return null;
              try {
                console.log(`[Metric-AI] 📸 Starting screenshot capture for ${url}`);
                
                // captureScreenshot now handles site-specific logic internally
                // via getSiteConfig() - see lib/captureScreenshot.ts for site configs
                const result = await captureScreenshot(url, {
                  width: 1280,
                  height: 900,
                  waitForNetworkIdle: true, // Will be overridden by site config if needed
                  additionalWaitMs: 2000,   // Extra safety margin after site-specific waits
                  timeoutMs: 45000,         // Overall timeout including element waits
                  retryAttempts: 1,
                });
                
                console.log(`[Metric-AI] 📸 Screenshot result for ${url}:`, {
                  success: result.success,
                  captureTimeMs: result.captureTimeMs,
                  hasDimensions: !!result.dimensions,
                  error: result.error?.slice(0, 100),
                });
                
                return result;
              } catch (err) {
                // Catch any uncaught exceptions from Puppeteer/Chromium
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[Metric-AI] ❌ Screenshot capture exception for ${url}:`, message);
                return {
                  success: false,
                  error: `Uncaught exception: ${message}`,
                  captureTimeMs: 0,
                };
              }
            };

            // Fetch HTML and capture screenshot in parallel
            const [htmlResponse, screenshotResult] = await Promise.all([
              fetch(url, {
                headers: { 'User-Agent': `Dexextra/1.0 (+${process.env.APP_URL || 'https://dexextra.com'})` }
              }),
              safeScreenshotCapture()
            ]);

            // Store screenshot result
            if (screenshotResult) {
              screenshotData.screenshotResult = screenshotResult;
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
              for (const c of candidates.slice(0, 18)) {
                digestParts.push(`- ${c.label}: ${c.value} (${c.context})`);
              }
            }
            if (chart.derivedClose) {
              digestParts.push(`CHART_DERIVED_LAST_CLOSE: ${chart.derivedClose}`);
              if (chart.derivedOhlc) {
                digestParts.push(`CHART_DERIVED_OHLC: ${JSON.stringify(chart.derivedOhlc).slice(0, 500)}`);
              }
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

        // Collect digests and screenshot data
        for (const result of urlResults) {
          if (result.digest) {
            texts.push(`SOURCE:\n${result.digest}`);
          }
          screenshotDataMap.set(result.url, result.screenshotData);
        }

        const htmlSuccessCount = texts.length;
        const screenshotSuccessCount = Array.from(screenshotDataMap.values()).filter(d => d.screenshotResult?.success).length;
        
        console.log('[Metric-AI] ✓ Phase 1 complete', {
          jobId,
          phase1DurationMs,
          htmlSourcesExtracted: htmlSuccessCount,
          screenshotsCaptured: screenshotSuccessCount,
          totalUrls: input.urls.length,
        });

        // Phase 2: Upload screenshots and run vision analysis in parallel
        if (ENABLE_VISION_ANALYSIS) {
          console.log('[Metric-AI] 🖼️ Phase 2: Processing screenshots and vision analysis', { jobId });
          
          const screenshotsToProcess = Array.from(screenshotDataMap.values())
            .filter(data => data.screenshotResult?.success && data.screenshotResult.base64);

          // Upload all screenshots in parallel
          const uploadPromises = screenshotsToProcess.map(async (data) => {
            if (!data.screenshotResult?.base64) return;
            try {
              data.uploadResult = await uploadScreenshot(
                data.screenshotResult.base64,
                jobId,
                data.url
              );
            } catch { /* ignore upload errors */ }
          });
          await Promise.all(uploadPromises);

          const uploadsComplete = Array.from(screenshotDataMap.values()).filter(d => d.uploadResult?.publicUrl).length;
          console.log('[Metric-AI] ✓ Screenshots uploaded', { jobId, uploadsComplete });

          // Run vision analysis on all screenshots in parallel
          console.log('[Metric-AI] 👁️ Running vision analysis', { jobId, screenshotsToAnalyze: screenshotsToProcess.length });
          
          const visionPromises = screenshotsToProcess.map(async (data) => {
            if (!data.screenshotResult?.base64) return;
            try {
              data.visionResult = await analyzeScreenshotWithVision(
                data.screenshotResult.base64,
                input.metric,
                { description: input.description }
              );
            } catch { /* ignore vision errors */ }
          });
          await Promise.all(visionPromises);
          
          const visionSuccessCount = Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length;
          console.log('[Metric-AI] ✓ Vision analysis complete', { jobId, visionSuccessCount });
        }

        // Build vision evidence section for the prompt
        const visionEvidenceParts: string[] = [];
        const screenshotFailures: string[] = [];
        if (ENABLE_VISION_ANALYSIS) {
          for (const [url, data] of screenshotDataMap) {
            // Track screenshot capture failures separately
            if (data.screenshotResult && !data.screenshotResult.success) {
              const failReason = data.screenshotResult.error || 'Unknown error';
              screenshotFailures.push(`${url}: ${failReason.slice(0, 150)}`);
              console.warn(`[MetricAI] Screenshot failed for ${url}: ${failReason}`);
            }
            
            if (data.visionResult?.success) {
              visionEvidenceParts.push(`VISION_ANALYSIS (${url}):`);
              if (data.visionResult.value) {
                visionEvidenceParts.push(`- Extracted Value: ${data.visionResult.value}`);
              }
              if (data.visionResult.numericValue) {
                visionEvidenceParts.push(`- Numeric Value: ${data.visionResult.numericValue}`);
              }
              visionEvidenceParts.push(`- Confidence: ${data.visionResult.confidence?.toFixed(2) || 'N/A'}`);
              if (data.visionResult.visualQuote) {
                visionEvidenceParts.push(`- Visual Quote: ${data.visionResult.visualQuote.slice(0, 300)}`);
              }
            } else if (data.visionResult?.error) {
              visionEvidenceParts.push(`VISION_ANALYSIS (${url}): Failed - ${data.visionResult.error.slice(0, 100)}`);
            }
          }
        }
        
        // Log summary of data collection
        const successfulScreenshots = Array.from(screenshotDataMap.values()).filter(d => d.screenshotResult?.success).length;
        const totalUrls = input.urls.length;
        console.log(`[MetricAI] Data collection: ${texts.length}/${totalUrls} HTML sources, ${successfulScreenshots}/${totalUrls} screenshots`);
        if (screenshotFailures.length > 0) {
          console.warn(`[MetricAI] Screenshot failures: ${screenshotFailures.length}/${totalUrls}`);
        }
        const prompt = [
          `METRIC: ${input.metric}`,
          input.description ? `DESCRIPTION: ${input.description}` : '',
          `TASK: Determine the current numeric value and a tradable asset_price_suggestion.`,
          `Return JSON: { "value": "...",  "confidence": 0.0-1.0, "asset_price_suggestion": "123.45", "reasoning": "...", "source_quotes": [{ "url": "...", "quote": "...", "match_score": 0.0-1.0 }] }`,
          `EVIDENCE PRIORITY (use the best available evidence; cite it):`,
          `- You have TWO types of evidence: HTML-extracted data (SOURCES) and screenshot vision analysis (VISION_ANALYSIS).`,
          `- VISION_ANALYSIS is from actual screenshots of the rendered pages - use this as PRIMARY evidence when available, especially for JS-rendered sites.`,
          `- Prefer explicit quotes/fields that clearly refer to the metric (e.g., "last/price/close/settle") over unrelated numbers.`,
          `- Prefer structured pricing where available: VISION_ANALYSIS > JSON_LD_PRICE_CANDIDATES > KEY_LINES > NUMERIC_CANDIDATES.`,
          `- For chart pages, if CHART_DERIVED_LAST_CLOSE/OHLC is present, prefer the latest CLOSE as the asset_price_suggestion and cite it.`,
          `CROSS-VALIDATION (IMPORTANT):`,
          `- When VISION_ANALYSIS and HTML evidence AGREE on the value, boost confidence significantly (e.g., +0.1-0.2).`,
          `- When they DISAGREE, prefer VISION_ANALYSIS (it sees the rendered page) but reduce confidence and explain the discrepancy.`,
          `- If only one source type has data, use it but note in reasoning that cross-validation was not possible.`,
          `DISAMBIGUATION RULES (important on busy pages):`,
          `- Ignore numbers that look like axis ticks, timestamps, percent changes, volumes, page counters, or unrelated KPIs.`,
          `- If multiple plausible candidates exist, choose the one most consistent with the metric name/description and any unit hints; reduce confidence and explain.`,
          `- If sources disagree materially, prefer the most recent (FETCHED_AT) and/or the most directly labeled quote; otherwise use a conservative median and reduce confidence.`,
          `OUTPUT RULES:`,
          `- asset_price_suggestion must be the best tradable "quote-like" number you can defend from evidence (not an axis label).`,
          `- value can include context or units if needed; asset_price_suggestion must be numeric only.`,
          `- You must output ONLY the final numeric price for asset_price_suggestion.`,
          `- The final numeric price MUST have exactly 5 significant figures (use standard rounding).`,
          `- You may must use decimal points, and optional thousands separators (commas).`,
          `- Do NOT output units.`,
          `PRICE RULES:`,
          `- If financial quote (USD per BTC/oz/barrel/etc) use as-is; else rescale large metrics to natural human units.`,
          `CHART RULES (IMPORTANT):`,
          `- If a source provides CHART_DERIVED_LAST_CLOSE or OHLC (open/high/low/close), prefer the latest CLOSE as the asset_price_suggestion.`,
          `- Candlestick charts: use CLOSE, not OPEN, unless the chart is explicitly "current/open".`,
          `- If you use chart-derived pricing, cite the relevant CHART_DERIVED_* or CHART_SNIPPETS in source_quotes.`,
          `MISSING / JS-RENDERED PAGES:`,
          `- If HTML extraction failed but VISION_ANALYSIS succeeded, use the vision data with appropriate confidence.`,
          `- If VISION_ANALYSIS failed but HTML extraction succeeded, use HTML data with appropriate confidence (reduce by ~0.1-0.2 since you cannot cross-validate).`,
          `- IMPORTANT: You MUST still return a result even if screenshots/vision failed. Use HTML-extracted data (NUMERIC_CANDIDATES, KEY_LINES, CHART_DERIVED_*, JSON_LD) as your evidence.`,
          `- If both fail completely (no HTML data AND no vision data), return value: "N/A", asset_price_suggestion: "0", confidence <= 0.2, and explain what evidence was missing.`,
          // Include screenshot failure info if any
          screenshotFailures.length > 0 ? `\nSCREENSHOT FAILURES (${screenshotFailures.length} of ${totalUrls} URLs):\n${screenshotFailures.map(f => `- ${f}`).join('\n')}\nNote: Proceed with HTML-extracted data only for these URLs.` : '',
          // Include vision evidence if available
          visionEvidenceParts.length > 0 ? `\nVISION EVIDENCE:\n${visionEvidenceParts.join('\n')}` : '',
          `\nHTML SOURCES:`,
          texts.join('\n\n').slice(0, MAX_SOURCES_JOIN_CHARS)
        ].filter(Boolean).join('\n');

        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4.1';
        const openaiStartTime = Date.now();
        
        console.log('[Metric-AI] 🤖 Phase 3: Calling OpenAI', {
          jobId,
          model: openaiModel,
          promptLength: prompt.length,
          htmlSourcesIncluded: texts.length,
          visionEvidenceIncluded: visionEvidenceParts.length > 0,
          screenshotFailuresReported: screenshotFailures.length,
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
          jobId,
          openaiDurationMs,
          finishReason: resp.choices[0]?.finish_reason,
          promptTokens: resp.usage?.prompt_tokens,
          completionTokens: resp.usage?.completion_tokens,
          totalTokens: resp.usage?.total_tokens,
        });

        let content = resp.choices[0]?.message?.content?.trim() || '{}';
        try { content = content.replace(/```json|```/g, '').trim(); } catch {}
        const json = JSON.parse(content);
        
        console.log('[Metric-AI] 📋 Parsed AI response', {
          jobId,
          value: json.value,
          assetPriceSuggestion: json.asset_price_suggestion,
          confidence: json.confidence,
          hasReasoning: !!json.reasoning,
          sourceQuotesCount: json.source_quotes?.length || 0,
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
            // Include vision analysis results if available
            vision_value: screenshotData?.visionResult?.numericValue || '',
            vision_confidence: screenshotData?.visionResult?.confidence || 0,
            vision_quote: screenshotData?.visionResult?.visualQuote?.slice(0, 300) || ''
          };
        }) : [];

        const resolution = {
          metric: input.metric,
          value: json.value || 'N/A',
          unit: json.unit || 'unknown',
          as_of: json.as_of || new Date().toISOString(),
          confidence: typeof json.confidence === 'number' ? Math.min(Math.max(json.confidence, 0), 1) : 0.5,
          asset_price_suggestion: json.asset_price_suggestion || json.value || '50.00',
          reasoning: json.reasoning || '',
          sources: sourcesWithScreenshots,
          // Include aggregated vision analysis metadata
          vision_analysis_enabled: ENABLE_VISION_ANALYSIS,
          vision_sources_analyzed: Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length,
          screenshots_captured: successfulScreenshots,
          screenshots_failed: screenshotFailures.length,
          screenshot_failure_reasons: screenshotFailures.length > 0 ? screenshotFailures : undefined,
          html_sources_extracted: texts.length,
          data_sources_summary: `HTML: ${texts.length}/${totalUrls}, Screenshots: ${successfulScreenshots}/${totalUrls}, Vision: ${Array.from(screenshotDataMap.values()).filter(d => d.visionResult?.success).length}/${totalUrls}`
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


