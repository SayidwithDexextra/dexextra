/**
 * Wayback Machine SavePageNow helper for the metric-ai-worker.
 * Archives URLs to the Internet Archive with retry logic.
 * Requires WAYBACK_API_ACCESS_KEY and WAYBACK_API_SECRET env vars.
 */

export type ArchiveResult = {
  success: boolean;
  waybackUrl?: string;
  timestamp?: string;
  error?: string;
};

const SAVE_ENDPOINT = 'https://web.archive.org/save';
const SAVE_STATUS = (id: string) => `https://web.archive.org/save/status/${encodeURIComponent(id)}`;
const CDX_SEARCH = (url: string) => `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(url)}&output=json&limit=1&sort=reverse`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildWaybackUrl(ts: string, url: string): string {
  return `https://web.archive.org/web/${ts}/${url}`;
}

/**
 * Check if a Wayback timestamp is fresh (within maxAgeMs of now).
 * Wayback timestamps are in format: YYYYMMDDHHmmss (UTC)
 */
function isTimestampFresh(timestamp: string | undefined, maxAgeMs: number = 2 * 60 * 1000): boolean {
  if (!timestamp || timestamp.length < 14) return false;
  
  try {
    const year = parseInt(timestamp.slice(0, 4));
    const month = parseInt(timestamp.slice(4, 6)) - 1; // JS months are 0-indexed
    const day = parseInt(timestamp.slice(6, 8));
    const hour = parseInt(timestamp.slice(8, 10));
    const minute = parseInt(timestamp.slice(10, 12));
    const second = parseInt(timestamp.slice(12, 14));
    
    const archiveDate = new Date(Date.UTC(year, month, day, hour, minute, second));
    const ageMs = Date.now() - archiveDate.getTime();
    
    console.log(`[archivePage] Timestamp ${timestamp} is ${Math.round(ageMs / 1000)}s old (max: ${maxAgeMs / 1000}s)`);
    
    return ageMs <= maxAgeMs;
  } catch {
    return false;
  }
}

/**
 * Extract timestamp from a Wayback URL.
 */
function extractTimestamp(waybackUrl: string): string | undefined {
  const match = waybackUrl.match(/web\.archive\.org\/web\/(\d{14})/);
  return match?.[1];
}

function isWaybackUrl(url: string | undefined | null): boolean {
  return typeof url === 'string' && url.includes('web.archive.org/web/');
}

function extractArchiveUrl(data: any, originalUrl: string): { waybackUrl?: string; timestamp?: string } {
  const ts: string | undefined = data?.timestamp || data?.datetime || data?.ts;
  const origin: string | undefined = data?.original_url || originalUrl;

  // Only accept URLs that are actual web.archive.org archive URLs
  for (const field of ['archived_url', 'wayback_url', 'capture_url', 'url']) {
    const val = data?.[field];
    if (typeof val === 'string' && isWaybackUrl(val)) {
      return { waybackUrl: val, timestamp: ts };
    }
  }

  if (typeof data?.content_location === 'string') {
    const cl = data.content_location;
    if (cl.startsWith('/web/')) {
      return { waybackUrl: `https://web.archive.org${cl}`, timestamp: ts };
    }
  }

  if (ts && origin) return { waybackUrl: buildWaybackUrl(ts, origin), timestamp: ts };
  return {};
}

async function pollStatus(
  jobId: string,
  originalUrl: string,
  headers: Record<string, string>,
  deadlineMs: number,
): Promise<{ waybackUrl?: string; timestamp?: string } | null> {
  const pollEvery = 2_000;
  let pollCount = 0;
  while (Date.now() < deadlineMs) {
    await sleep(pollEvery);
    if (Date.now() >= deadlineMs) break;
    pollCount++;
    try {
      const resp = await fetch(SAVE_STATUS(jobId), {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      });
      if (!resp.ok) {
        console.log(`[archivePage] Poll ${pollCount}: status ${resp.status}`);
        continue;
      }
      const data: any = await resp.json().catch(() => ({}));

      const result = extractArchiveUrl(data, originalUrl);
      if (result.waybackUrl) {
        console.log(`[archivePage] Poll ${pollCount}: SUCCESS → ${result.waybackUrl}`);
        return result;
      }

      const status = String(data?.status || data?.state || '').toLowerCase();
      console.log(`[archivePage] Poll ${pollCount}: status="${status}"`);
      if (['error', 'failed'].includes(status)) {
        console.log(`[archivePage] Poll ${pollCount}: FAILED - ${data?.message || 'unknown'}`);
        return null;
      }
    } catch (err: any) {
      console.log(`[archivePage] Poll ${pollCount}: error - ${err?.message || 'unknown'}`);
    }
  }
  console.log(`[archivePage] Polling timed out after ${pollCount} polls`);
  return null;
}

