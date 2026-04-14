/**
 * Archive.today (archive.is) archiving provider.
 * Unofficial API - submits URLs via POST to /submit/ endpoint.
 * Supports multiple mirror domains for resilience.
 * 
 * Part of the unified multi-archive system in metric-ai-worker.
 */

export type ArchiveTodayResult = {
  success: boolean;
  archiveUrl?: string;
  shortId?: string;
  error?: string;
};

const MIRRORS = [
  'https://archive.today',
  'https://archive.is',
  'https://archive.ph',
  'https://archive.vn',
] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Extract the submitid token from archive.today homepage.
 */
async function getSubmitId(
  domain: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const resp = await fetch(domain, {
      method: 'GET',
      headers: { Accept: 'text/html,application/xhtml+xml', ...headers },
    });
    if (!resp.ok) return null;
    const html = await resp.text();
    const match = html.match(/name="submitid"[^>]*value="([^"]+)"/);
    return match?.[1] || null;
  } catch {
    return null;
  }
}

/**
 * Extract archive URL from response headers or body.
 */
function extractArchiveUrl(
  response: Response,
  body: string
): string | undefined {
  const refresh = response.headers.get('Refresh');
  if (refresh) {
    const match = refresh.match(/url=([^\s]+)/i);
    if (match?.[1]) return match[1];
  }

  const location = response.headers.get('Location');
  if (location && location.includes('archive')) {
    return location.startsWith('http') ? location : `https://archive.today${location}`;
  }

  const contentLocation = response.headers.get('Content-Location');
  if (contentLocation && contentLocation.includes('/')) {
    return contentLocation.startsWith('http')
      ? contentLocation
      : `https://archive.today${contentLocation}`;
  }

  const metaRefresh = body.match(/<meta[^>]*http-equiv="refresh"[^>]*content="[^"]*url=([^">\s]+)/i);
  if (metaRefresh?.[1]) return metaRefresh[1];

  const archiveLink = body.match(/https?:\/\/archive\.(today|is|ph|vn|md)\/[a-zA-Z0-9]+/);
  if (archiveLink?.[0]) return archiveLink[0];

  return undefined;
}

/**
 * Check if an archive URL is fresh (created within maxAgeMs).
 */
function isArchiveFresh(archiveUrl: string, maxAgeMs: number = 5 * 60 * 1000): boolean {
  const timestampMatch = archiveUrl.match(/archive\.(today|is|ph|vn|md)\/(\d{14})\//);
  if (!timestampMatch) return true; // Can't determine, assume fresh
  
  const archiveTimestamp = timestampMatch[2];
  const archiveDate = new Date(
    parseInt(archiveTimestamp.slice(0, 4)),
    parseInt(archiveTimestamp.slice(4, 6)) - 1,
    parseInt(archiveTimestamp.slice(6, 8)),
    parseInt(archiveTimestamp.slice(8, 10)),
    parseInt(archiveTimestamp.slice(10, 12)),
    parseInt(archiveTimestamp.slice(12, 14))
  );
  
  return (Date.now() - archiveDate.getTime()) <= maxAgeMs;
}

/**
 * Archive a URL using archive.today.
 * Tries multiple mirror domains for resilience.
 * Only returns success for FRESH archives (< 5 min old).
 */
export async function archiveToday(
  urlToArchive: string,
  options: {
    timeoutMs?: number;
    userAgent?: string;
    forceNew?: boolean;
  } = {}
): Promise<ArchiveTodayResult> {
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

  const headers: Record<string, string> = {
    'User-Agent':
      options.userAgent ||
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  let lastError = '';

  for (const mirror of MIRRORS) {
    if (Date.now() >= deadline) break;

    try {
      const submitId = await getSubmitId(mirror, headers);

      const form = new URLSearchParams();
      form.set('url', parsed.toString());
      if (options.forceNew) {
        form.set('anyway', '1');
      }
      if (submitId) {
        form.set('submitid', submitId);
      }

      const submitUrl = `${mirror}/submit/`;
      const resp = await fetch(submitUrl, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/x-www-form-urlencoded',
          Origin: mirror,
          Referer: `${mirror}/`,
        },
        body: form.toString(),
        redirect: 'manual',
      });

      const body = await resp.text().catch(() => '');

      if (body.toLowerCase().includes('captcha') || body.includes('cf-challenge')) {
        lastError = 'Captcha required';
        continue;
      }

      const archiveUrl = extractArchiveUrl(resp, body);

      if (archiveUrl) {
        // Reject stale archives - we need fresh snapshots for settlement evidence
        if (!isArchiveFresh(archiveUrl)) {
          console.warn(`[archiveToday] Rejecting stale archive: ${archiveUrl}`);
          lastError = 'Archive.today returned stale archive instead of creating new one';
          continue;
        }

        const shortId = archiveUrl.match(/\/([a-zA-Z0-9]+)$/)?.[1];
        return {
          success: true,
          archiveUrl,
          shortId,
        };
      }

      // Check for WIP (work in progress) page
      if (resp.status === 200 || resp.status === 302) {
        const wipMatch = body.match(/https?:\/\/archive\.(today|is|ph|vn)\/wip\/([a-zA-Z0-9]+)/);
        if (wipMatch) {
          const wipUrl = wipMatch[0];
          const finalUrl = await pollWipPage(wipUrl, headers, deadline);
          if (finalUrl && isArchiveFresh(finalUrl)) {
            const shortId = finalUrl.match(/\/([a-zA-Z0-9]+)$/)?.[1];
            return { success: true, archiveUrl: finalUrl, shortId };
          }
        }
      }

      lastError = `No archive URL returned from ${mirror}`;
    } catch (err: any) {
      lastError = err?.message || 'Network error';
    }

    if (Date.now() < deadline) {
      await sleep(500);
    }
  }

  return { success: false, error: lastError || 'All mirrors failed' };
}

/**
 * Poll a WIP page until it resolves to a final archive.
 */
async function pollWipPage(
  wipUrl: string,
  headers: Record<string, string>,
  deadline: number
): Promise<string | null> {
  const pollInterval = 2000;

  while (Date.now() < deadline) {
    try {
      const resp = await fetch(wipUrl, {
        method: 'GET',
        headers,
        redirect: 'manual',
      });

      const location = resp.headers.get('Location');
      if (location && !location.includes('/wip/')) {
        return location.startsWith('http') ? location : `https://archive.today${location}`;
      }

      const body = await resp.text().catch(() => '');
      const finalMatch = body.match(
        /https?:\/\/archive\.(today|is|ph|vn)\/[a-zA-Z0-9]+(?!\/wip)/
      );
      if (finalMatch?.[0] && !finalMatch[0].includes('/wip/')) {
        return finalMatch[0];
      }

      await sleep(pollInterval);
    } catch {
      await sleep(pollInterval);
    }
  }

  return null;
}

export default archiveToday;
