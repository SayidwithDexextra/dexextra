'use client';

import React from 'react';

type SimilarityReason =
  | { type: 'identifier_exact' }
  | { type: 'symbol_exact' }
  | { type: 'name_exact' }
  | { type: 'identifier_substring' }
  | { type: 'symbol_substring' }
  | { type: 'name_substring' }
  | { type: 'description_substring' }
  | { type: 'token_overlap'; value: number; common: string[] };

type SimilarMarketMatch = {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  description: string;
  category: string;
  market_status: string;
  settlement_date: string | null;
  created_at: string | null;
  score: number;
  reasons: SimilarityReason[];
};

type SimilarMarketsResponse = {
  query: {
    input: { intent: string | null; name: string | null; description: string | null };
    normalized: string;
    tokens: string[];
    category: string | null;
    status: string | null;
    limit: number;
  };
  matches: SimilarMarketMatch[];
  error?: string;
  details?: unknown;
  message?: string;
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

function formatReason(r: SimilarityReason) {
  switch (r.type) {
    case 'identifier_exact':
      return 'Exact identifier match';
    case 'symbol_exact':
      return 'Exact symbol match';
    case 'name_exact':
      return 'Exact name match';
    case 'identifier_substring':
      return 'Identifier contains query';
    case 'symbol_substring':
      return 'Symbol contains query';
    case 'name_substring':
      return 'Name contains query';
    case 'description_substring':
      return 'Description contains query';
    case 'token_overlap':
      return `Token overlap: ${Math.round((r.value || 0) * 100)}% (${(r.common || []).join(', ')})`;
    default:
      return r.type;
  }
}

export default function DebugMarketSimilarityPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [intent, setIntent] = React.useState('bitcoin price in usd');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [status, setStatus] = React.useState('');
  const [limit, setLimit] = React.useState(5);

  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [resp, setResp] = React.useState<SimilarMarketsResponse | null>(null);

  const run = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    setResp(null);
    try {
      const res = await fetch('/api/markets/similar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          intent: intent || undefined,
          name: name || undefined,
          description: description || undefined,
          category: category || undefined,
          status: status || undefined,
          limit,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as SimilarMarketsResponse;
      if (!res.ok) {
        throw new Error((json as any)?.error || (json as any)?.message || `Request failed (${res.status})`);
      }
      setResp(json);
    } catch (e: unknown) {
      setError(getErrorMessage(e) || 'Request failed');
    } finally {
      setLoading(false);
    }
  }, [intent, name, description, category, status, limit]);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable in
            production.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl p-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[12px] font-medium text-white">Debug: Market Similarity</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Calls <span className="font-mono text-white/80">/api/markets/similar</span> and returns ranked matches
              using the <span className="font-mono text-white/80">search_markets</span> RPC + deterministic scoring.
            </div>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            <a className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-white hover:bg-[#1A1A1A]" href="/debug">
              Back to /debug
            </a>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[12px] font-medium text-white">Query</div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="block md:col-span-2">
            <div className="text-[10px] text-[#808080] mb-1">Intent (free text)</div>
            <textarea
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              rows={2}
              placeholder="bitcoin price in usd"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Name (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="BTC-USD"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Description (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tracks the current price of Bitcoin in USD."
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Category filter (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              placeholder="Crypto"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Status filter (optional)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              placeholder="ACTIVE"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Limit</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={String(limit)}
              onChange={(e) => setLimit(Math.max(1, Math.min(20, Number(e.target.value) || 5)))}
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={run}
            disabled={loading}
            className="rounded bg-white px-3 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50"
          >
            {loading ? 'Searching…' : 'Run similarity search'}
          </button>
          {error ? <div className="text-[11px] text-red-300/90">{error}</div> : null}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[12px] font-medium text-white">Matches</div>
          <div className="text-[11px] text-[#9CA3AF]">
            {resp ? `${resp.matches?.length || 0} result(s)` : '—'}
          </div>
        </div>

        {resp?.query ? (
          <div className="mt-2 rounded border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
            <div>
              <span className="text-white/60">Normalized:</span>{' '}
              <span className="font-mono">{resp.query.normalized || '—'}</span>
            </div>
            <div className="mt-1">
              <span className="text-white/60">Tokens:</span>{' '}
              <span className="font-mono">{Array.isArray(resp.query.tokens) ? resp.query.tokens.join(' ') : '—'}</span>
            </div>
          </div>
        ) : null}

        {resp?.matches?.length ? (
          <div className="mt-3 space-y-3">
            {resp.matches.map((m) => (
              <div key={m.id} className="rounded-md border border-white/10 bg-black/30 p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-[12px] font-medium text-white">
                      <span className="font-mono">{m.symbol}</span>{' '}
                      <span className="text-white/70">•</span>{' '}
                      <span className="text-white/90">{m.name}</span>
                    </div>
                    <div className="mt-1 text-[11px] text-white/60">
                      <span className="font-mono text-white/70">{m.market_identifier}</span>{' '}
                      <span className="text-white/40">•</span> {m.market_status}{' '}
                      <span className="text-white/40">•</span> {m.category}
                    </div>
                  </div>
                  <div className="shrink-0 rounded-full border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white/80 tabular-nums">
                    score {Math.round((m.score || 0) * 100)}%
                  </div>
                </div>

                <div className="mt-2 text-[11px] text-white/70 line-clamp-3">{m.description}</div>

                {Array.isArray(m.reasons) && m.reasons.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {m.reasons.slice(0, 6).map((r, idx) => (
                      <span
                        key={`${m.id}-r-${idx}`}
                        className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-white/70"
                      >
                        {formatReason(r)}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : resp ? (
          <div className="mt-3 text-[11px] text-white/60">No matches.</div>
        ) : (
          <div className="mt-3 text-[11px] text-white/60">Run a query to see matches.</div>
        )}

        {resp ? (
          <details className="mt-4">
            <summary className="cursor-pointer text-[11px] text-white/60">Raw response</summary>
            <pre className="mt-2 overflow-auto rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-white/80">
{prettyJson(resp)}
            </pre>
          </details>
        ) : null}
      </div>
    </div>
  );
}