/**
 * Check the CDX API for the most recent snapshot of a URL.
 * More reliable than /wayback/available for finding existing snapshots.
 */
async function findExistingSnapshot(
  url: string,
  headers: Record<string, string>,
): Promise<{ waybackUrl: string; timestamp: string } | null> {
  try {
    const resp = await fetch(CDX_SEARCH(url), {
      headers: { Accept: 'application/json', ...headers },
    });
    if (!resp.ok) return null;
    const rows: any[] = await resp.json().catch(() => []);
    // CDX returns [header_row, ...data_rows]; each row is [urlkey, timestamp, original, ...]
    if (rows.length >= 2) {
      const [, ts, original] = rows[1];
      if (ts && original) {
        return { waybackUrl: buildWaybackUrl(ts, original), timestamp: ts };
      }
    }
  } catch { /* best-effort */ }
  return null;
}

/**
 * Archive a URL via Internet Archive's SavePageNow API.
 * Retries on transient errors (rate limits, host-crawling-paused).
 * Static files (images, PNGs) typically complete in under 10s.
 * 
 * @param options.timeoutMs - Overall timeout in milliseconds
 * @param options.maxAgeMs - Maximum age of an acceptable existing archive (default: 2 minutes)
 *                          Set to 0 to accept any existing archive, or a high value to force new.
 */
