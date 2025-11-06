// Internet Archive SavePageNow helper
// Creates Wayback Machine snapshots with retries and structured results.
// Designed to work in both Node.js (v18+) and modern browsers.

export type ArchiveOptions = {
  /** Also capture linked pages (may be slow/heavy). Default: false */
  captureOutlinks?: boolean;
  /** Capture a screenshot of the page. Default: false */
  captureScreenshot?: boolean;
  /** Skip if a recent snapshot exists. Default: false */
  skipIfRecentlyArchived?: boolean;
  /** Additional headers (e.g., Authorization for server-side tokens). Not used client-side. */
  headers?: Record<string, string>;
  /** Enable verbose logging for diagnostics (server-side only). */
  debug?: boolean;
};

export type ArchiveResult = {
  /** Whether the request to SavePageNow succeeded */
  success: boolean;
  /** Direct URL to the archived snapshot, when available */
  waybackUrl?: string;
  /** Timestamp of the snapshot if provided by API */
  timestamp?: string;
  /** Human-readable error summary */
  error?: string;
};

const SAVE_ENDPOINT = 'https://web.archive.org/save';
const SAVE_STATUS_ENDPOINT = (jobId: string) => `https://web.archive.org/save/status/${encodeURIComponent(jobId)}`;
const WAYBACK_AVAILABLE_ENDPOINT = (url: string) => `https://web.archive.org/wayback/available?url=${encodeURIComponent(url)}`;

function isHttpOrHttps(url: URL): boolean {
  return url.protocol === 'http:' || url.protocol === 'https:';
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function extractTimestampFromPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  // Match /web/20250101HHMMSS/... style timestamps
  const m = path.match(/\/web\/(\d{14})\//);
  return m?.[1];
}

function extractJobIdFromStatusPath(path: string | null | undefined): string | undefined {
  if (!path) return undefined;
  const m = path.match(/\/save\/status\/([^/]+)/);
  return m?.[1];
}

function buildWaybackUrlFromParts(timestamp: string | undefined, originalUrl: string | undefined): string | undefined {
  if (!timestamp || !originalUrl) return undefined;
  return `https://web.archive.org/web/${timestamp}/${originalUrl}`;
}

async function pollSaveStatus(
  jobId: string,
  originalUrl: string,
  headers?: Record<string, string>
): Promise<{ waybackUrl?: string; timestamp?: string } | null> {
  const maxPolls = 20;
  const delayMs = 2000;
  for (let i = 0; i < maxPolls; i++) {
    try {
      const resp = await fetch(SAVE_STATUS_ENDPOINT(jobId), {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...(headers || {}) },
      });
      if (!resp.ok) {
        // Treat any non-OK as transient; keep polling up to maxPolls
        await sleep(delayMs);
        continue;
      }
      const data: any = await resp.json().catch(() => ({}));
      const status: string | undefined = data?.status || data?.state || data?.result;
      const ts: string | undefined = data?.timestamp || data?.datetime || data?.ts;
      const origin: string | undefined = data?.original_url || originalUrl;

      // Try top-level fields first
      let archivedUrl: string | undefined = data?.archived_url || data?.wayback_url || data?.url || data?.capture_url;
      if (!archivedUrl && typeof data?.content_location === 'string') {
        archivedUrl = data.content_location.startsWith('/web/')
          ? `https://web.archive.org${data.content_location}`
          : data.content_location;
      }

      // Try nested resources array
      if (!archivedUrl && Array.isArray(data?.resources) && data.resources.length > 0) {
        const res0 = data.resources.find((r: any) => r?.archived_url || r?.wayback_url || r?.url || r?.capture_url || r?.content_location) || data.resources[0];
        archivedUrl = res0?.archived_url || res0?.wayback_url || res0?.url || res0?.capture_url || (typeof res0?.content_location === 'string' ? (res0.content_location.startsWith('/web/') ? `https://web.archive.org${res0.content_location}` : res0.content_location) : undefined);
      }

      // Try urls object map
      if (!archivedUrl && data?.urls && typeof data.urls === 'object') {
        const firstKey = Object.keys(data.urls)[0];
        const entry = firstKey ? data.urls[firstKey] : undefined;
        if (entry) {
          archivedUrl = entry?.archived_url || entry?.wayback_url || entry?.url || entry?.capture_url || (typeof entry?.content_location === 'string' ? (entry.content_location.startsWith('/web/') ? `https://web.archive.org${entry.content_location}` : entry.content_location) : undefined);
        }
      }

      if (archivedUrl) {
        return { waybackUrl: archivedUrl, timestamp: ts };
      }
      const constructed = buildWaybackUrlFromParts(ts, origin);
      if (constructed) {
        return { waybackUrl: constructed, timestamp: ts };
      }
      // keep polling on in-progress statuses
      if (typeof status === 'string' && /^(pending|processing|in-progress|running)$/i.test(status)) {
        await sleep(delayMs);
        continue;
      }
      // If status indicates success but still no url, wait a bit and retry
      if (typeof status === 'string' && /^(success|done|complete|available)$/i.test(status)) {
        await sleep(delayMs);
        continue;
      }
      await sleep(delayMs);
    } catch {
      await sleep(delayMs);
    }
  }
  return null;
}

