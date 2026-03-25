/**
 * External screenshot capture — replaces Puppeteer screenshots when SKIP_PUPPETEER=true.
 *
 * Calls an external screenshot API to render the page and return a PNG,
 * which then feeds into the existing multi-model vision consensus pipeline.
 *
 * Env vars:
 *   SCREENSHOT_API_KEY       — API key for the provider
 *   SCREENSHOT_API_PROVIDER  — 'screenshotone' (default) | 'custom'
 *   SCREENSHOT_API_URL       — Template URL for 'custom' provider.
 *                              Placeholders: {url}, {width}, {height}, {key}
 */

export interface ExternalScreenshotResult {
  success: boolean;
  base64?: string;
  error?: string;
  captureTimeMs: number;
}

export async function captureScreenshotExternal(
  url: string,
  options: { width?: number; height?: number; timeoutMs?: number } = {},
): Promise<ExternalScreenshotResult> {
  const provider = (process.env.SCREENSHOT_API_PROVIDER || 'screenshotone').toLowerCase();
  const apiKey = process.env.SCREENSHOT_API_KEY || '';

  if (!apiKey) {
    return { success: false, error: 'SCREENSHOT_API_KEY not configured', captureTimeMs: 0 };
  }

  const width = options.width || 1280;
  const height = options.height || 900;
  const timeoutMs = options.timeoutMs || 45_000;
  const startTime = Date.now();

  try {
    let apiUrl: string;

    switch (provider) {
      case 'screenshotone': {
        const params = new URLSearchParams({
          access_key: apiKey,
          url,
          viewport_width: String(width),
          viewport_height: String(height),
          format: 'png',
          block_ads: 'true',
          block_cookie_banners: 'true',
          delay: '3',
          timeout: '30',
          full_page: 'false',
        });
        apiUrl = `https://api.screenshotone.com/take?${params}`;
        break;
      }

      case 'custom': {
        const base = process.env.SCREENSHOT_API_URL;
        if (!base) {
          return { success: false, error: 'SCREENSHOT_API_URL not set for custom provider', captureTimeMs: 0 };
        }
        apiUrl = base
          .replace('{url}', encodeURIComponent(url))
          .replace('{width}', String(width))
          .replace('{height}', String(height))
          .replace('{key}', apiKey);
        break;
      }

      default:
        return { success: false, error: `Unknown SCREENSHOT_API_PROVIDER: "${provider}"`, captureTimeMs: 0 };
    }

    console.log(`[ExternalScreenshot] Requesting screenshot for ${url} via ${provider}`);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const res = await fetch(apiUrl, { signal: controller.signal });
    clearTimeout(timer);

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        success: false,
        error: `Screenshot API ${res.status}: ${body.slice(0, 200)}`,
        captureTimeMs: Date.now() - startTime,
      };
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('image')) {
      return {
        success: false,
        error: `Unexpected content-type: ${contentType}`,
        captureTimeMs: Date.now() - startTime,
      };
    }

    const buffer = await res.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const captureTimeMs = Date.now() - startTime;

    console.log(`[ExternalScreenshot] ✓ Captured in ${captureTimeMs}ms (${(buffer.byteLength / 1024).toFixed(0)}KB)`);

    return { success: true, base64, captureTimeMs };
  } catch (err: any) {
    const msg = err?.name === 'AbortError'
      ? `Screenshot API timed out after ${timeoutMs}ms`
      : `External screenshot failed: ${err?.message || err}`;
    return { success: false, error: msg, captureTimeMs: Date.now() - startTime };
  }
}
