'use client';

import React, { useState, useCallback, useRef } from 'react';
import { getMetricAIWorkerBaseUrl, type MetricAIResult } from '@/lib/metricAiWorker';

type LogEntry = {
  ts: number;
  level: 'info' | 'warn' | 'error' | 'success';
  msg: string;
};

type JobState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'polling'; jobId: string; pollCount: number }
  | { phase: 'done'; jobId: string; result: MetricAIResult; durationMs: number }
  | { phase: 'failed'; jobId?: string; error: string; durationMs: number };

function confidenceColor(c: number) {
  if (c >= 0.8) return 'text-emerald-400';
  if (c >= 0.5) return 'text-yellow-400';
  return 'text-red-400';
}

function confidenceBg(c: number) {
  if (c >= 0.8) return 'bg-emerald-500/15 border-emerald-500/30';
  if (c >= 0.5) return 'bg-yellow-500/15 border-yellow-500/30';
  return 'bg-red-500/15 border-red-500/30';
}

function confidenceLabel(c: number) {
  if (c >= 0.9) return 'Very High';
  if (c >= 0.8) return 'High';
  if (c >= 0.6) return 'Medium';
  if (c >= 0.4) return 'Low';
  return 'Very Low';
}

function prettyJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

const PRESETS = [
  {
    label: 'Bitcoin Price',
    metric: 'Current price of Bitcoin in USD',
    description: 'The live spot price of Bitcoin (BTC) denominated in US Dollars.',
    urls: 'https://www.coingecko.com/en/coins/bitcoin',
  },
  {
    label: 'Gold Price',
    metric: 'Spot price of Gold per ounce in USD',
    description: 'The current spot price of gold (XAU) per troy ounce in US Dollars.',
    urls: 'https://www.kitco.com/charts/livegold.html',
  },
  {
    label: 'S&P 500',
    metric: 'S&P 500 Index Value',
    description: 'The current value of the S&P 500 stock market index.',
    urls: 'https://www.google.com/finance/quote/.INX:INDEXSP',
  },
  {
    label: 'Ethereum Gas',
    metric: 'Current Ethereum gas price in Gwei',
    description: 'The current average gas price on the Ethereum mainnet in Gwei.',
    urls: 'https://etherscan.io/gastracker',
  },
];

export default function DebugMetricAIWorkerPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [metric, setMetric] = useState('');
  const [description, setDescription] = useState('');
  const [urls, setUrls] = useState('');
  const [context, setContext] = useState<'create' | 'settlement'>('settlement');

  const [job, setJob] = useState<JobState>({ phase: 'idle' });
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [rawResult, setRawResult] = useState<Record<string, unknown> | null>(null);

  const abortRef = useRef(false);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const log = useCallback((level: LogEntry['level'], msg: string) => {
    setLogs(prev => [...prev, { ts: Date.now(), level, msg }]);
    setTimeout(() => logsEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50);
  }, []);

  const runJob = useCallback(async () => {
    abortRef.current = false;
    setLogs([]);
    setRawResult(null);

    const urlList = urls
      .split(/[\n,]/)
      .map(s => s.trim())
      .filter(Boolean);

    if (!metric.trim()) {
      setJob({ phase: 'failed', error: 'Metric name is required', durationMs: 0 });
      return;
    }
    if (urlList.length === 0) {
      setJob({ phase: 'failed', error: 'At least one URL is required', durationMs: 0 });
      return;
    }

    const started = Date.now();

    try {
      setJob({ phase: 'starting' });
      log('info', `Starting metric AI job...`);
      log('info', `Metric: ${metric.trim()}`);
      log('info', `URLs: ${urlList.join(', ')}`);
      if (description.trim()) log('info', `Description: ${description.trim()}`);

      const baseUrl = getMetricAIWorkerBaseUrl();
      log('info', `Worker base URL: ${baseUrl}`);

      const startRes = await fetch(`${baseUrl}/api/metric-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric: metric.trim(),
          description: description.trim() || undefined,
          urls: urlList,
          context,
        }),
        cache: 'no-store',
      });

      if (startRes.status !== 202) {
        const errBody = await startRes.json().catch(() => ({}));
        const msg = errBody?.message || errBody?.error || `Start failed (${startRes.status})`;
        throw new Error(msg);
      }

      const startData = await startRes.json();
      const jobId = startData?.jobId;
      if (!jobId) throw new Error('Worker did not return a jobId');

      log('success', `Job started: ${jobId}`);
      setJob({ phase: 'polling', jobId, pollCount: 0 });

      const intervalMs = 3000;
      const timeoutMs = 180_000;
      let pollCount = 0;

      while (Date.now() - started < timeoutMs) {
        if (abortRef.current) {
          log('warn', 'Aborted by user');
          setJob({ phase: 'failed', jobId, error: 'Aborted', durationMs: Date.now() - started });
          return;
        }

        await new Promise(r => setTimeout(r, intervalMs));
        pollCount++;

        const elapsed = ((Date.now() - started) / 1000).toFixed(1);
        log('info', `Poll #${pollCount} (${elapsed}s elapsed)...`);
        setJob({ phase: 'polling', jobId, pollCount });

        const pollRes = await fetch(`${baseUrl}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`, {
          cache: 'no-store',
        });

        if (!pollRes.ok) {
          const errBody = await pollRes.json().catch(() => ({}));
          throw new Error(errBody?.message || errBody?.error || `Poll failed (${pollRes.status})`);
        }

        const data = await pollRes.json();

        if (data.status === 'completed' && data.result) {
          const durationMs = Date.now() - started;
          log('success', `Completed in ${(durationMs / 1000).toFixed(1)}s after ${pollCount} polls`);
          log('success', `Value: ${data.result.value}`);
          log('success', `Confidence: ${((data.result.confidence ?? 0) * 100).toFixed(0)}%`);
          setRawResult(data);
          setJob({ phase: 'done', jobId, result: data.result, durationMs });
          return;
        }

        if (data.status === 'failed') {
          throw new Error(data.error || 'Job failed without an error message');
        }

        log('info', `Still processing...`);
      }

      throw new Error(`Timed out after ${(timeoutMs / 1000).toFixed(0)}s`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      log('error', msg);
      setJob(prev => ({
        phase: 'failed',
        jobId: 'jobId' in (prev as any) ? (prev as any).jobId : undefined,
        error: msg,
        durationMs: Date.now() - started,
      }));
    }
  }, [metric, description, urls, context, log]);

  const abort = useCallback(() => {
    abortRef.current = true;
  }, []);

  const applyPreset = useCallback((preset: typeof PRESETS[number]) => {
    setMetric(preset.metric);
    setDescription(preset.description);
    setUrls(preset.urls);
  }, []);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in production.
          </div>
        </div>
      </div>
    );
  }

  const isRunning = job.phase === 'starting' || job.phase === 'polling';
  const result = job.phase === 'done' ? job.result : null;

  return (
    <div className="mx-auto max-w-5xl p-4 space-y-4">
      {/* Header */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: Metric AI Worker</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Test the metric AI worker for accuracy. Provide a name, description, and one or more URLs to extract a metric value from.
            </div>
          </div>
          <a
            href="/debug"
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A]"
          >
            Back to Debug Hub
          </a>
        </div>
      </div>

      {/* Presets */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">Quick Presets</div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map(p => (
            <button
              key={p.label}
              onClick={() => applyPreset(p)}
              disabled={isRunning}
              className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-white disabled:opacity-40 transition-all"
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Inputs */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
        <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">Configuration</div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Metric Name <span className="text-red-400">*</span></div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white placeholder:text-[#555]"
              value={metric}
              onChange={e => setMetric(e.target.value)}
              placeholder="e.g. Current price of Bitcoin in USD"
              disabled={isRunning}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Description (guides the AI)</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white placeholder:text-[#555] resize-y min-h-[60px]"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Optional. Provide extra context about what the AI should look for..."
              rows={2}
              disabled={isRunning}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">
              URL(s) <span className="text-red-400">*</span>
              <span className="ml-2 text-[#555]">One per line or comma-separated, up to 10</span>
            </div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white font-mono placeholder:text-[#555] resize-y min-h-[60px]"
              value={urls}
              onChange={e => setUrls(e.target.value)}
              placeholder="https://www.coingecko.com/en/coins/bitcoin"
              rows={2}
              disabled={isRunning}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Context</div>
            <select
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={context}
              onChange={e => setContext(e.target.value as 'create' | 'settlement')}
              disabled={isRunning}
            >
              <option value="settlement">settlement</option>
              <option value="create">create</option>
            </select>
          </label>
        </div>
      </div>

      {/* Actions */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={runJob}
            disabled={isRunning}
            className="rounded bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50 transition-all"
          >
            {job.phase === 'starting' ? 'Starting...' : job.phase === 'polling' ? `Polling (#${(job as any).pollCount})...` : 'Run Metric AI'}
          </button>

          {isRunning && (
            <button
              onClick={abort}
              className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-[12px] font-medium text-red-300 hover:bg-red-500/15"
            >
              Abort
            </button>
          )}

          {job.phase !== 'idle' && !isRunning && (
            <button
              onClick={() => {
                setJob({ phase: 'idle' });
                setLogs([]);
                setRawResult(null);
              }}
              className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[12px] text-white hover:bg-[#1A1A1A]"
            >
              Clear
            </button>
          )}

          {job.phase === 'failed' && (
            <span className="text-[11px] text-red-300/90">{(job as any).error}</span>
          )}
        </div>

        {isRunning && (
          <div className="mt-3 flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-blue-400 animate-pulse" />
            <span className="text-[11px] text-[#9CA3AF]">
              {job.phase === 'starting' ? 'Sending request to worker...' : `Waiting for result (poll #${(job as any).pollCount})...`}
            </span>
          </div>
        )}
      </div>

      {/* Result Card */}
      {result && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4 space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide">Result</div>
            <div className="text-[10px] text-[#606060]">
              {((job as any).durationMs / 1000).toFixed(1)}s total
            </div>
          </div>

          {/* Value + Confidence */}
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-white/10 bg-black/30 p-4 md:col-span-2">
              <div className="text-[10px] text-[#808080] mb-1">Extracted Value</div>
              <div className="text-[20px] font-semibold text-white tracking-tight">
                {result.value || 'N/A'}
              </div>
              {result.unit && result.unit !== 'unknown' && (
                <div className="mt-1 text-[11px] text-[#9CA3AF]">{result.unit}</div>
              )}
              {result.as_of && (
                <div className="mt-1 text-[10px] text-[#606060]">as of {result.as_of}</div>
              )}
            </div>

            <div className={`rounded-lg border p-4 ${confidenceBg(result.confidence ?? 0)}`}>
              <div className="text-[10px] text-[#808080] mb-1">Confidence</div>
              <div className={`text-[28px] font-bold tabular-nums ${confidenceColor(result.confidence ?? 0)}`}>
                {((result.confidence ?? 0) * 100).toFixed(0)}%
              </div>
              <div className={`text-[11px] mt-1 ${confidenceColor(result.confidence ?? 0)}`}>
                {confidenceLabel(result.confidence ?? 0)}
              </div>
            </div>
          </div>

          {/* Asset Price Suggestion */}
          {result.asset_price_suggestion && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="text-[10px] text-[#808080] mb-1">Asset Price Suggestion</div>
              <div className="text-[14px] font-medium text-white tabular-nums">
                {result.asset_price_suggestion}
              </div>
            </div>
          )}

          {/* Reasoning */}
          {result.reasoning && (
            <div className="rounded-lg border border-white/10 bg-black/30 p-3">
              <div className="text-[10px] text-[#808080] mb-2">Reasoning</div>
              <div className="text-[11px] text-[#CCCCCC] leading-relaxed whitespace-pre-wrap max-h-[200px] overflow-y-auto">
                {result.reasoning}
              </div>
            </div>
          )}

          {/* Sources */}
          {result.sources && result.sources.length > 0 && (
            <div>
              <div className="text-[10px] text-[#808080] mb-2">Sources ({result.sources.length})</div>
              <div className="space-y-2">
                {result.sources.map((src: any, i: number) => (
                  <div
                    key={i}
                    className="rounded-lg border border-white/10 bg-black/30 p-3 flex gap-3"
                  >
                    {src.screenshot_url && (
                      <a href={src.screenshot_url} target="_blank" rel="noreferrer" className="shrink-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src.screenshot_url}
                          alt="Screenshot"
                          className="h-20 w-32 rounded border border-white/10 bg-black/40 object-cover"
                          loading="lazy"
                        />
                      </a>
                    )}
                    <div className="min-w-0 flex-1">
                      <a
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[11px] text-blue-400 hover:underline break-all"
                      >
                        {src.url}
                      </a>
                      {src.quote && (
                        <div className="mt-1 text-[11px] text-[#9CA3AF] italic line-clamp-3">
                          &ldquo;{src.quote}&rdquo;
                        </div>
                      )}
                      {typeof src.match_score === 'number' && (
                        <div className="mt-1 text-[10px] text-[#606060]">
                          Match: {(src.match_score * 100).toFixed(0)}%
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Raw JSON */}
      {rawResult && (
        <details className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <summary className="cursor-pointer text-[11px] text-white/60">Raw Response JSON</summary>
          <pre className="mt-3 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80 max-h-[500px]">
            {prettyJson(rawResult)}
          </pre>
        </details>
      )}

      {/* Logs */}
      {logs.length > 0 && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[10px] font-medium text-[#9CA3AF] uppercase tracking-wide mb-2">
            Logs ({logs.length})
          </div>
          <div className="overflow-auto rounded-md border border-white/10 bg-black/40 p-3 max-h-[300px] font-mono text-[11px] space-y-0.5">
            {logs.map((entry, i) => {
              const time = new Date(entry.ts).toLocaleTimeString();
              let color = 'text-[#808080]';
              if (entry.level === 'success') color = 'text-emerald-400';
              if (entry.level === 'warn') color = 'text-yellow-400';
              if (entry.level === 'error') color = 'text-red-400';
              return (
                <div key={i} className={color}>
                  <span className="text-[#555] mr-2">{time}</span>
                  {entry.msg}
                </div>
              );
            })}
            <div ref={logsEndRef} />
          </div>
        </div>
      )}
    </div>
  );
}
