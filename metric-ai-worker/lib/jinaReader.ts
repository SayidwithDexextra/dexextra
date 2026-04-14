/**
 * Jina Reader — unified text extraction + screenshot capture.
 *
 * Replaces both Puppeteer DOM extraction and external screenshot APIs.
 * Jina renders the page server-side (including JS) and can return
 * clean text OR a viewport screenshot from the same service.
 *
 * Engine strategy (two tiers, fastest first):
 *   1. "direct"  — Speed First, no JS rendering
 *   2. "browser" — full headless render, slowest but most reliable
 *
 * Env vars:
 *   JINA_API_KEY  — Bearer token (optional; free tier works without it but is rate-limited)
 */

type Engine = 'direct' | 'default' | 'browser';
const ENGINE_ORDER: Engine[] = ['direct', 'browser'];
const MIN_CONTENT_LENGTH = 50;

// ---------------------------------------------------------------------------
// Wayback URL Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a Wayback URL to its "raw" format (id_ suffix removes toolbar).
 * Example: https://web.archive.org/web/20260412033835/https://example.com
 *       -> https://web.archive.org/web/20260412033835id_/https://example.com
 */
function toRawWaybackUrl(url: string): string {
  const waybackMatch = url.match(/^(https:\/\/web\.archive\.org\/web\/\d+)(\/)(https?:\/\/.+)$/);
  if (waybackMatch) {
    return `${waybackMatch[1]}id_/${waybackMatch[3]}`;
  }
  return url;
}

/**
 * Extract the original URL from a Wayback URL.
 */
function extractOriginalUrl(waybackUrl: string): string | null {
  const match = waybackUrl.match(/^https:\/\/web\.archive\.org\/web\/\d+(?:id_)?\/(https?:\/\/.+)$/);
  return match ? match[1] : null;
}

/**
 * Check if a URL is a Wayback Machine URL.
 */
function isWaybackUrl(url: string): boolean {
  return url.includes('web.archive.org/web/');
}

/**
 * Get URLs to try for Jina, with Wayback fallbacks.
 * For Wayback URLs, tries: raw format -> original URL -> regular format
 */
function getUrlsToTry(url: string, options: { fallbackToOriginal?: boolean } = {}): string[] {
  const urls: string[] = [];
  
  if (isWaybackUrl(url)) {
    // Try raw Wayback URL first (removes the Wayback toolbar)
    const rawUrl = toRawWaybackUrl(url);
    if (rawUrl !== url) {
      urls.push(rawUrl);
    }
    urls.push(url);
    // Fallback to original URL if enabled
    if (options.fallbackToOriginal !== false) {
      const originalUrl = extractOriginalUrl(url);
      if (originalUrl) {
        urls.push(originalUrl);
      }
    }
  } else {
    urls.push(url);
  }
  
  return urls;
}

export interface JinaReaderResult {
  success: boolean;
  title?: string;
  description?: string;
  /** Clean text content (text/markdown modes) */
  content?: string;
  /** Which engine ultimately produced the result */
  engine?: Engine;
  durationMs: number;
  error?: string;
}

