import { NextRequest, NextResponse } from 'next/server';
import puppeteer from 'puppeteer-core';

export const runtime = 'nodejs';
export const maxDuration = 120;

function getLocalChromePath(): string {
  // Allow overriding via env for non-standard installs.
  const envPath = process.env.CHROME_PATH;
  if (envPath) return envPath;

  // Default dev paths.
  if (process.platform === 'darwin') {
    return '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  }
  if (process.platform === 'linux') return '/usr/bin/google-chrome';
  return 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function postMetric(baseUrl: string, payload: any) {
  const res = await fetch(`${baseUrl}/api/charts/metric`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST /api/charts/metric failed: ${res.status} ${text}`);
}

export async function GET(req: NextRequest) {
  // Keep this dev-only: it launches a local browser.
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 404 });
  }

  const { searchParams } = new URL(req.url);
  const symbol = String(searchParams.get('symbol') || 'GOLD');
  const marketId = String(
    searchParams.get('marketId') || '43d832a7-f439-4e94-933d-b05ef4c963fd'
  );
  const metricName = String(searchParams.get('metricName') || 'GOLD');
  const sentValue = Number(searchParams.get('value') || 77777);
  const waitMs = Number(searchParams.get('waitMs') || 4000);

  const baseUrl = `${req.nextUrl.protocol}//${req.nextUrl.host}`;
  const url = `${baseUrl}/token/${encodeURIComponent(symbol)}?metricDebug=1`;

  const browser = await puppeteer.launch({
    headless: true,
    executablePath: getLocalChromePath(),
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    defaultViewport: { width: 1500, height: 900 },
  });

  try {
    const page = await browser.newPage();

    // Surface realtime logs if present.
    const consoleLogs: string[] = [];
    page.on('console', (msg) => {
      try {
        const t = msg.text();
        if (t.includes('[REALTIME_METRIC]')) {
          consoleLogs.push(t.slice(0, 500));
        }
      } catch {
        // ignore
      }
    });

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 120_000 });

    // Wait for chart canvases to appear and settle.
    try {
      await page.waitForSelector('canvas', { timeout: 45_000 });
    } catch {
      // continue anyway; page might still be useful
    }
    await sleep(10_000);

    const before = (await page.screenshot({ type: 'png' })).toString('base64');

    await postMetric(baseUrl, {
      marketId,
      metricName,
      source: 'dev_verify_endpoint',
      version: Date.now() % 2_147_483_647,
      points: { ts: Date.now(), value: sentValue },
      confidence: 0.95,
      assetPriceSuggestion: String(sentValue.toFixed(2)),
      sourcesCount: 1,
    });

    await sleep(waitMs);

    const after = (await page.screenshot({ type: 'png' })).toString('base64');

    // Also try to read last realtime value store from the main page context.
    const storeSnapshot = await page.evaluate(() => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const store = (window as any).__DEXEXTRA_METRIC_REALTIME_VALUES__;
        if (!store || !(store instanceof Map)) return null;
        const out: any[] = [];
        store.forEach((v: any, k: any) => out.push([String(k), v]));
        return out.slice(0, 20);
      } catch {
        return null;
      }
    });

    return NextResponse.json({
      ok: true,
      url,
      marketId,
      metricName,
      sentValue,
      beforeBase64: before,
      afterBase64: after,
      storeSnapshot,
      consoleLogs: consoleLogs.slice(-50),
    });
  } finally {
    try {
      await browser.close();
    } catch {
      // ignore
    }
  }
}