async function pollStatusByUrl(
  statusPathOrUrl: string,
  originalUrl: string,
  headers?: Record<string, string>
): Promise<{ waybackUrl?: string; timestamp?: string } | null> {
  const maxPolls = 20;
  const delayMs = 2000;
  const fullUrl = statusPathOrUrl.startsWith('http') ? statusPathOrUrl : `https://web.archive.org${statusPathOrUrl}`;
  for (let i = 0; i < maxPolls; i++) {
    try {
      const resp = await fetch(fullUrl, { method: 'GET', headers: { 'Accept': 'application/json', ...(headers || {}) } });
      if (!resp.ok) {
        // Treat any non-OK as transient; keep polling up to maxPolls
        await sleep(delayMs);
        continue;
      }
      const data: any = await resp.json().catch(() => ({}));
      const ts: string | undefined = data?.timestamp || data?.datetime || data?.ts;
      const origin: string | undefined = data?.original_url || originalUrl;

      let archivedUrl: string | undefined = data?.archived_url || data?.wayback_url || data?.url || data?.capture_url;
      if (!archivedUrl && typeof data?.content_location === 'string') {
        archivedUrl = data.content_location.startsWith('/web/')
          ? `https://web.archive.org${data.content_location}`
          : data.content_location;
      }
      if (!archivedUrl && Array.isArray(data?.resources) && data.resources.length > 0) {
        const res0 = data.resources.find((r: any) => r?.archived_url || r?.wayback_url || r?.url || r?.capture_url || r?.content_location) || data.resources[0];
        archivedUrl = res0?.archived_url || res0?.wayback_url || res0?.url || res0?.capture_url || (typeof res0?.content_location === 'string' ? (res0.content_location.startsWith('/web/') ? `https://web.archive.org${res0.content_location}` : res0.content_location) : undefined);
      }
      if (!archivedUrl && data?.urls && typeof data.urls === 'object') {
        const firstKey = Object.keys(data.urls)[0];
        const entry = firstKey ? data.urls[firstKey] : undefined;
        if (entry) {
          archivedUrl = entry?.archived_url || entry?.wayback_url || entry?.url || entry?.capture_url || (typeof entry?.content_location === 'string' ? (entry.content_location.startsWith('/web/') ? `https://web.archive.org${entry.content_location}` : entry.content_location) : undefined);
        }
      }
      if (archivedUrl) {
        return { waybackUrl: archivedUrl, timestamp: ts };
      }
      const constructed = buildWaybackUrlFromParts(ts, origin);
      if (constructed) return { waybackUrl: constructed, timestamp: ts };
    } catch {}
    await sleep(delayMs);
  }
  return null;
}

async function pollAvailableUrl(
  originalUrl: string,
  headers?: Record<string, string>
): Promise<{ waybackUrl?: string; timestamp?: string } | null> {
  const maxPolls = 15;
  const delayMs = 2000;
  for (let i = 0; i < maxPolls; i++) {
    try {
      const availResp = await fetch(WAYBACK_AVAILABLE_ENDPOINT(originalUrl), {
        method: 'GET',
        headers: { 'Accept': 'application/json', ...(headers || {}) },
      });
      if (!availResp.ok) {
        if (availResp.status >= 500 && availResp.status <= 599) {
          await sleep(delayMs);
          continue;
        }
        return null;
      }
      const avail = await availResp.json().catch(() => ({}));
      const closest = avail?.archived_snapshots?.closest;
      if (closest?.url) {
        return { waybackUrl: closest.url as string, timestamp: closest?.timestamp as (string | undefined) };
      }
    } catch {}
    await sleep(delayMs);
  }
  return null;
}

/**
 * Snapshot a URL using Internet Archive's SavePageNow API.
 * Implements exponential backoff retries for resilience.
 */
