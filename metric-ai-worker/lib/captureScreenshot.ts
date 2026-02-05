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

/**
 * Site-specific configuration for screenshot capture.
 * This allows tailored wait strategies for known sites while
 * using sensible defaults for unknown sites.
 */
interface SiteConfig {
  /** Which navigation event to wait for */
  waitUntil: 'load' | 'domcontentloaded' | 'networkidle0' | 'networkidle2';
  /** CSS selectors to wait for before taking screenshot (site-specific) */
  waitForSelectors?: string[];
  /** How long to wait for selectors (ms) */
  selectorTimeout?: number;
  /** Additional wait after selector found (for animations/renders) */
  postSelectorWait?: number;
  /** Description for logging */
  description: string;
}

/**
 * Known site configurations for optimal screenshot capture.
 * Add new sites here as needed.
 */
const SITE_CONFIGS: Array<{ pattern: RegExp; config: SiteConfig }> = [
  {
    // Finviz - futures charts, stock charts
    pattern: /finviz\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '#chart',                    // Main chart container
        'canvas',                    // Any canvas (chart render target)
        '.fv-container',             // Finviz container
        'table.snapshot-table2',     // Price table fallback
      ],
      selectorTimeout: 20000,
      postSelectorWait: 3000,        // Charts need time to render data
      description: 'Finviz (chart site)',
    },
  },
  {
    // TradingView - embedded charts and full site
    pattern: /tradingview\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        'canvas[class*="chart"]',
        '.chart-container canvas',
        '[class*="tv-lightweight-charts"]',
        '.price-axis canvas',
      ],
      selectorTimeout: 20000,
      postSelectorWait: 3000,
      description: 'TradingView (chart site)',
    },
  },
  {
    // Investing.com - financial data
    pattern: /investing\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '[data-test="instrument-price-last"]',
        '.instrument-price_last',
        '#last_last',
        'canvas',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'Investing.com (financial)',
    },
  },
  {
    // Barchart - commodities and futures
    pattern: /barchart\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '.pricechangerow',
        '.bc-quote-overview',
        'canvas',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'Barchart (commodities)',
    },
  },
  {
    // Yahoo Finance
    pattern: /finance\.yahoo\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '[data-test="qsp-price"]',
        'fin-streamer[data-field="regularMarketPrice"]',
        '.chart canvas',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'Yahoo Finance',
    },
  },
  {
    // Bloomberg
    pattern: /bloomberg\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '.price',
        '[class*="Price"]',
        '.security-summary',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'Bloomberg',
    },
  },
  {
    // CoinMarketCap
    pattern: /coinmarketcap\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '.priceValue span',
        '[class*="priceValue"]',
        '.cmc-details-panel-price',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'CoinMarketCap (crypto)',
    },
  },
  {
    // CoinGecko
    pattern: /coingecko\.com/i,
    config: {
      waitUntil: 'domcontentloaded',
      waitForSelectors: [
        '[data-target="price.price"]',
        '.no-wrap span',
        'canvas',
      ],
      selectorTimeout: 15000,
      postSelectorWait: 2000,
      description: 'CoinGecko (crypto)',
    },
  },
];

/**
 * Get site-specific configuration for a URL.
 * Returns default config for unknown sites.
 */
function getSiteConfig(url: string): SiteConfig {
  for (const { pattern, config } of SITE_CONFIGS) {
    if (pattern.test(url)) {
      return config;
    }
  }
  
  // Default config for unknown sites - use networkidle2 for reliability
  return {
    waitUntil: 'networkidle2',
    waitForSelectors: undefined, // No specific selectors to wait for
    selectorTimeout: 0,
    postSelectorWait: 0,
    description: 'Generic site (networkidle2)',
  };
}

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

    // Set user agent to avoid bot detection - use a recent Chrome version
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    );
    
    // Set extra headers to appear more like a real browser
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
    });

    // Block unnecessary resources for faster loading
    await page.setRequestInterception(true);
    page.on('request', (request) => {
      const resourceType = request.resourceType();
      const reqUrl = request.url().toLowerCase();
      
      // Block: videos, fonts, tracking/analytics, ads
      const blockedPatterns = [
        'google-analytics', 'googletagmanager', 'facebook.com/tr', 
        'doubleclick', 'adsense', 'adservice', 'analytics',
        'hotjar', 'mixpanel', 'segment.io', 'amplitude'
      ];
      const isBlocked = blockedPatterns.some(pattern => reqUrl.includes(pattern));
      
      if (['media', 'font'].includes(resourceType) || isBlocked) {
        request.abort().catch(() => {});
      } else {
        request.continue().catch(() => {});
      }
    });

    // Determine site-specific configuration based on URL
    const siteConfig = getSiteConfig(url);
    
    console.log(`[Screenshot] Site config for ${url}:`, siteConfig);

    // Navigate to URL with error handling
    const waitUntil = siteConfig.waitUntil;
    
    console.log(`[Screenshot] Navigating to ${url} (waitUntil: ${waitUntil}, timeout: ${opts.timeoutMs}ms)`);
    
    try {
      await page.goto(url, {
        waitUntil,
        timeout: opts.timeoutMs,
      });
    } catch (navError: unknown) {
      // If navigation times out, try to take screenshot anyway - page may be partially loaded
      const navMessage = navError instanceof Error ? navError.message : String(navError);
      if (navMessage.includes('timeout') || navMessage.includes('Timeout')) {
        console.warn(`[Screenshot] Navigation timeout for ${url}, attempting screenshot of partial page`);
        // Continue to screenshot - the page content may still be visible
      } else {
        throw navError; // Re-throw non-timeout errors
      }
    }

    // If site has specific selectors to wait for, wait for them
    if (siteConfig.waitForSelectors && siteConfig.waitForSelectors.length > 0) {
      const selectorWaitTimeout = Math.min(siteConfig.selectorTimeout || 15000, opts.timeoutMs / 2);
      console.log(`[Screenshot] Waiting up to ${selectorWaitTimeout}ms for site-specific elements`);
      
      let elementFound = false;
      try {
        const foundSelector = await Promise.race([
          ...siteConfig.waitForSelectors.map(selector => 
            page.waitForSelector(selector, { timeout: selectorWaitTimeout })
              .then(() => { elementFound = true; return selector; })
              .catch(() => null)
          ),
          sleep(selectorWaitTimeout).then(() => null)
        ]);
        
        if (elementFound && foundSelector) {
          console.log(`[Screenshot] Found element: ${foundSelector}, waiting for render`);
          // Give the element time to finish rendering
          await sleep(siteConfig.postSelectorWait || 2000);
        } else {
          console.log(`[Screenshot] No target elements found, proceeding`);
        }
      } catch {
        console.log(`[Screenshot] Element wait failed, proceeding anyway`);
      }
    }

    // Additional wait for JS-rendered content
    if (opts.additionalWaitMs > 0) {
      console.log(`[Screenshot] Waiting additional ${opts.additionalWaitMs}ms for JS rendering`);
      await sleep(opts.additionalWaitMs);
    }
    
    // Scroll to top to ensure we capture the main content
    try {
      await page.evaluate(() => window.scrollTo(0, 0));
    } catch {
      // Ignore scroll errors
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
