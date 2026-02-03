function normalizeBaseUrl(url: string) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function isLocalhostHost(host: string) {
  const h = String(host || '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}

function isLocalhostUrl(url: string) {
  try {
    const u = new URL(url);
    return isLocalhostHost(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Decide which Metric AI Worker base URL to use.
 *
 * - Local dev: defaults to a local worker URL (override with NEXT_PUBLIC_METRIC_AI_WORKER_URL_LOCAL)
 * - Production builds: must use NEXT_PUBLIC_METRIC_AI_WORKER_URL and it must NOT point at localhost
 *
 * This keeps "Validate Metric" using the local worker on localhost, while Vercel/prod uses the
 * production worker.
 */
export function getMetricAIWorkerBaseUrl(): string {
  const configured = normalizeBaseUrl((process.env as any).NEXT_PUBLIC_METRIC_AI_WORKER_URL || '');
  const localDefault = normalizeBaseUrl((process.env as any).NEXT_PUBLIC_METRIC_AI_WORKER_URL_LOCAL || 'http://localhost:3001');
  const nodeEnv = (process.env as any).NODE_ENV || 'development';

  // Production: require explicit, non-localhost worker URL
  if (nodeEnv === 'production') {
    if (!configured) throw new Error('Metric AI worker not configured (set NEXT_PUBLIC_METRIC_AI_WORKER_URL).');
    if (isLocalhostUrl(configured)) {
      throw new Error('Metric AI worker URL points to localhost in production. Fix NEXT_PUBLIC_METRIC_AI_WORKER_URL.');
    }
    return configured;
  }

  // Dev: if running on localhost, prefer localhost worker unless explicitly configured otherwise
  const browserHost =
    typeof window !== 'undefined' && window?.location?.hostname ? String(window.location.hostname) : '';
  const isBrowserLocalhost = browserHost ? isLocalhostHost(browserHost) : false;

  // If you're on localhost, ALWAYS use the local worker to avoid accidentally hitting prod
  // when NEXT_PUBLIC_METRIC_AI_WORKER_URL is set in your shell.
  if (isBrowserLocalhost) return localDefault;

  // Non-localhost dev (e.g., LAN): use configured if present, else fall back to local default.
  if (configured) return configured;

  // Non-localhost dev (e.g., LAN): still use configured if present, else use local default.
  return localDefault;
}

type JobStartInput = {
  metric: string;
  urls: string[];
  description?: string;
  related_market_id?: string;
  related_market_identifier?: string;
  user_address?: string;
  context?: 'create' | 'settlement';
};

export type MetricAIResult = {
  unit?: string;
  as_of?: string;
  value?: string;
  metric?: string;
  sources?: Array<any>;
  reasoning?: string;
  confidence?: number;
  asset_price_suggestion?: string;
};

export async function startMetricAIJob(input: JobStartInput): Promise<{ jobId: string }> {
  const baseUrl = getMetricAIWorkerBaseUrl();
  try { console.log('[MetricAIWorker] POST /api/metric-ai start', { url: baseUrl, metric: input.metric, urls: input.urls?.length }); } catch {}
  const res = await fetch(`${baseUrl}/api/metric-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (res.status !== 202) {
    const j = await res.json().catch(() => ({} as any));
    const details =
      j?.message ||
      (Array.isArray(j?.issues) ? JSON.stringify(j.issues) : '') ||
      j?.error ||
      '';
    try {
      console.log('[MetricAIWorker] POST /api/metric-ai failed', {
        url: baseUrl,
        status: res.status,
        error: j?.error,
        message: j?.message,
        issues: j?.issues
      });
    } catch {}
    throw new Error(details ? `${details}` : `Worker start failed (${res.status})`);
  }
  const data = await res.json().catch(() => ({} as any));
  if (!data?.jobId) {
    try { console.log('[MetricAIWorker] POST /api/metric-ai missing jobId', { data }); } catch {}
    throw new Error('Worker did not return jobId');
  }
  try { console.log('[MetricAIWorker] POST /api/metric-ai ok', { jobId: data.jobId }); } catch {}
  return { jobId: String(data.jobId) };
}

export async function getMetricAIJobStatus(jobId: string): Promise<{
  status: 'processing' | 'completed' | 'failed';
  result?: MetricAIResult;
  error?: string;
}> {
  const baseUrl = getMetricAIWorkerBaseUrl();
  const url = `${baseUrl}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`;
  try { console.log('[MetricAIWorker] GET', { url }); } catch {}
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({} as any));
    const details =
      j?.message ||
      (Array.isArray(j?.issues) ? JSON.stringify(j.issues) : '') ||
      j?.error ||
      '';
    try {
      console.log('[MetricAIWorker] GET status failed', {
        url,
        status: res.status,
        error: j?.error,
        message: j?.message,
        issues: j?.issues
      });
    } catch {}
    throw new Error(details ? `${details}` : `Worker status failed (${res.status})`);
  }
  const data = await res.json();
  try { console.log('[MetricAIWorker] GET status ok', { status: data?.status }); } catch {}
  return data;
}

export async function runMetricAIWithPolling(
  input: JobStartInput,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<MetricAIResult | null> {
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 2000;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 60000; // Increased for screenshot + vision analysis
  const started = Date.now();
  const { jobId } = await startMetricAIJob(input);
  try { console.log('[MetricAIWorker] poll start', { jobId, intervalMs, timeoutMs }); } catch {}
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    const status = await getMetricAIJobStatus(jobId);
    try { console.log('[MetricAIWorker] poll tick', { jobId, status: status.status }); } catch {}
    if (status.status === 'completed' && status.result) {
      try { console.log('[MetricAIWorker] poll completed'); } catch {}
      return status.result;
    }
    if (status.status === 'failed') {
      try { console.log('[MetricAIWorker] poll failed', { error: status.error }); } catch {}
      return null;
    }
  }
  try { console.log('[MetricAIWorker] poll timeout', { waitedMs: Date.now() - started }); } catch {}
  return null;
}


