/**
 * Auto-discovery of CSS/XPath/JS selectors for fast metric extraction.
 *
 * After a successful full-pipeline extraction (high confidence, validated),
 * this module launches a lightweight Puppeteer session, finds DOM nodes
 * containing the confirmed value, and builds ranked selectors that can
 * be re-used on subsequent fetches to skip the expensive vision pipeline.
 */

import puppeteer, { Browser, Page } from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

const IS_SERVERLESS = !!process.env.AWS_LAMBDA_FUNCTION_NAME ||
                      !!process.env.VERCEL ||
                      process.env.NODE_ENV === 'production';

const LOCAL_CHROME_PATHS = {
  darwin: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  linux: '/usr/bin/google-chrome',
  win32: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
};

// ─── Types ─────────────────────────────────────────────────────────

export interface DiscoveredSelector {
  type: 'css' | 'xpath' | 'js_extractor';
  selector?: string;
  xpath?: string;
  script?: string;
  confidence: number;
  sample_value: string;
}

export interface AiSourceLocatorData {
  url: string;
  discovered_at: string;
  selectors: DiscoveredSelector[];
  text_pattern: string | null;
  primary_evidence_type: string;
  last_successful_at: string | null;
  success_count: number;
  failure_count: number;
  version: number;
}

// ─── Browser helpers ───────────────────────────────────────────────

