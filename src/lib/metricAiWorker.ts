const WORKER_URL = (process.env as any).NEXT_PUBLIC_METRIC_AI_WORKER_URL || '';

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
  if (!WORKER_URL) throw new Error('NEXT_PUBLIC_METRIC_AI_WORKER_URL not configured');
  try { console.log('[MetricAIWorker] POST /api/metric-ai start', { url: WORKER_URL, metric: input.metric, urls: input.urls?.length }); } catch {}
  const res = await fetch(`${WORKER_URL}/api/metric-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  if (res.status !== 202) {
    const j = await res.json().catch(() => ({} as any));
    try { console.log('[MetricAIWorker] POST /api/metric-ai failed', { status: res.status, error: j?.error }); } catch {}
    throw new Error(j?.error || `Worker start failed (${res.status})`);
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
  if (!WORKER_URL) throw new Error('NEXT_PUBLIC_METRIC_AI_WORKER_URL not configured');
  const url = `${WORKER_URL}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`;
  try { console.log('[MetricAIWorker] GET', { url }); } catch {}
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  });
  if (!res.ok) {
    const j = await res.json().catch(() => ({} as any));
    try { console.log('[MetricAIWorker] GET status failed', { status: res.status, error: j?.error }); } catch {}
    throw new Error(j?.error || `Worker status failed (${res.status})`);
  }
  const data = await res.json();
  try { console.log('[MetricAIWorker] GET status ok', { status: data?.status }); } catch {}
  return data;
}

export async function runMetricAIWithPolling(
  input: JobStartInput,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<MetricAIResult | null> {
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 1500;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 12000;
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


