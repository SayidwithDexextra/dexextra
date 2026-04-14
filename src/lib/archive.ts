/**
 * Unified Archive Client
 * 
 * This is a thin wrapper that calls the metric-ai-worker's archive API.
 * The actual archiving logic lives in metric-ai-worker/lib/archiveMulti.ts
 * 
 * IMPORTANT: This is the ONLY place in the main app that should handle archiving.
 * Do not import archivePage, archiveToday, or archivePageMulti directly.
 */

export type ArchiveProvider = 'internet_archive' | 'archive_today';

export type ProviderResult = {
  provider: ArchiveProvider;
  success: boolean;
  url?: string;
  timestamp?: string;
  error?: string;
  durationMs?: number;
};

export type ArchiveResult = {
  success: boolean;
  primaryUrl?: string;
  primaryProvider?: ArchiveProvider;
  archives: ProviderResult[];
  timeToFirstSuccessMs?: number;
  error?: string;
};

export type ArchiveOptions = {
  /** Specific providers to use (default: all) */
  providers?: ArchiveProvider[];
  /** Timeout per provider in ms (default: 25000) */
  providerTimeoutMs?: number;
  /** Total timeout in ms (default: 30000) */
  totalTimeoutMs?: number;
  /** Custom user agent */
  userAgent?: string;
  /** Enable debug logging */
  debug?: boolean;
  /** Maximum age of acceptable existing archive in ms (default: 2 minutes). Set to 0 to accept any. */
  maxAgeMs?: number;
};

function getWorkerBaseUrl(): string {
  const configured = process.env.METRIC_AI_WORKER_URL 
    || process.env.NEXT_PUBLIC_METRIC_AI_WORKER_URL 
    || '';
  const localDefault = process.env.NEXT_PUBLIC_METRIC_AI_WORKER_URL_LOCAL 
    || 'http://localhost:3001';
  
  const isDev = process.env.NODE_ENV === 'development';
  const baseUrl = (configured || (isDev ? localDefault : '')).replace(/\/+$/, '');
  
  if (!baseUrl) {
    throw new Error(
      'Metric AI worker not configured. Set METRIC_AI_WORKER_URL or NEXT_PUBLIC_METRIC_AI_WORKER_URL'
    );
  }
  
  return baseUrl;
}

/**
 * Archive a URL using the unified multi-archive system.
 * 
 * This calls the metric-ai-worker's /api/archive endpoint, which handles:
 * - Internet Archive Wayback Machine
 * - Archive.today
 * 
 * @example
 * ```ts
 * const result = await archiveUrl('https://example.com');
 * if (result.success) {
 *   console.log('Primary archive:', result.primaryUrl);
 *   console.log('All archives:', result.archives);
 * }
 * ```
 */
export async function archiveUrl(
  url: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  const workerUrl = getWorkerBaseUrl();
  const endpoint = `${workerUrl}/api/archive`;

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url,
        providers: options.providers,
        providerTimeoutMs: options.providerTimeoutMs,
        totalTimeoutMs: options.totalTimeoutMs,
        userAgent: options.userAgent,
        debug: options.debug,
        maxAgeMs: options.maxAgeMs,
      }),
    });

    const result: ArchiveResult = await response.json();
    return result;
  } catch (error: any) {
    console.error('[archive] Failed to call archive API:', error?.message || error);
    return {
      success: false,
      archives: [],
      error: `Failed to call archive API: ${error?.message || 'Network error'}`,
    };
  }
}

/**
 * Archive a URL and return just the primary URL (convenience wrapper).
 */
export async function archiveUrlSimple(
  url: string,
  options: ArchiveOptions = {}
): Promise<string | null> {
  const result = await archiveUrl(url, options);
  return result.primaryUrl || null;
}

/**
 * @deprecated Use archiveUrl from src/lib/archive.ts instead.
 * This alias exists for backward compatibility during migration.
 */
export const archivePageMulti = archiveUrl;

export default archiveUrl;
