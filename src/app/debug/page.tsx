'use client';
import React from 'react';

type IconSearchResponse = {
  results: Array<{
    title: string;
    url: string;
    thumbnail: string;
    source: string;
    domain: string;
  }>;
  debug?: {
    kind?: string;
    intent?: string;
    primaryQuery?: string;
    usedQuery?: string;
    usedEngine?: string;
    usedQueryLabel?: string;
    resultCount?: number;
    primaryResultCount?: number;
    fallbackAttempted?: boolean;
    fallbackQuery?: string | null;
    fallbackResultCount?: number;
    backupAttempted?: boolean;
    backupQuery?: string | null;
    backupResultCount?: number;
  };
  error?: string;
};

type MetricDiscoveryResponse = {
  measurable: boolean;
  metric_definition: unknown | null;
  assumptions: string[];
  sources: unknown | null;
  rejection_reason: string | null;
  search_results: unknown[];
  processing_time_ms?: number;
};

function prettyJson(x: unknown) {
  try {
    return JSON.stringify(x, null, 2);
  } catch {
    return String(x);
  }
}

function getErrorMessage(e: unknown) {
  if (e instanceof Error) return e.message;
  try {
    return typeof e === 'string' ? e : JSON.stringify(e);
  } catch {
    return String(e);
  }
}