export async function archivePage(
  urlToArchive: string,
  options: ArchiveOptions = {}
): Promise<ArchiveResult> {
  // Validate the input URL. Only http/https are allowed by IA.
  let parsed: URL;
  try {
    parsed = new URL(String(urlToArchive));
  } catch {
    const message = `Invalid URL: ${urlToArchive}`;
    console.error('SavePageNow validation error', { reason: message });
    return { success: false, error: message };
  }
  if (!isHttpOrHttps(parsed)) {
    const message = 'Only http and https URLs are supported';
    console.error('SavePageNow validation error', { reason: message });
    return { success: false, error: message };
  }

  // Build the request body exactly as required by the API.
  const requestBody = {
    url: parsed.toString(),
    capture_all: true,
    capture_outlinks: options.captureOutlinks ?? false,
    capture_screenshot: options.captureScreenshot ?? false,
    skip_first_archive: options.skipIfRecentlyArchived ?? false,
  };

  const maxAttempts = 3; // 1s -> 2s -> 4s

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Prefer form-encoded per IA SavePageNow docs
      const form = new URLSearchParams();
      form.set('url', requestBody.url);
      form.set('capture_all', requestBody.capture_all ? '1' : '0');
      form.set('capture_outlinks', requestBody.capture_outlinks ? '1' : '0');
      form.set('capture_screenshot', requestBody.capture_screenshot ? '1' : '0');
      form.set('skip_first_archive', requestBody.skip_first_archive ? '1' : '0');

      const response = await fetch(SAVE_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Accept': 'application/json',
          ...(options.headers || {}),
        },
        body: form.toString(),
      });

      // Handle HTTP responses
      if (response.ok) {
        // The API may respond with JSON and/or with Content-Location header to the archived snapshot
        const contentType = response.headers.get('content-type') || '';
        let data: any = undefined;
        try {
          if (contentType.includes('application/json')) {
            data = await response.json();
          } else {
            // Not JSON; read text for potential diagnostics (but do not throw)
            data = await response.text();
          }
        } catch {
          // If body parsing fails, continue with headers only
        }

        // Prefer the Content-Location/Location header when present, fallback to common JSON fields
        const contentLocation =
          response.headers.get('content-location') || response.headers.get('location');

        // Determine if the content-location is a direct /web/ path or a status endpoint
        const jobIdFromHeader = extractJobIdFromStatusPath(contentLocation || undefined);
        let waybackUrl = contentLocation && !jobIdFromHeader
          ? (contentLocation.startsWith('http') ? contentLocation : `https://web.archive.org${contentLocation}`)
          : (data?.archived_url || data?.wayback_url || undefined);

        let timestamp = data?.timestamp || data?.datetime || extractTimestampFromPath(contentLocation || undefined) || undefined;

        // Some responses return a job_id and no immediate wayback link; poll status to resolve
        const headerJobId = response.headers.get('x-archive-job-id') || undefined;
        const jobId: string | undefined = jobIdFromHeader || headerJobId || data?.job_id || data?.jobId || undefined;
        if (!waybackUrl && jobId) {
          // Prefer polling the exact status URL if provided, otherwise by jobId
          const statusPath = jobIdFromHeader ? (contentLocation as string) : undefined;
          const polled = statusPath
            ? await pollStatusByUrl(statusPath, requestBody.url, options.headers)
            : await pollSaveStatus(jobId, requestBody.url, options.headers);
          if (polled?.waybackUrl) {
            waybackUrl = polled.waybackUrl;
            timestamp = timestamp || polled.timestamp;
          }
        }

        // Final fallback: poll availability API (may return latest available snapshot)
        if (!waybackUrl) {
          try {
            const polledAvail = await pollAvailableUrl(requestBody.url, options.headers);
            if (polledAvail?.waybackUrl) {
              waybackUrl = polledAvail.waybackUrl;
              timestamp = timestamp || polledAvail.timestamp;
            }
          } catch {}
        }

        if (waybackUrl) {
          return { success: true, waybackUrl, timestamp };
        }

        return { success: false, error: 'Snapshot not ready yet; please retry shortly' };
      }

      // Non-2xx responses: build a human-readable error and decide whether to retry
      const status = response.status;
      const reason = response.statusText || 'Request failed';
      const contentType = response.headers.get('content-type') || '';
      let details: any = undefined;
      try {
        details = contentType.includes('application/json')
          ? await response.json()
          : await response.text();
      } catch {
        // Ignore parsing errors
      }

      const message = `SavePageNow request failed: status=${status}, reason=${reason}`;
      if (status >= 500 && status <= 599) {
        // Retriable error (server-side). Exponential backoff: 1s → 2s → 4s
        if (attempt < maxAttempts) {
          console.warn(message, { attempt, details });
          await sleep(2 ** (attempt - 1) * 1000);
          continue;
        }
      }

      // Not retriable (e.g., 4xx) or out of retries
      console.error(message, { details });
      return {
        success: false,
        error: typeof details === 'string' && details.trim() ? `${reason}: ${details}` : reason,
      };
    } catch (err: any) {
      // Network error: retriable
      const message = `SavePageNow network error: ${err?.message || String(err)}`;
      if (attempt < maxAttempts) {
        console.warn(message, { attempt });
        await sleep(2 ** (attempt - 1) * 1000);
        continue;
      }
      console.error(message);
      return { success: false, error: err?.message || 'Network error' };
    }
  }

  // Should be unreachable, but return a safe error object just in case
  return { success: false, error: 'Unknown error' };
}

export default archivePage;


