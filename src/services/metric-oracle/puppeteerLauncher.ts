import type { Browser as CoreBrowser, PuppeteerLaunchOptions } from 'puppeteer-core';

// Unify Browser type export for consumers
export type Browser = CoreBrowser;

export function isServerlessEnvironment(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.VERCEL);
}

// Memoize chromium and its executable path to avoid concurrent extraction
let chromiumModulePromise: Promise<any> | null = null;
let puppeteerCoreModulePromise: Promise<any> | null = null;
let chromiumExecutablePathPromise: Promise<string> | null = null;

// Simple mutex to serialize launches in serverless, preventing ETXTBSY
let isLaunching = false;
const waiters: Array<() => void> = [];
async function acquireLaunchLock(): Promise<void> {
  if (!isLaunching) {
    isLaunching = true;
    return;
  }
  await new Promise<void>(resolve => waiters.push(resolve));
}
function releaseLaunchLock(): void {
  const next = waiters.shift();
  if (next) {
    next();
  } else {
    isLaunching = false;
  }
}

export async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  const serverless = isServerlessEnvironment();

  if (serverless) {
    await acquireLaunchLock();
    try {
      chromiumModulePromise = chromiumModulePromise || import('@sparticuz/chromium');
      const chromiumModule = await chromiumModulePromise;
      const chromium = chromiumModule.default;

      puppeteerCoreModulePromise = puppeteerCoreModulePromise || import('puppeteer-core');
      const puppeteerCore = (await puppeteerCoreModulePromise).default;

      chromiumExecutablePathPromise = chromiumExecutablePathPromise || chromium.executablePath();
      const execPath = await chromiumExecutablePathPromise;

      const launchOptions: PuppeteerLaunchOptions = {
        args: [...chromium.args, ...extraArgs],
        defaultViewport: chromium.defaultViewport,
        executablePath: execPath,
        headless: chromium.headless,
      };

      return await puppeteerCore.launch(launchOptions);
    } finally {
      releaseLaunchLock();
    }
  }

  // Local dev / non-serverless
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...extraArgs],
  }) as unknown as Browser;
}


