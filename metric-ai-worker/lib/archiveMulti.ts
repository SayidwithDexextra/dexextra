/**
 * UNIFIED Multi-Archive "Belt and Suspenders" Implementation
 * 
 * This is the SINGLE SOURCE OF TRUTH for all archiving in Dexextra.
 * Lives in metric-ai-worker and is exposed via API for other services.
 * 
 * Archives URLs to multiple services in parallel for redundancy:
 * - Internet Archive Wayback Machine (primary)
 * - Archive.today (secondary)
 * 
 * Returns as soon as ANY archive succeeds, but continues archiving
 * to remaining services in the background for maximum coverage.
 */

import { archivePage, type ArchiveResult } from './archivePage';
import { archiveToday, type ArchiveTodayResult } from './archiveToday';

export type ArchiveProvider = 'internet_archive' | 'archive_today';

export type ProviderResult = {
  provider: ArchiveProvider;
  success: boolean;
  url?: string;
  timestamp?: string;
  error?: string;
  durationMs?: number;
};

export type MultiArchiveResult = {
  success: boolean;
  primaryUrl?: string;
  primaryProvider?: ArchiveProvider;
  archives: ProviderResult[];
  timeToFirstSuccessMs?: number;
  error?: string;
};

export type MultiArchiveOptions = {
  /** Providers to use (default: all available) */
  providers?: ArchiveProvider[];
  /** Timeout for each provider (ms) */
  providerTimeoutMs?: number;
  /** Overall timeout (ms) */
  totalTimeoutMs?: number;
  /** User-Agent string */
  userAgent?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum age of acceptable existing archive in ms (default: 2 minutes). Set to 0 to accept any. */
  maxAgeMs?: number;
};

const DEFAULT_PROVIDERS: ArchiveProvider[] = ['internet_archive', 'archive_today'];
const DEFAULT_PROVIDER_TIMEOUT = 45_000;  // 45s - complex pages need more time
const DEFAULT_TOTAL_TIMEOUT = 50_000;     // 50s total

function log(debug: boolean | undefined, ...args: any[]) {
  if (debug) {
    console.log('[archiveMulti]', ...args);
  }
}

/**
 * Archive to Internet Archive Wayback Machine.
 */
async function archiveToIA(
  url: string,
  options: MultiArchiveOptions
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const result: ArchiveResult = await archivePage(url, {
      timeoutMs: options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT,
      maxAgeMs: options.maxAgeMs,
    });

    return {
      provider: 'internet_archive',
      success: result.success,
      url: result.waybackUrl,
      timestamp: result.timestamp,
      error: result.error,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      provider: 'internet_archive',
      success: false,
      error: err?.message || 'Unknown error',
      durationMs: Date.now() - start,
    };
  }
}

/**
 * Archive to Archive.today.
 */
async function archiveToArchiveToday(
  url: string,
  options: MultiArchiveOptions
): Promise<ProviderResult> {
  const start = Date.now();
  try {
    const result: ArchiveTodayResult = await archiveToday(url, {
      timeoutMs: options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT,
      userAgent: options.userAgent,
      forceNew: true,
    });

    return {
      provider: 'archive_today',
      success: result.success,
      url: result.archiveUrl,
      error: result.error,
      durationMs: Date.now() - start,
    };
  } catch (err: any) {
    return {
      provider: 'archive_today',
      success: false,
      error: err?.message || 'Unknown error',
      durationMs: Date.now() - start,
    };
  }
}

function getArchiveFunction(
  provider: ArchiveProvider
): (url: string, options: MultiArchiveOptions) => Promise<ProviderResult> {
  switch (provider) {
    case 'internet_archive':
      return archiveToIA;
    case 'archive_today':
      return archiveToArchiveToday;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutValue: T
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => setTimeout(() => resolve(timeoutValue), timeoutMs)),
  ]);
}

/**
 * Archive a URL to multiple services in parallel.
 * 
 * This is the main entry point for all archiving in Dexextra.
 * Returns as soon as ANY provider succeeds, with all results aggregated.
 */
export async function archiveMulti(
  urlToArchive: string,
  options: MultiArchiveOptions = {}
): Promise<MultiArchiveResult> {
  const startTime = Date.now();
  const debug = options.debug ?? false;
  const totalTimeout = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT;
  const providerTimeout = options.providerTimeoutMs ?? DEFAULT_PROVIDER_TIMEOUT;
  const providers = options.providers ?? [...DEFAULT_PROVIDERS];

  log(debug, `Archiving ${urlToArchive} to providers:`, providers);

  if (providers.length === 0) {
    return {
      success: false,
      archives: [],
      error: 'No archive providers configured',
    };
  }

  const createTimeoutResult = (provider: ArchiveProvider): ProviderResult => ({
    provider,
    success: false,
    error: 'Timeout',
    durationMs: providerTimeout,
  });

  // Launch all archive requests in parallel
  const archivePromises = providers.map((provider) => {
    const archiveFn = getArchiveFunction(provider);
    return withTimeout(
      archiveFn(urlToArchive, options),
      providerTimeout,
      createTimeoutResult(provider)
    );
  });

  const results: ProviderResult[] = [];
  let firstSuccess: ProviderResult | null = null;
  let timeToFirstSuccess: number | undefined;

  // Wait for first success or all complete
  const firstSuccessPromise = new Promise<void>((resolve) => {
    let pending = archivePromises.length;

    archivePromises.forEach((promise, index) => {
      promise.then((result) => {
        results[index] = result;
        
        if (result.success && !firstSuccess) {
          firstSuccess = result;
          timeToFirstSuccess = Date.now() - startTime;
          log(debug, `First success from ${result.provider} in ${timeToFirstSuccess}ms`);
          resolve();
        }

        pending--;
        if (pending === 0) {
          resolve();
        }
      });
    });
  });

  await withTimeout(firstSuccessPromise, totalTimeout, undefined);
  await new Promise((r) => setTimeout(r, 100));

  // Collect all results
  const allSettled = await Promise.allSettled(archivePromises);
  allSettled.forEach((settled, index) => {
    if (settled.status === 'fulfilled' && !results[index]) {
      results[index] = settled.value;
    } else if (settled.status === 'rejected' && !results[index]) {
      results[index] = {
        provider: providers[index],
        success: false,
        error: settled.reason?.message || 'Unknown error',
      };
    }
  });

  const finalResults = results.filter(Boolean);
  const anySuccess = finalResults.some((r) => r.success);
  const successfulResults = finalResults.filter((r) => r.success);

  log(debug, 'All results:', finalResults);

  if (anySuccess) {
    // Prefer Internet Archive as primary, then archive.today
    const primaryOrder: ArchiveProvider[] = ['internet_archive', 'archive_today'];
    const primary = primaryOrder
      .map((p) => successfulResults.find((r) => r.provider === p))
      .find(Boolean);

    return {
      success: true,
      primaryUrl: primary?.url || successfulResults[0]?.url,
      primaryProvider: primary?.provider || successfulResults[0]?.provider,
      archives: finalResults,
      timeToFirstSuccessMs: timeToFirstSuccess,
    };
  }

  const errors = finalResults
    .filter((r) => r.error)
    .map((r) => `${r.provider}: ${r.error}`)
    .join('; ');

  return {
    success: false,
    archives: finalResults,
    error: errors || 'All archive providers failed',
  };
}

// Re-export types for convenience
export type { ArchiveResult } from './archivePage';
export type { ArchiveTodayResult } from './archiveToday';

export default archiveMulti;
