/**
 * Lightweight Wayback Machine SavePageNow helper for the metric-ai-worker.
 * Best-effort archival with a short timeout, designed to run inside after().
 */

export type ArchiveResult = {
  success: boolean;
  waybackUrl?: string;
  timestamp?: string;
  error?: string;
};

const SAVE_ENDPOINT = 'https://web.archive.org/save';
const SAVE_STATUS = (id: string) => `https://web.archive.org/save/status/${encodeURIComponent(id)}`;
const AVAILABLE = (url: string) => `https://web.archive.org/wayback/available?url=${encodeURIComponent(url)}`;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function buildWaybackUrl(ts: string, url: string): string {
  return `https://web.archive.org/web/${ts}/${url}`;
}

function extractArchiveUrl(data: any, originalUrl: string): { waybackUrl?: string; timestamp?: string } {
  const ts: string | undefined = data?.timestamp || data?.datetime || data?.ts;
  const origin: string | undefined = data?.original_url || originalUrl;

  const archived =
    data?.archived_url || data?.wayback_url || data?.url || data?.capture_url;
  if (archived) return { waybackUrl: archived, timestamp: ts };

  if (typeof data?.content_location === 'string') {
    const cl = data.content_location;
    return {
      waybackUrl: cl.startsWith('/web/') ? `https://web.archive.org${cl}` : cl,
      timestamp: ts,
    };
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
  while (Date.now() < deadlineMs) {
    await sleep(pollEvery);
    if (Date.now() >= deadlineMs) break;
    try {
      const resp = await fetch(SAVE_STATUS(jobId), {
        method: 'GET',
        headers: { Accept: 'application/json', ...headers },
      });
      if (!resp.ok) continue;
      const data: any = await resp.json().catch(() => ({}));

      const result = extractArchiveUrl(data, originalUrl);
      if (result.waybackUrl) return result;

      const status = String(data?.status || data?.state || '').toLowerCase();
      if (['error', 'failed'].includes(status)) return null;
    } catch {
      /* transient */
    }
  }
  return null;
}

/**
 * Archive a URL via Internet Archive's SavePageNow API.
 * Static files (images, PNGs) typically complete in under 10s.
 * JS-heavy pages may need the full 30s budget.
 */
export async function archivePage(
  urlToArchive: string,
  options: { timeoutMs?: number } = {},
): Promise<ArchiveResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
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
  form.set('capture_screenshot', '1');
  form.set('skip_first_archive', '1');

  try {
    const resp = await fetch(SAVE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json',
        ...authHeaders,
      },
      body: form.toString(),
    });

    if (resp.ok) {
      const ct = resp.headers.get('content-type') || '';
      let data: any;
      try {
        data = ct.includes('json') ? await resp.json() : await resp.text();
      } catch {
        data = {};
      }

      const contentLocation = resp.headers.get('content-location') || resp.headers.get('location');
      const jobId =
        resp.headers.get('x-archive-job-id') ||
        data?.job_id ||
        data?.jobId ||
        (contentLocation?.includes('/save/status/')
          ? contentLocation.match(/\/save\/status\/([^/]+)/)?.[1]
          : undefined);

      // Check for a direct wayback URL in the response
      let waybackUrl = contentLocation && !contentLocation.includes('/save/status/')
        ? (contentLocation.startsWith('http') ? contentLocation : `https://web.archive.org${contentLocation}`)
        : undefined;
      let timestamp = data?.timestamp || data?.datetime;

      if (!waybackUrl && typeof data === 'object') {
        const extracted = extractArchiveUrl(data, parsed.toString());
        waybackUrl = extracted.waybackUrl;
        timestamp = timestamp || extracted.timestamp;
      }

      if (!waybackUrl && jobId && Date.now() < deadline) {
        const polled = await pollStatus(jobId, parsed.toString(), authHeaders, deadline);
        if (polled?.waybackUrl) {
          waybackUrl = polled.waybackUrl;
          timestamp = timestamp || polled.timestamp;
        }
      }

      if (waybackUrl) return { success: true, waybackUrl, timestamp };
    }
  } catch (err: any) {
    console.warn(`[archivePage] SavePageNow error for ${parsed.toString()}: ${err?.message}`);
  }

  // Fallback: check if a recent snapshot already exists
  if (Date.now() < deadline) {
    try {
      const resp = await fetch(AVAILABLE(parsed.toString()), {
        headers: { Accept: 'application/json', ...authHeaders },
      });
      if (resp.ok) {
        const avail: any = await resp.json().catch(() => ({}));
        const closest = avail?.archived_snapshots?.closest;
        if (closest?.url) {
          return { success: true, waybackUrl: closest.url, timestamp: closest.timestamp };
        }
      }
    } catch { /* best-effort */ }
  }

  return { success: false, error: 'Archive not available within timeout' };
}
