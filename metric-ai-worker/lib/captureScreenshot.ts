/**
 * Screenshot capture utility using serverless Puppeteer
 * Uses @sparticuz/chromium for AWS Lambda / Vercel compatibility
 * Falls back to local Chrome for development
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

// Detect if running in serverless environment
const IS_SERVERLESS = !!process.env.AWS_LAMBDA_FUNCTION_NAME || 
                      !!process.env.VERCEL || 
                      process.env.NODE_ENV === 'production';

// Local Chrome paths for development
const LOCAL_CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

export interface ScreenshotResult {
  success: boolean;
  /** Base64-encoded PNG image data */
  base64?: string;
  /** Screenshot dimensions */
  dimensions?: { width: number; height: number };
  /** Error message if capture failed */
  error?: string;
  /** Time taken to capture in ms */
  captureTimeMs?: number;
  /** Number of retry attempts made */
  retryAttempts?: number;
}

export interface ScreenshotOptions {
  /** Viewport width (default: 1280) */
  width?: number;
  /** Viewport height (default: 800) */
  height?: number;
  /** Wait for network idle before screenshot (default: true) */
  waitForNetworkIdle?: boolean;
  /** Additional wait time after load in ms (default: 1000) */
  additionalWaitMs?: number;
  /** Navigation timeout in ms (default: 30000) */
  timeoutMs?: number;
  /** Capture full scrollable page (default: false) */
  fullPage?: boolean;
  /** Number of retry attempts for transient errors (default: 2) */
  retryAttempts?: number;
}

const DEFAULT_OPTIONS: Required<ScreenshotOptions> = {
  width: 1280,
  height: 800,
  waitForNetworkIdle: true,
  additionalWaitMs: 1000,
  timeoutMs: 30000,
  fullPage: false,
  retryAttempts: 2,
};

// Transient error patterns that warrant retry
const TRANSIENT_ERROR_PATTERNS = [
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'socket hang up',
  'aborted',
  'net::ERR_',
  'Navigation timeout',
  'Target closed',
  'Protocol error',
  'Session closed',
];

function isTransientError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code || '';
  return TRANSIENT_ERROR_PATTERNS.some(
    (pattern) => message.includes(pattern) || code.includes(pattern)
  );
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Safely close browser with timeout
 */
async function safeCloseBrowser(browser: Browser | null): Promise<void> {
  if (!browser) return;
  
  try {
    // Race between close and timeout
    await Promise.race([
      browser.close(),
      sleep(5000).then(() => {
        // Force kill if close takes too long
        try {
          const process = browser.process();
          if (process) {
            process.kill('SIGKILL');
          }
        } catch {
          // Ignore kill errors
        }
      }),
    ]);
  } catch {
    // Ignore close errors
  }
}

/**
 * Internal screenshot capture implementation
 */