export interface JinaScreenshotResult {
  success: boolean;
  /** Base64-encoded viewport screenshot (JPEG) */
  base64?: string;
  /** Which engine ultimately produced the result */
  engine?: Engine;
  captureTimeMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Text extraction
// ---------------------------------------------------------------------------

/**
 * Fetch text content. When `engine` is provided, only that engine is tried
 * (single-shot). When omitted, falls back through ENGINE_ORDER automatically.
 * 
 * For Wayback URLs, automatically tries:
 * 1. Raw Wayback URL (removes toolbar)
 * 2. Regular Wayback URL
 * 3. Original URL (if fallbackToOriginal is true)
 */
export async function fetchWithJina(
  url: string,
  options: { timeoutMs?: number; format?: 'text' | 'markdown'; engine?: Engine; fallbackToOriginal?: boolean } = {},
): Promise<JinaReaderResult> {
  const apiKey = process.env.JINA_API_KEY || '';
  const timeoutMs = options.timeoutMs || 30_000;
  const format = options.format || 'text';
  const startTime = Date.now();

  const engines = options.engine ? [options.engine] : ENGINE_ORDER;
  const urlsToTry = getUrlsToTry(url, { fallbackToOriginal: options.fallbackToOriginal });
  let lastError = '';

  for (const targetUrl of urlsToTry) {
    for (const engine of engines) {
      const isRetry = engine !== engines[0] || targetUrl !== urlsToTry[0];
      if (isRetry) {
        console.log(`[JinaReader] ⟳ Trying ${targetUrl} with engine=${engine}`);
      }

      try {
        const result = await _fetchText(targetUrl, { apiKey, timeoutMs, format, engine });

        if (result.success && result.content && result.content.length >= MIN_CONTENT_LENGTH) {
          result.durationMs = Date.now() - startTime;
          if (targetUrl !== url) {
            console.log(`[JinaReader] ✓ Text fetch succeeded using fallback URL: ${targetUrl}`);
          }
          return result;
        }

        lastError = result.error
          || `Engine "${engine}" returned ${result.content?.length ?? 0} chars (below ${MIN_CONTENT_LENGTH} threshold)`;
        console.log(`[JinaReader] ✗ ${lastError}`);
      } catch (err: any) {
        lastError = err?.name === 'AbortError'
          ? `Jina timed out after ${timeoutMs}ms (engine=${engine})`
          : `Jina fetch failed (engine=${engine}): ${err?.message || err}`;
        console.log(`[JinaReader] ✗ ${lastError}`);
      }
    }
  }

  return { success: false, error: lastError, durationMs: Date.now() - startTime };
}

async function _fetchText(
  url: string,
  opts: { apiKey: string; timeoutMs: number; format: string; engine: Engine },
): Promise<JinaReaderResult> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'X-Return-Format': opts.format,
    'X-Timeout': '25',
  };
  if (opts.engine !== 'default') headers['X-Engine'] = opts.engine;
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  console.log(`[JinaReader] Fetching ${url} (format=${opts.format}, engine=${opts.engine})`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      error: `Jina returned ${res.status}: ${body.slice(0, 200)}`,
      durationMs: 0,
    };
  }

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    const json = await res.json();
    const data = json.data || json;
    console.log(`[JinaReader] ✓ Got ${data.content?.length || 0} chars (engine=${opts.engine})`);
    return {
      success: true,
      title: data.title || '',
      description: data.description || '',
      content: data.content || '',
      engine: opts.engine,
      durationMs: 0,
    };
  }

  const text = await res.text();
  console.log(`[JinaReader] ✓ Got ${text.length} chars plain (engine=${opts.engine})`);
  return { success: true, content: text, engine: opts.engine, durationMs: 0 };
}

// ---------------------------------------------------------------------------
// HTML extraction (for cheerio-based selector evaluation)
// ---------------------------------------------------------------------------

export interface JinaHtmlResult {
  success: boolean;
  html?: string;
  engine?: Engine;
  durationMs: number;
  error?: string;
}