async function launchBrowser(): Promise<Browser> {
  const antiDetectArgs = [
    '--disable-blink-features=AutomationControlled',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--mute-audio',
    '--no-first-run',
  ];

  let executablePath: string;
  let browserArgs: string[];

  if (IS_SERVERLESS) {
    executablePath = await chromium.executablePath();
    browserArgs = [
      ...chromium.args, ...antiDetectArgs,
      '--disable-gpu', '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-background-networking', '--disable-default-apps',
      '--disable-extensions', '--disable-sync', '--disable-translate',
      '--metrics-recording-only', '--safebrowsing-disable-auto-update',
    ];
  } else {
    const platform = process.platform as keyof typeof LOCAL_CHROME_PATHS;
    executablePath = process.env.CHROME_PATH || LOCAL_CHROME_PATHS[platform] || LOCAL_CHROME_PATHS.darwin;
    browserArgs = [
      ...antiDetectArgs,
      '--disable-gpu', '--disable-background-networking',
      '--disable-default-apps', '--disable-extensions', '--disable-sync',
    ];
  }

  return puppeteer.launch({
    args: browserArgs,
    defaultViewport: { width: 1280, height: 800 },
    executablePath,
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

async function safeClose(browser: Browser | null): Promise<void> {
  if (!browser) return;
  try {
    await Promise.race([
      browser.close(),
      new Promise<void>((resolve) => setTimeout(() => {
        try { browser.process()?.kill('SIGKILL'); } catch {}
        resolve();
      }, 5000)),
    ]);
  } catch {}
}

// ─── Core discovery logic (runs inside page.evaluate) ──────────────

interface RawCandidate {
  css: string;
  xpath: string;
  text: string;
  specificity: number;
  context: string;
}

/**
 * Build a reasonably unique CSS selector for a given element.
 * Prefers IDs and data attributes, falls back to class+nth-child.
 */
function buildCssSelectorScript(): string {
  return `
    (function buildCssSelector(el) {
      if (!el || el === document.body || el === document.documentElement) return 'body';
      const parts = [];
      let cur = el;
      for (let depth = 0; depth < 8 && cur && cur !== document.body; depth++) {
        if (cur.id) {
          parts.unshift('#' + CSS.escape(cur.id));
          break;
        }
        let part = cur.tagName.toLowerCase();
        // Prefer data-test / data-testid attributes
        const testAttr = cur.getAttribute('data-test') || cur.getAttribute('data-testid');
        if (testAttr) {
          part = cur.tagName.toLowerCase() + '[data-test="' + testAttr + '"]';
          parts.unshift(part);
          break;
        }
        // Use stable classes (skip dynamic hashes)
        const stableClasses = Array.from(cur.classList)
          .filter(c => c.length < 40 && !/^[a-z]{1,3}[A-Z0-9]/.test(c) && !/^css-/.test(c))
          .slice(0, 2);
        if (stableClasses.length) {
          part += '.' + stableClasses.map(c => CSS.escape(c)).join('.');
        }
        // nth-child disambiguation
        const parent = cur.parentElement;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            part += ':nth-child(' + idx + ')';
          }
        }
        parts.unshift(part);
        cur = cur.parentElement;
      }
      return parts.join(' > ');
    })
  `;
}

function buildXpathScript(): string {
  return `
    (function buildXPath(el) {
      if (!el) return '';
      const parts = [];
      let cur = el;
      for (let depth = 0; depth < 8 && cur && cur.nodeType === 1; depth++) {
        if (cur.id) {
          parts.unshift('//*[@id="' + cur.id + '"]');
          break;
        }
        let tag = cur.tagName.toLowerCase();
        const parent = cur.parentNode;
        if (parent) {
          const siblings = Array.from(parent.children).filter(s => s.tagName === cur.tagName);
          if (siblings.length > 1) {
            const idx = siblings.indexOf(cur) + 1;
            tag += '[' + idx + ']';
          }
        }
        parts.unshift(tag);
        cur = cur.parentElement;
      }
      const prefix = parts[0]?.startsWith('//*') ? '' : '//';
      return prefix + parts.join('/');
    })
  `;
}

// ─── Public API ────────────────────────────────────────────────────

/**
 * Discover DOM selectors that resolve to `confirmedValue`.
 *
 * When `existingPage` is provided (from Phase 1 screenshot capture), the
 * browser launch and navigation are skipped entirely — only the DOM probing
 * runs. This saves ~15-20s per create-context request.
 */
export async function discoverLocators(
  url: string,
  confirmedValue: string,
  primaryEvidenceType: string = 'vision',
  existingPage?: Page,
): Promise<AiSourceLocatorData | null> {
  const started = Date.now();
  let browser: Browser | null = null;

  try {
    const numericStr = String(confirmedValue).replace(/[^0-9.\-]/g, '');
    if (!numericStr || !Number.isFinite(Number(numericStr))) {
      console.log('[AutoLocator] Skipped — confirmed value not numeric');
      return null;
    }

    let page: Page;
    if (existingPage) {
      page = existingPage;
      console.log(`[AutoLocator] Reusing existing page (skipping browser launch + navigation)`);
    } else {
      browser = await launchBrowser();
      page = await browser.newPage();

      await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
      });
      await page.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
      );

      const isChartSite = /tradingview|finviz|barchart|investing\.com/i.test(url);
      if (!isChartSite) {
        await page.setRequestInterception(true);
        page.on('request', (req) => {
          const rt = req.resourceType();
          if (rt === 'media' || rt === 'font') req.abort().catch(() => {});
          else req.continue().catch(() => {});
        });
      }

      await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));
    }

    const candidates: RawCandidate[] = await page.evaluate(
      (valueStr: string, cssScript: string, xpathScript: string) => {
        const found: RawCandidate[] = [];
        const normalizedTarget = valueStr.replace(/,/g, '');

        const treeWalker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
        );

        let node: Node | null;
        while ((node = treeWalker.nextNode())) {
          const text = (node.textContent || '').trim();
          if (!text) continue;

          const cleaned = text.replace(/[$€£¥,\s]/g, '');
          if (!cleaned.includes(normalizedTarget)) continue;

          const el = node.parentElement;
          if (!el) continue;

          const rect = el.getBoundingClientRect();
          if (rect.width === 0 && rect.height === 0) continue;

          const buildCss = new Function('el', `return (${cssScript.trim()})(el)`);
          const buildXp = new Function('el', `return (${xpathScript.trim()})(el)`);

          const css = buildCss(el) as string;
          const xpath = buildXp(el) as string;
          if (!css) continue;

          let specificity = 0;
          if (css.includes('#')) specificity += 3;
          if (css.includes('[data-test')) specificity += 2;
          if (css.includes('.')) specificity += 1;
          if (rect.top < 600) specificity += 1;
          if (el.closest('[class*="price"], [class*="Price"], [class*="value"], [class*="Value"]')) specificity += 2;

          const parentText = (el.parentElement?.textContent || '').trim().slice(0, 120);

          found.push({ css, xpath, text: text.slice(0, 80), specificity, context: parentText });
        }

        found.sort((a, b) => b.specificity - a.specificity);
        return found.slice(0, 6);
      },
      numericStr,
      buildCssSelectorScript(),
      buildXpathScript(),
    );

    if (candidates.length === 0) {
      console.log(`[AutoLocator] No DOM matches for "${numericStr}" on ${url} (${Date.now() - started}ms)`);
      if (!existingPage) await safeClose(browser);
      return null;
    }

    // Verify each candidate re-resolves to the value
    const verified: DiscoveredSelector[] = [];
    for (const c of candidates) {
      const resolvedCSS = await page.evaluate((sel: string) => {
        try {
          const el = document.querySelector(sel);
          return (el?.textContent || '').trim();
        } catch { return ''; }
      }, c.css);

      const resolvedClean = (resolvedCSS || '').replace(/[$€£¥,\s]/g, '');
      const matches = resolvedClean.includes(numericStr);

      if (matches) {
        const conf = Math.min(0.95, 0.5 + c.specificity * 0.1);
        verified.push({ type: 'css', selector: c.css, confidence: conf, sample_value: numericStr });

        if (c.xpath) {
          verified.push({ type: 'xpath', xpath: c.xpath, confidence: conf - 0.05, sample_value: numericStr });
        }

        const jsScript = `document.querySelector('${c.css.replace(/'/g, "\\'")}')?.textContent?.trim()`;
        verified.push({ type: 'js_extractor', script: jsScript, confidence: conf - 0.1, sample_value: numericStr });
      }
    }

    if (verified.length === 0) {
      console.log(`[AutoLocator] Candidates found but none re-verified on ${url}`);
      if (!existingPage) await safeClose(browser);
      return null;
    }

    verified.sort((a, b) => b.confidence - a.confidence);
    const topSelectors = verified.slice(0, 9);

    // Build a text pattern from the surrounding context of the best match
    let textPattern: string | null = null;
    const bestCtx = candidates[0]?.context || '';
    if (bestCtx && numericStr) {
      const escaped = numericStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const idx = bestCtx.replace(/[$€£¥,\s]/g, '').indexOf(numericStr);
      if (idx >= 0) {
        textPattern = `[\\$€£¥]?\\s*${escaped.replace(/\d/g, '\\d')}`;
      }
    }

    const now = new Date().toISOString();
    const result: AiSourceLocatorData = {
      url,
      discovered_at: now,
      selectors: topSelectors,
      text_pattern: textPattern,
      primary_evidence_type: primaryEvidenceType,
      last_successful_at: now,
      success_count: 1,
      failure_count: 0,
      version: 1,
    };

    console.log(`[AutoLocator] Discovered ${topSelectors.length} selectors for ${url} in ${Date.now() - started}ms`);
    if (!existingPage) await safeClose(browser);
    return result;

  } catch (err) {
    console.error('[AutoLocator] Discovery failed:', err instanceof Error ? err.message : err);
    if (!existingPage) await safeClose(browser);
    return null;
  }
}

