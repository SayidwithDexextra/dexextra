import type { Browser as CoreBrowser, PuppeteerLaunchOptions } from 'puppeteer-core';

// Unify Browser type export for consumers
export type Browser = CoreBrowser;

function isServerlessEnvironment(): boolean {
  return Boolean(process.env.AWS_LAMBDA_FUNCTION_VERSION || process.env.VERCEL);
}

export async function launchBrowser(extraArgs: string[] = []): Promise<Browser> {
  const serverless = isServerlessEnvironment();

  if (serverless) {
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteerCore = (await import('puppeteer-core')).default;

    const launchOptions: PuppeteerLaunchOptions = {
      args: [...chromium.args, ...extraArgs],
      defaultViewport: chromium.defaultViewport,
      executablePath: await chromium.executablePath(),
      headless: chromium.headless,
    };

    return puppeteerCore.launch(launchOptions);
  }

  // Local dev / non-serverless
  const puppeteer = (await import('puppeteer')).default;
  return puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', ...extraArgs],
  }) as unknown as Browser;
}