export async function fetchHtmlWithJina(
  url: string,
  options: { timeoutMs?: number } = {},
): Promise<JinaHtmlResult> {
  const apiKey = process.env.JINA_API_KEY || '';
  const timeoutMs = options.timeoutMs || 30_000;
  const startTime = Date.now();

  let lastError = '';

  for (const engine of ENGINE_ORDER) {
    const isRetry = engine !== ENGINE_ORDER[0];
    if (isRetry) {
      console.log(`[JinaHTML] ⟳ Retrying ${url} with engine=${engine}`);
    }

    try {
      const headers: Record<string, string> = {
        Accept: 'application/json',
        'X-Return-Format': 'html',
        'X-Timeout': '25',
      };
      if (engine !== 'default') headers['X-Engine'] = engine;
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

      console.log(`[JinaHTML] Fetching ${url} (engine=${engine})`);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(`https://r.jina.ai/${url}`, {
        headers,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        lastError = `Jina HTML returned ${res.status}: ${body.slice(0, 200)}`;
        console.log(`[JinaHTML] ✗ ${lastError}`);
        continue;
      }

      const contentType = res.headers.get('content-type') || '';
      let html = '';

      if (contentType.includes('application/json')) {
        const json = await res.json();
        const data = json.data || json;
        html = data.content || data.html || '';
      } else {
        html = await res.text();
      }

      if (html.length >= MIN_CONTENT_LENGTH) {
        console.log(`[JinaHTML] ✓ Got ${html.length} chars HTML (engine=${engine})`);
        return { success: true, html, engine, durationMs: Date.now() - startTime };
      }

      lastError = `Engine "${engine}" returned ${html.length} chars HTML (below threshold)`;
      console.log(`[JinaHTML] ✗ ${lastError}`);
    } catch (err: any) {
      lastError = err?.name === 'AbortError'
        ? `Jina HTML timed out after ${timeoutMs}ms (engine=${engine})`
        : `Jina HTML failed (engine=${engine}): ${err?.message || err}`;
      console.log(`[JinaHTML] ✗ ${lastError}`);
    }
  }

  return { success: false, error: lastError, durationMs: Date.now() - startTime };
}

// ---------------------------------------------------------------------------
// Screenshot capture
// ---------------------------------------------------------------------------

const SCREENSHOT_ENGINES: Engine[] = ['direct', 'browser'];

/**
 * Capture a viewport screenshot. When `engine` is provided, only that engine
 * is tried (single-shot). When omitted, falls back through engines automatically.
 * 
 * For Wayback URLs, automatically tries:
 * 1. Raw Wayback URL (removes toolbar)
 * 2. Regular Wayback URL
 * 3. Original URL (if fallbackToOriginal is true)
 */
export async function screenshotWithJina(
  url: string,
  options: { timeoutMs?: number; engine?: Engine; fallbackToOriginal?: boolean } = {},
): Promise<JinaScreenshotResult> {
  const apiKey = process.env.JINA_API_KEY || '';
  const timeoutMs = options.timeoutMs || 45_000;
  const startTime = Date.now();

  const engines = options.engine ? [options.engine] : SCREENSHOT_ENGINES;
  const urlsToTry = getUrlsToTry(url, { fallbackToOriginal: options.fallbackToOriginal });
  let lastError = '';

  for (const targetUrl of urlsToTry) {
    for (let i = 0; i < engines.length; i++) {
      const engine = engines[i];
      if (i > 0 || targetUrl !== urlsToTry[0]) {
        console.log(`[JinaCapture] ⟳ Trying screenshot with engine=${engine} for ${targetUrl}`);
      }

      try {
        const result = await _fetchScreenshot(targetUrl, { apiKey, timeoutMs, engine, format: 'screenshot' });

        if (result.success && result.base64 && result.base64.length > 0) {
          result.captureTimeMs = Date.now() - startTime;
          if (targetUrl !== url) {
            console.log(`[JinaCapture] ✓ Screenshot succeeded using fallback URL: ${targetUrl}`);
          }
          return result;
        }

        lastError = result.error || `screenshot via engine="${engine}" returned no image data`;
        console.log(`[JinaCapture] ✗ ${lastError}`);
      } catch (err: any) {
        lastError = err?.name === 'AbortError'
          ? `Jina screenshot timed out after ${timeoutMs}ms (engine=${engine})`
          : `Jina screenshot failed (engine=${engine}): ${err?.message || err}`;
        console.log(`[JinaCapture] ✗ ${lastError}`);
      }
    }
  }

  return { success: false, error: lastError, captureTimeMs: Date.now() - startTime };
}

async function _fetchScreenshot(
  url: string,
  opts: { apiKey: string; timeoutMs: number; engine: Engine; format: string },
): Promise<JinaScreenshotResult> {
  const headers: Record<string, string> = {
    'X-Return-Format': opts.format,
    'X-Timeout': '30',
  };
  if (opts.engine !== 'default') headers['X-Engine'] = opts.engine;
  if (opts.apiKey) headers['Authorization'] = `Bearer ${opts.apiKey}`;

  console.log(`[JinaCapture] Capturing ${url} (format=${opts.format}, engine=${opts.engine})`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);

  const res = await fetch(`https://r.jina.ai/${url}`, {
    headers,
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    return {
      success: false,
      error: `Jina ${opts.format} ${res.status}: ${body.slice(0, 200)}`,
      captureTimeMs: 0,
    };
  }

  const contentType = res.headers.get('content-type') || '';

  if (contentType.includes('image')) {
    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    console.log(`[JinaCapture] ✓ ${(buffer.byteLength / 1024).toFixed(0)}KB ${opts.format} (engine=${opts.engine})`);
    return { success: true, base64, engine: opts.engine, captureTimeMs: 0 };
  }

  if (contentType.includes('application/json')) {
    const json = await res.json();
    const data = json.data || json;

    if (data.screenshotUrl) {
      const imgRes = await fetch(data.screenshotUrl);
      if (imgRes.ok) {
        const buffer = await imgRes.arrayBuffer();
        const base64 = Buffer.from(buffer).toString('base64');
        console.log(`[JinaCapture] ✓ ${(buffer.byteLength / 1024).toFixed(0)}KB ${opts.format} via URL (engine=${opts.engine})`);
        return { success: true, base64, engine: opts.engine, captureTimeMs: 0 };
      }
    }

    return {
      success: false,
      error: `JSON response from ${opts.format} engine="${opts.engine}" contained no usable image`,
      captureTimeMs: 0,
    };
  }

  return {
    success: false,
    error: `Unexpected content-type "${contentType}" from ${opts.format} engine="${opts.engine}"`,
    captureTimeMs: 0,
  };
}