async function captureScreenshotInternal(
  url: string,
  opts: Required<ScreenshotOptions>
): Promise<ScreenshotResult> {
  const startTime = Date.now();
  let browser: Browser | null = null;

  try {
    // Validate URL
    const parsedUrl = new URL(url);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { success: false, error: 'Only HTTP/HTTPS URLs are supported' };
    }

    // Get executable path - use serverless chromium in production, local Chrome in dev
    let executablePath: string;
    let browserArgs: string[];
    
    if (IS_SERVERLESS) {
      executablePath = await chromium.executablePath();
      browserArgs = [
        ...chromium.args,
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--disable-translate',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
      ];
    } else {
      // Local development - use installed Chrome
      const platform = process.platform as keyof typeof LOCAL_CHROME_PATHS;
      executablePath = process.env.CHROME_PATH || LOCAL_CHROME_PATHS[platform] || LOCAL_CHROME_PATHS.darwin;
      browserArgs = [
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-background-networking',
        '--disable-default-apps',
        '--disable-extensions',
        '--disable-sync',
        '--mute-audio',
        '--no-first-run',
      ];
      console.log(`[Screenshot] Using local Chrome: ${executablePath}`);
    }

    // Launch browser
    browser = await puppeteer.launch({
      args: browserArgs,
      defaultViewport: {
        width: opts.width,
        height: opts.height,
      },
      executablePath,
      headless: true,
      // Prevent zombie processes
      handleSIGINT: false,
      handleSIGTERM: false,
      handleSIGHUP: false,
    });

    const page: Page = await browser.newPage();

    // Set up error handling for the page
    page.on('error', (err) => {
      console.error('Page error:', err.message);
    });

    page.on('pageerror', (err) => {
      // Ignore page JS errors - we just want the screenshot
    });

    // Set user agent to avoid bot detection
    await page.setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      // Block videos and large media, but allow images for visual context
      if (['media', 'font'].includes(resourceType)) {
        request.abort().catch(() => {});
      } else {
        request.continue().catch(() => {});
      }
    });

    // Navigate to URL with error handling
    const waitUntil = opts.waitForNetworkIdle ? 'networkidle2' : 'load';
    await page.goto(url, {
      waitUntil,
      timeout: opts.timeoutMs,
    });

    // Additional wait for JS-rendered content
    if (opts.additionalWaitMs > 0) {
      await sleep(opts.additionalWaitMs);
    }

    // Capture screenshot
    const screenshotBuffer = await page.screenshot({
      type: 'png',
      fullPage: opts.fullPage,
      encoding: 'binary',
    });

    // Convert to base64
    const base64 = Buffer.from(screenshotBuffer).toString('base64');

    const captureTimeMs = Date.now() - startTime;

    // Close browser before returning
    await safeCloseBrowser(browser);
    browser = null;

    console.log(`[Screenshot] Successfully captured ${url} (${opts.width}x${opts.height}) in ${captureTimeMs}ms`);

    return {
      success: true,
      base64,
      dimensions: { width: opts.width, height: opts.height },
      captureTimeMs,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: string })?.code || '';
    const captureTimeMs = Date.now() - startTime;
    
    console.error(`[Screenshot] Failed to capture ${url} after ${captureTimeMs}ms: ${code ? `[${code}] ` : ''}${message}`);
    
    return {
      success: false,
      error: `Screenshot capture failed: ${code ? `[${code}] ` : ''}${message}`,
      captureTimeMs,
    };
  } finally {
    await safeCloseBrowser(browser);
  }
}

/**
 * Capture a screenshot of a URL using serverless Puppeteer
 * Includes retry logic for transient errors (ECONNRESET, timeouts, etc.)
 */
export async function captureScreenshot(
  url: string,
  options: ScreenshotOptions = {}
): Promise<ScreenshotResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const maxAttempts = opts.retryAttempts + 1;
  
  let lastError: ScreenshotResult | null = null;
  
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await captureScreenshotInternal(url, opts);
    
    if (result.success) {
      if (attempt > 1) {
        console.log(`[Screenshot] Succeeded on attempt ${attempt} for ${url}`);
      }
      return {
        ...result,
        retryAttempts: attempt - 1,
      };
    }
    
    lastError = result;
    
    // Check if error is transient and we should retry
    if (attempt < maxAttempts && isTransientError(new Error(result.error))) {
      // Exponential backoff: 1s, 2s, 4s...
      const backoffMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[Screenshot] Attempt ${attempt}/${maxAttempts} failed for ${url}, retrying in ${backoffMs}ms: ${result.error}`);
      await sleep(backoffMs);
      continue;
    }
    
    // Non-transient error or out of retries
    break;
  }
  
  console.error(`[Screenshot] All ${maxAttempts} attempts failed for ${url}: ${lastError?.error}`);
  
  return {
    ...lastError!,
    retryAttempts: maxAttempts - 1,
  };
}

/**
 * Capture screenshots for multiple URLs in parallel
 */
export async function captureScreenshots(
  urls: string[],
  options: ScreenshotOptions = {}
): Promise<Map<string, ScreenshotResult>> {
  const results = new Map<string, ScreenshotResult>();
  
  // Process in parallel with concurrency limit
  const concurrencyLimit = 3;
  const chunks: string[][] = [];
  
  for (let i = 0; i < urls.length; i += concurrencyLimit) {
    chunks.push(urls.slice(i, i + concurrencyLimit));
  }

  for (const chunk of chunks) {
    const chunkResults = await Promise.all(
      chunk.map((url) => captureScreenshot(url, options))
    );
    
    chunk.forEach((url, index) => {
      results.set(url, chunkResults[index]);
    });
  }

  return results;
}

export default captureScreenshot;