/**
 * Use stored selectors to extract a value without the full vision pipeline.
 * Launches a minimal Puppeteer session, tries each selector in order, and
 * returns the first numeric match or null.
 */
export async function fastExtract(
  url: string,
  selectors: DiscoveredSelector[],
): Promise<{ value: string; method: string; selector: string; extractTimeMs: number } | null> {
  const started = Date.now();
  let browser: Browser | null = null;

  try {
    browser = await launchBrowser();
    const page: Page = await browser.newPage();

    await page.evaluateOnNewDocument(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => false });
    });
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
    );

    const isChartSite = /tradingview|finviz|barchart|investing\.com/i.test(url);
    if (!isChartSite) {
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const rt = req.resourceType();
        if (rt === 'media' || rt === 'font' || rt === 'image') req.abort().catch(() => {});
        else req.continue().catch(() => {});
      });
    }

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25000 }).catch(() => {});
    await new Promise(r => setTimeout(r, 2000));

    const sorted = [...selectors].sort((a, b) => b.confidence - a.confidence);

    for (const sel of sorted) {
      try {
        let rawText: string | null = null;

        if (sel.type === 'css' && sel.selector) {
          rawText = await page.evaluate((s: string) => {
            const el = document.querySelector(s);
            return el ? (el.textContent || '').trim() : null;
          }, sel.selector);
        } else if (sel.type === 'xpath' && sel.xpath) {
          rawText = await page.evaluate((xp: string) => {
            const result = document.evaluate(xp, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            const node = result.singleNodeValue;
            return node ? (node.textContent || '').trim() : null;
          }, sel.xpath);
        } else if (sel.type === 'js_extractor' && sel.script) {
          rawText = await page.evaluate((code: string) => {
            try {
              const fn = new Function('document', `return (${code})`);
              const result = fn(document);
              return result != null ? String(result).trim() : null;
            } catch { return null; }
          }, sel.script);
        }

        if (!rawText) continue;

        const cleaned = rawText.replace(/[$€£¥,\s]/g, '');
        const numMatch = cleaned.match(/-?[\d]+\.?\d*/);
        if (!numMatch) continue;

        const num = Number(numMatch[0]);
        if (!Number.isFinite(num) || num <= 0) continue;

        await safeClose(browser);
        browser = null;

        return {
          value: numMatch[0],
          method: sel.type,
          selector: sel.selector || sel.xpath || sel.script || '',
          extractTimeMs: Date.now() - started,
        };
      } catch {
        continue;
      }
    }

    await safeClose(browser);
    return null;
  } catch (err) {
    console.error('[FastExtract] Failed:', err instanceof Error ? err.message : err);
    await safeClose(browser);
    return null;
  }
}