export async function archivePage(
  urlToArchive: string,
  options: { timeoutMs?: number; maxAgeMs?: number } = {},
): Promise<ArchiveResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxAgeMs = options.maxAgeMs ?? 2 * 60 * 1000; // Default: 2 minutes
  const deadline = Date.now() + timeoutMs;

  let parsed: URL;
  try {
    parsed = new URL(urlToArchive);
  } catch {
    return { success: false, error: `Invalid URL: ${urlToArchive}` };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { success: false, error: 'Only http/https URLs supported' };
  }

  const authHeaders: Record<string, string> = {};
  const accessKey = process.env.WAYBACK_API_ACCESS_KEY;
  const secret = process.env.WAYBACK_API_SECRET;
  if (accessKey && secret) {
    authHeaders['Authorization'] = `LOW ${accessKey}:${secret}`;
  }

  const form = new URLSearchParams();
  form.set('url', parsed.toString());
  form.set('capture_all', '1');
  form.set('capture_screenshot', '0');
  form.set('skip_first_archive', '0');

  const maxAttempts = 3;
  let lastError = '';
  
  const hasAuth = !!authHeaders['Authorization'];
  console.log(`[archivePage] Starting archive for ${urlToArchive} (timeout=${timeoutMs}ms, auth=${hasAuth})`);

  for (let attempt = 1; attempt <= maxAttempts && Date.now() < deadline; attempt++) {
    try {
      console.log(`[archivePage] Attempt ${attempt}/${maxAttempts} - POST to ${SAVE_ENDPOINT}`);
      const resp = await fetch(SAVE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          Accept: 'application/json',
          ...authHeaders,
        },
        body: form.toString(),
      });

      console.log(`[archivePage] Response: ${resp.status} ${resp.statusText}`);

      if (!resp.ok) {
        lastError = `HTTP ${resp.status}: ${resp.statusText}`;
        if (resp.status === 429 || (resp.status >= 500 && resp.status < 600)) {
          console.warn(`[archivePage] Retrying (${attempt}/${maxAttempts}): ${lastError}`);
          await sleep(Math.min(3000 * attempt, 10000));
          continue;
        }
        const body = await resp.text().catch(() => '');
        return { success: false, error: `${lastError}: ${body.slice(0, 200)}` };
      }

      const ct = resp.headers.get('content-type') || '';
      let data: any;
      try {
        data = ct.includes('json') ? await resp.json() : {};
      } catch {
        data = {};
      }

      // Handle API-level errors (200 OK but logical failure)
      const apiStatus = String(data?.status || '').toLowerCase();
      if (apiStatus === 'error') {
        const statusExt = data?.status_ext || '';
        lastError = data?.message || statusExt || 'API error';
        const retriable = statusExt.includes('host-crawling-paused') || statusExt.includes('rate-limit');
        if (retriable && attempt < maxAttempts && Date.now() < deadline) {
          console.warn(`[archivePage] Host paused/rate-limited, retrying (${attempt}/${maxAttempts}): ${lastError}`);
          await sleep(Math.min(5000 * attempt, 15000));
          continue;
        }
        // Don't return failure yet -- fall through to check for existing snapshot
        break;
      }

      const contentLocation = resp.headers.get('content-location') || resp.headers.get('location');
      const jobId =
        resp.headers.get('x-archive-job-id') ||
        data?.job_id ||
        data?.jobId ||
        (contentLocation?.includes('/save/status/')
          ? contentLocation.match(/\/save\/status\/([^/]+)/)?.[1]
          : undefined);

      // Check for a direct wayback URL in the response headers
      let waybackUrl: string | undefined;
      let timestamp = data?.timestamp || data?.datetime;

      if (contentLocation && !contentLocation.includes('/save/status/')) {
        const candidate = contentLocation.startsWith('http')
          ? contentLocation
          : `https://web.archive.org${contentLocation}`;
        if (isWaybackUrl(candidate)) {
          waybackUrl = candidate;
        }
      }

      if (!waybackUrl && typeof data === 'object') {
        const extracted = extractArchiveUrl(data, parsed.toString());
        waybackUrl = extracted.waybackUrl;
        timestamp = timestamp || extracted.timestamp;
      }

      if (!waybackUrl && jobId && Date.now() < deadline) {
        const remainingMs = deadline - Date.now();
        console.log(`[archivePage] Got job_id=${jobId}, polling for ${remainingMs}ms...`);
        const polled = await pollStatus(jobId, parsed.toString(), authHeaders, deadline);
        if (polled?.waybackUrl) {
          waybackUrl = polled.waybackUrl;
          timestamp = timestamp || polled.timestamp;
        }
      }

      if (waybackUrl) {
        // Validate freshness - reject stale archives
        const ts = timestamp || extractTimestamp(waybackUrl);
        if (maxAgeMs > 0 && !isTimestampFresh(ts, maxAgeMs)) {
          console.warn(`[archivePage] Rejecting stale archive: ${waybackUrl} (timestamp: ${ts})`);
          lastError = `Archive returned is stale (older than ${maxAgeMs / 1000}s)`;
          // Don't return - continue to try again or fail
        } else {
          return { success: true, waybackUrl, timestamp: ts };
        }
      }
    } catch (err: any) {
      lastError = err?.message || 'Network error';
      console.warn(`[archivePage] Network error (${attempt}/${maxAttempts}): ${lastError}`);
      if (attempt < maxAttempts && Date.now() < deadline) {
        await sleep(2000 * attempt);
        continue;
      }
    }
  }

  // Fallback: check CDX for existing snapshot - but validate freshness
  if (Date.now() < deadline) {
    const existing = await findExistingSnapshot(parsed.toString(), authHeaders);
    if (existing) {
      if (maxAgeMs > 0 && !isTimestampFresh(existing.timestamp, maxAgeMs)) {
        console.warn(`[archivePage] CDX fallback rejected - stale: ${existing.waybackUrl}`);
        return { 
          success: false, 
          error: `No fresh archive available. Latest is from ${existing.timestamp} (too old, max age: ${maxAgeMs / 1000}s)` 
        };
      }
      return { success: true, waybackUrl: existing.waybackUrl, timestamp: existing.timestamp };
    }
  }

  return { success: false, error: lastError || 'Archive not available within timeout' };
}
