import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { launchBrowser } from '@/services/metric-oracle/puppeteerLauncher';

export const runtime = 'nodejs';
export const maxDuration = 60;

const InputSchema = z.object({
  url: z.string().url(),
  xpath: z.string().optional(),
  js_extractor: z.string().optional(),
  css_selector: z.string().optional(),
  // Optional dynamic wait & retry controls
  wait_ms: z.number().int().min(0).max(60000).optional(),
  wait_for_xpath: z.boolean().optional(),
  wait_for_selector: z.boolean().optional(),
  retries: z.number().int().min(0).max(20).optional(),
  retry_delay_ms: z.number().int().min(0).max(60000).optional(),
});

export async function POST(request: NextRequest) {
  let browser: any | null = null;
  try {
    const body = await request.json();
    const input = InputSchema.parse(body);

    if (!input.xpath && !input.js_extractor && !input.css_selector) {
      return NextResponse.json({ error: 'Provide xpath, js_extractor, or css_selector' }, { status: 400 });
    }

    browser = await launchBrowser();

    const page = await browser.newPage();
    page.setDefaultTimeout(20000);
    page.setDefaultNavigationTimeout(20000);
    await page.goto(input.url, { waitUntil: 'networkidle2', timeout: 20000 });

    // Optional targeted waits
    const initialWait = typeof input.wait_ms === 'number' ? input.wait_ms : 1500;
    try {
      if (input.wait_for_xpath && input.xpath) {
        await page.waitForXPath(input.xpath as string, { timeout: Math.max(0, initialWait) });
      } else if (input.wait_for_selector && input.css_selector) {
        await page.waitForSelector(input.css_selector as string, { timeout: Math.max(0, initialWait) });
      } else if (initialWait > 0) {
        await new Promise(r => setTimeout(r, initialWait));
      }
    } catch (_) {
      // ignore timeout on initial targeted wait
    }

    async function attemptExtract(): Promise<string> {
      return await page.evaluate(({ code, selector, xpath }) => {
      function cleanNumeric(text: string): string {
        const t = String(text || '');
        return t.replace(/[^0-9+\-.,]/g, '').replace(/,/g, '').trim();
      }

      // Try XPath first
      if (xpath && typeof xpath === 'string') {
        try {
          const result = document.evaluate(xpath as string, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          const node = result.singleNodeValue as Node | null;
          if (node) {
            const text = (node as any).textContent || '';
            const cleaned = cleanNumeric(text);
            if (cleaned) return cleaned;
          }
        } catch (_) { /* ignore */ }
      }

      if (selector && typeof selector === 'string') {
        const el = document.querySelector(selector as string);
        const text = el ? (el.textContent || '') : '';
        const cleaned = cleanNumeric(text);
        if (cleaned) return cleaned;
      }

      // Fallback: provided JS extractor IIFE
      if (code && typeof code === 'string') {
        try {
          // eslint-disable-next-line no-eval
          const res = (0, eval)(code);
          if (typeof res === 'string') return cleanNumeric(res);
          if (res != null) return cleanNumeric(String(res));
        } catch (_) {
          // ignore
        }
      }

        return '';
      }, { code: input.js_extractor || '', selector: input.css_selector || '', xpath: input.xpath || '' });
    }

    const maxRetries = typeof input.retries === 'number' ? input.retries : 0;
    const retryDelay = typeof input.retry_delay_ms === 'number' ? input.retry_delay_ms : 2000;
    let value = await attemptExtract();
    let attempts = 1;
    const isNumeric = (v: string) => {
      if (!v) return false;
      const n = Number(String(v).replace(/,/g, ''));
      return Number.isFinite(n);
    };
    while (!isNumeric(value) && attempts <= maxRetries) {
      try {
        // Optional re-wait for the locator between retries
        if (input.wait_for_xpath && input.xpath) {
          await page.waitForXPath(input.xpath as string, { timeout: Math.max(0, retryDelay) });
        } else if (input.wait_for_selector && input.css_selector) {
          await page.waitForSelector(input.css_selector as string, { timeout: Math.max(0, retryDelay) });
        } else if (retryDelay > 0) {
          await new Promise(r => setTimeout(r, retryDelay));
        }
      } catch {}
      value = await attemptExtract();
      attempts += 1;
    }

    try { await page.close(); } catch {}
    try { await browser.close(); } catch {}
    browser = null;

    return NextResponse.json({
      ok: true,
      url: input.url,
      value,
      attempts,
      fetched_at: new Date().toISOString()
    });
  } catch (error: any) {
    if (browser) { try { await browser.close(); } catch {} }
    if (error instanceof z.ZodError) {
      return NextResponse.json({ ok: false, error: 'Invalid input', details: error.errors }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: error?.message || 'Failed to pull metric' }, { status: 500 });
  }
}


