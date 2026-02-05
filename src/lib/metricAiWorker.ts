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
  const startTime = Date.now();
  
  console.log('[Metric-AI] ▶ Starting job request', {
    baseUrl,
    metric: input.metric,
    urls: input.urls,
    urlCount: input.urls?.length,
    context: input.context,
    relatedMarketId: input.related_market_id,
  });
  
  const res = await fetch(`${baseUrl}/api/metric-ai`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
    cache: 'no-store',
  });
  
  const requestDurationMs = Date.now() - startTime;
  
  if (res.status !== 202) {
    const j = await res.json().catch(() => ({} as any));
    const details =
      j?.message ||
      (Array.isArray(j?.issues) ? JSON.stringify(j.issues) : '') ||
      j?.error ||
      '';
    console.error('[Metric-AI] ✖ Job start FAILED', {
      baseUrl,
      status: res.status,
      requestDurationMs,
      error: j?.error,
      message: j?.message,
      issues: j?.issues
    });
    throw new Error(details ? `${details}` : `Worker start failed (${res.status})`);
  }
  
  const data = await res.json().catch(() => ({} as any));
  if (!data?.jobId) {
    console.error('[Metric-AI] ✖ Job start returned no jobId', { data, requestDurationMs });
    throw new Error('Worker did not return jobId');
  }
  
  console.log('[Metric-AI] ✓ Job started successfully', {
    jobId: data.jobId,
    requestDurationMs,
    statusUrl: data.statusUrl,
  });
  
  return { jobId: String(data.jobId) };
}

export async function getMetricAIJobStatus(jobId: string): Promise<{
  status: 'processing' | 'completed' | 'failed';
  result?: MetricAIResult;
  error?: string;
}> {
  const baseUrl = getMetricAIWorkerBaseUrl();
  const url = `${baseUrl}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`;
  const startTime = Date.now();
  
  console.log('[Metric-AI] 🔄 Polling job status', { jobId });
  
  const res = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
  });
  
  const pollDurationMs = Date.now() - startTime;
  
  if (!res.ok) {
    const j = await res.json().catch(() => ({} as any));
    const details =
      j?.message ||
      (Array.isArray(j?.issues) ? JSON.stringify(j.issues) : '') ||
      j?.error ||
      '';
    console.error('[Metric-AI] ✖ Poll request FAILED', {
      jobId,
      httpStatus: res.status,
      pollDurationMs,
      error: j?.error,
      message: j?.message,
    });
    throw new Error(details ? `${details}` : `Worker status failed (${res.status})`);
  }
  
  const data = await res.json();
  
  console.log('[Metric-AI] 📊 Poll response', {
    jobId,
    status: data?.status,
    pollDurationMs,
    hasResult: !!data?.result,
    hasError: !!data?.error,
  });
  
  return data;
}

export async function runMetricAIWithPolling(
  input: JobStartInput,
  opts: { intervalMs?: number; timeoutMs?: number } = {}
): Promise<MetricAIResult | null> {
  const intervalMs = typeof opts.intervalMs === 'number' ? opts.intervalMs : 2000;
  const timeoutMs = typeof opts.timeoutMs === 'number' ? opts.timeoutMs : 60000; // Increased for screenshot + vision analysis
  const started = Date.now();
  let pollCount = 0;
  
  console.log('[Metric-AI] ═══════════════════════════════════════════════════');
  console.log('[Metric-AI] 🚀 STARTING METRIC AI WORKFLOW', {
    metric: input.metric,
    urls: input.urls,
    intervalMs,
    timeoutMs,
    context: input.context,
    timestamp: new Date().toISOString(),
  });
  console.log('[Metric-AI] ═══════════════════════════════════════════════════');
  
  const { jobId } = await startMetricAIJob(input);
  
  console.log('[Metric-AI] ⏳ Beginning polling loop', {
    jobId,
    intervalMs,
    maxPolls: Math.ceil(timeoutMs / intervalMs),
  });
  
  while (Date.now() - started < timeoutMs) {
    await new Promise(r => setTimeout(r, intervalMs));
    pollCount++;
    
    const elapsedMs = Date.now() - started;
    console.log(`[Metric-AI] 🔄 Poll #${pollCount}`, {
      jobId,
      elapsedMs,
      remainingMs: timeoutMs - elapsedMs,
    });
    
    const status = await getMetricAIJobStatus(jobId);
    
    if (status.status === 'completed' && status.result) {
      const totalDurationMs = Date.now() - started;
      console.log('[Metric-AI] ═══════════════════════════════════════════════════');
      console.log('[Metric-AI] ✅ WORKFLOW COMPLETED SUCCESSFULLY', {
        jobId,
        totalDurationMs,
        pollCount,
        value: status.result.value,
        assetPriceSuggestion: status.result.asset_price_suggestion,
        confidence: status.result.confidence,
        sourcesCount: status.result.sources?.length,
      });
      console.log('[Metric-AI] 📋 Full result:', status.result);
      console.log('[Metric-AI] ═══════════════════════════════════════════════════');
      return status.result;
    }
    
    if (status.status === 'failed') {
      const totalDurationMs = Date.now() - started;
      console.error('[Metric-AI] ═══════════════════════════════════════════════════');
      console.error('[Metric-AI] ❌ WORKFLOW FAILED', {
        jobId,
        totalDurationMs,
        pollCount,
        error: status.error,
      });
      console.error('[Metric-AI] ═══════════════════════════════════════════════════');
      return null;
    }
    
    // Still processing - log progress
    console.log(`[Metric-AI] ⏳ Still processing... (poll #${pollCount}, ${Math.round(elapsedMs / 1000)}s elapsed)`);
  }
  
  const totalDurationMs = Date.now() - started;
  console.error('[Metric-AI] ═══════════════════════════════════════════════════');
  console.error('[Metric-AI] ⏰ WORKFLOW TIMED OUT', {
    jobId,
    totalDurationMs,
    pollCount,
    timeoutMs,
  });
  console.error('[Metric-AI] ═══════════════════════════════════════════════════');
  return null;
}