export default function DebugSearchPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  // Icon search tester
  const [iconQuery, setIconQuery] = React.useState('bitcoin');
  const [iconDescription, setIconDescription] = React.useState('Current price of Bitcoin in USD');
  const [iconMaxResults, setIconMaxResults] = React.useState(8);
  const [iconDebug, setIconDebug] = React.useState(true);
  const [iconLoading, setIconLoading] = React.useState(false);
  const [iconError, setIconError] = React.useState<string | null>(null);
  const [iconResp, setIconResp] = React.useState<IconSearchResponse | null>(null);

  // Metric discovery tester
  const [mdDescription, setMdDescription] = React.useState(
    'Current price of Bitcoin in USD. Prefer a stable public API endpoint.'
  );
  const [mdMode, setMdMode] = React.useState<'define_only' | 'full'>('full');
  const [mdSearchVariation, setMdSearchVariation] = React.useState(0);
  const [mdExcludeUrls, setMdExcludeUrls] = React.useState('');
  const [mdLoading, setMdLoading] = React.useState(false);
  const [mdError, setMdError] = React.useState<string | null>(null);
  const [mdResp, setMdResp] = React.useState<MetricDiscoveryResponse | null>(null);

  // Step1 -> Step3 simulation (matches Create Market V2 behavior)
  const [simLoading, setSimLoading] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const [simStep1, setSimStep1] = React.useState<MetricDiscoveryResponse | null>(null);
  const [simStep3, setSimStep3] = React.useState<MetricDiscoveryResponse | null>(null);
  const [simMerged, setSimMerged] = React.useState<MetricDiscoveryResponse | null>(null);

  const runIconSearch = React.useCallback(async () => {
    setIconLoading(true);
    setIconError(null);
    setIconResp(null);
    try {
      const res = await fetch('/api/icon-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: iconQuery,
          description: iconDescription,
          maxResults: iconMaxResults,
          debug: iconDebug,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as IconSearchResponse;
      if (!res.ok) throw new Error(json?.error || `icon-search failed (${res.status})`);
      setIconResp(json);
    } catch (e: unknown) {
      setIconError(getErrorMessage(e) || 'Icon search failed');
    } finally {
      setIconLoading(false);
    }
  }, [iconQuery, iconDescription, iconMaxResults, iconDebug]);

  const runMetricDiscovery = React.useCallback(async () => {
    setMdLoading(true);
    setMdError(null);
    setMdResp(null);
    try {
      const excludeUrls = mdExcludeUrls
        .split(/\n|,/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 25);

      const res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          description: mdDescription,
          mode: mdMode,
          searchVariation: mdMode === 'full' ? mdSearchVariation : undefined,
          excludeUrls: mdMode === 'full' && excludeUrls.length > 0 ? excludeUrls : undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        error?: string;
        message?: string;
      };
      if (!res.ok) throw new Error(json?.message || json?.error || `metric-discovery failed (${res.status})`);
      setMdResp(json);
    } catch (e: unknown) {
      setMdError(getErrorMessage(e) || 'Metric discovery failed');
    } finally {
      setMdLoading(false);
    }
  }, [mdDescription, mdExcludeUrls, mdMode, mdSearchVariation]);

  const runSim = React.useCallback(async () => {
    setSimLoading(true);
    setSimError(null);
    setSimStep1(null);
    setSimStep3(null);
    setSimMerged(null);
    try {
      const step1Res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: mdDescription, mode: 'define_only' }),
      });
      const step1 = (await step1Res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        message?: string;
      };
      if (!step1Res.ok) throw new Error(step1?.message || `Step 1 failed (${step1Res.status})`);
      setSimStep1(step1);

      const step3Res = await fetch('/api/metric-discovery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: mdDescription, mode: 'full', searchVariation: mdSearchVariation }),
      });
      const step3 = (await step3Res.json().catch(() => ({}))) as MetricDiscoveryResponse & {
        message?: string;
      };
      if (!step3Res.ok) throw new Error(step3?.message || `Step 3 failed (${step3Res.status})`);
      setSimStep3(step3);

      // Mimic InteractiveMarketCreation merge behavior (preserve metric_definition)
      const merged: MetricDiscoveryResponse = {
        ...step1,
        ...step3,
        metric_definition: step3.metric_definition || step1.metric_definition,
        assumptions:
          Array.isArray(step3.assumptions) && step3.assumptions.length > 0 ? step3.assumptions : step1.assumptions,
      };
      if (step1.metric_definition && step3.measurable === false) {
        merged.measurable = true;
        merged.rejection_reason = step1.rejection_reason ?? null;
      }
      setSimMerged(merged);
    } catch (e: unknown) {
      setSimError(getErrorMessage(e) || 'Simulation failed');
    } finally {
      setSimLoading(false);
    }
  }, [mdDescription, mdSearchVariation]);

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

  return (
    <div className="mx-auto max-w-5xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[12px] font-medium text-white">Debug: Search + Image Intent</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Test SerpAPI fallback behavior and the Unsplash/logo intent normalization.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/js-extractor">
              JS Extractor
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/deployment-overlay">
              Deployment Overlay
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/market-similarity">
              Market Similarity
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/create-market-v2">
              Create Market V2 UI
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/orders-v2">
              On-Chain Orders V2
            </a>
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug/order-fill-modal">
              Order Fill Modal
            </a>
          </div>
        </div>
      </div>

      {/* Icon search */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Icon Search (SerpAPI Images)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Calls <span className="font-mono text-white/80">/api/icon-search</span>. If results are empty, it will retry with a different query and a backup engine.
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Query</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={iconQuery}
              onChange={(e) => setIconQuery(e.target.value)}
              placeholder="bitcoin"
            />
          </label>
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Max results</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(iconMaxResults)}
              onChange={(e) => setIconMaxResults(Math.max(1, Math.min(20, Number(e.target.value) || 8)))}
              placeholder="8"
            />
          </label>
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Description (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={iconDescription}
              onChange={(e) => setIconDescription(e.target.value)}
              placeholder="Context helps the intent model pick photo vs logo/icon"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-[11px] text-[#9CA3AF]">
            <input type="checkbox" checked={iconDebug} onChange={(e) => setIconDebug(e.target.checked)} />
            Include debug block
          </label>
          <button
            onClick={runIconSearch}
            disabled={iconLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {iconLoading ? 'Searching…' : 'Run icon search'}
          </button>
          {iconError ? <div className="text-[11px] text-red-300/90">{iconError}</div> : null}
        </div>

        {iconResp?.debug ? (
          <div className="mt-3 space-y-3 text-[11px] text-[#9CA3AF]">
            <div className="grid gap-2 md:grid-cols-2">
              <div>
                <span className="text-white/70">Kind:</span>{' '}
                <span className="text-white/90">{iconResp.debug.kind || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Intent:</span>{' '}
                <span className="text-white/90">{iconResp.debug.intent || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Used engine:</span>{' '}
                <span className="text-white/90">{iconResp.debug.usedEngine || '—'}</span>
              </div>
              <div>
                <span className="text-white/70">Used path:</span>{' '}
                <span className="text-white/90">{iconResp.debug.usedQueryLabel || '—'}</span>
              </div>
            </div>

            {/* Highlight: primary vs fallback */}
            <div className="rounded-xl border border-white/10 bg-black/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    iconResp.debug.usedQueryLabel === 'primary'
                      ? 'bg-emerald-500/20 text-emerald-200 border border-emerald-500/30'
                      : 'bg-white/5 text-white/70 border border-white/10',
                  ].join(' ')}
                >
                  Primary
                </span>
                <span className="text-white/70">results:</span>{' '}
                <span className="text-white/90 tabular-nums">
                  {typeof iconResp.debug.primaryResultCount === 'number' ? iconResp.debug.primaryResultCount : '—'}
                </span>
              </div>
              <div className="mt-2">
                <span className="text-white/70">query:</span>{' '}
                <span className="text-white/90 font-mono break-all">{iconResp.debug.primaryQuery || '—'}</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span
                  className={[
                    'rounded-full px-2 py-0.5 text-[10px] font-medium',
                    iconResp.debug.usedQueryLabel === 'fallback' || iconResp.debug.usedQueryLabel === 'backup_engine'
                      ? 'bg-yellow-500/20 text-yellow-200 border border-yellow-500/30'
                      : 'bg-white/5 text-white/70 border border-white/10',
                  ].join(' ')}
                >
                  Fallback triggered
                </span>
                <span className="text-white/90">
                  {iconResp.debug.fallbackAttempted ? 'Yes' : 'No'}
                </span>
                {iconResp.debug.fallbackAttempted ? (
                  <>
                    <span className="text-white/60">•</span>
                    <span className="text-white/70">fallback results:</span>{' '}
                    <span className="text-white/90 tabular-nums">
                      {typeof iconResp.debug.fallbackResultCount === 'number'
                        ? iconResp.debug.fallbackResultCount
                        : '—'}
                    </span>
                  </>
                ) : null}
              </div>

              {iconResp.debug.fallbackAttempted ? (
                <div className="mt-2">
                  <span className="text-white/70">fallback query:</span>{' '}
                  <span className="text-white/90 font-mono break-all">
                    {iconResp.debug.fallbackQuery || '—'}
                  </span>
                </div>
              ) : null}

              {iconResp.debug.backupAttempted ? (
                <div className="mt-3">
                  <div className="text-white/70">
                    Backup engine attempted ({iconResp.debug.usedEngine || '—'}):{' '}
                    <span className="text-white/90 tabular-nums">
                      {typeof iconResp.debug.backupResultCount === 'number'
                        ? iconResp.debug.backupResultCount
                        : '—'}
                    </span>
                  </div>
                  {iconResp.debug.backupQuery ? (
                    <div className="mt-1">
                      <span className="text-white/70">backup query:</span>{' '}
                      <span className="text-white/90 font-mono break-all">{iconResp.debug.backupQuery}</span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </div>
        ) : null}

        {iconResp?.results?.length ? (
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            {iconResp.results.map((r, idx) => (
              <a
                key={`${r.domain}-${idx}`}
                href={r.url}
                target="_blank"
                rel="noreferrer"
                className="group rounded-lg border border-white/10 bg-black/30 p-2 hover:bg-black/40"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.thumbnail || r.url}
                  alt={r.title || 'result'}
                  className="h-20 w-full rounded-md bg-black/40 object-contain"
                  loading="lazy"
                  referrerPolicy="no-referrer"
                />
                <div className="mt-2 text-[10px] text-white/70 line-clamp-2">{r.title || r.domain || 'Result'}</div>
                <div className="mt-1 text-[10px] text-white/40">{r.domain}</div>
              </a>
            ))}
          </div>
        ) : iconResp ? (
          <div className="mt-4 text-[11px] text-white/60">No results.</div>
        ) : null}

        {iconResp ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-white/60">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(iconResp)}
            </pre>
          </details>
        ) : null}
      </div>

      {/* Metric discovery */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Metric Discovery (SerpAPI Web)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Calls <span className="font-mono text-white/80">/api/metric-discovery</span>. In full mode, it returns
          <span className="font-mono text-white/80"> search_results</span> that should no longer be empty just because the first query was too strict.
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Description</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdDescription}
              onChange={(e) => setMdDescription(e.target.value)}
              rows={3}
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Mode</div>
            <select
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdMode}
              onChange={(e) => {
                const v = e.target.value === 'define_only' ? 'define_only' : 'full';
                setMdMode(v);
              }}
            >
              <option value="full">full (SERP + AI ranking)</option>
              <option value="define_only">define_only (no SERP)</option>
            </select>
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Search variation (full only)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(mdSearchVariation)}
              onChange={(e) => setMdSearchVariation(Math.max(0, Math.min(10, Number(e.target.value) || 0)))}
            />
          </label>

          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Exclude URLs (optional, newline/comma separated)</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={mdExcludeUrls}
              onChange={(e) => setMdExcludeUrls(e.target.value)}
              rows={2}
              placeholder="https://example.com"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={runMetricDiscovery}
            disabled={mdLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {mdLoading ? 'Running…' : 'Run metric discovery'}
          </button>
          {mdError ? <div className="text-[11px] text-red-300/90">{mdError}</div> : null}
        </div>

        {mdResp ? (
          <details className="mt-4" open>
            <summary className="cursor-pointer text-[11px] text-white/60">
              Response ({Array.isArray(mdResp.search_results) ? mdResp.search_results.length : 0} search results)
            </summary>
            <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(mdResp)}
            </pre>
          </details>
        ) : null}
      </div>

      {/* Simulation */}
      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Create Market V2 Simulation (Step 1 → Step 3 merge)</div>
        <div className="mt-1 text-[11px] text-[#9CA3AF]">
          Runs <span className="font-mono text-white/80">define_only</span> then <span className="font-mono text-white/80">full</span> and shows a merged payload that preserves <span className="font-mono text-white/80">metric_definition</span> if SERP returns nothing.
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={runSim}
            disabled={simLoading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {simLoading ? 'Running…' : 'Run simulation'}
          </button>
          {simError ? <div className="text-[11px] text-red-300/90">{simError}</div> : null}
        </div>

        {simMerged ? (
          <div className="mt-4 grid gap-3 md:grid-cols-3">
            <details className="md:col-span-1">
              <summary className="cursor-pointer text-[11px] text-white/60">Step 1 (define_only)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simStep1)}
              </pre>
            </details>
            <details className="md:col-span-1">
              <summary className="cursor-pointer text-[11px] text-white/60">Step 3 (full)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simStep3)}
              </pre>
            </details>
            <details className="md:col-span-1" open>
              <summary className="cursor-pointer text-[11px] text-white/60">Merged (Create Market V2 behavior)</summary>
              <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(simMerged)}
              </pre>
            </details>
          </div>
        ) : null}
      </div>
    </div>
  );
}

