'use client';

import React, { useCallback, useEffect, useState } from 'react';

interface Market {
  id: string;
  market_identifier: string;
  symbol: string;
  name: string;
  market_status: string;
  settlement_date: string | null;
  market_address: string | null;
  settlement_value: number | null;
  proposed_settlement_value: number | null;
  proposed_settlement_at: string | null;
  settlement_window_expires_at: string | null;
  settlement_disputed: boolean | null;
  alternative_settlement_value: number | null;
  created_at: string;
}

type Action = 'rollover' | 'settlement_start' | 'settlement_finalize' | 'challenge';

interface ActionResult {
  marketId: string;
  action: Action;
  status: 'pending' | 'success' | 'error';
  data?: Record<string, unknown>;
  error?: string;
  timestamp: string;
}

const ACTION_META: Record<Action, { label: string; description: string; color: string; hoverColor: string }> = {
  rollover: {
    label: 'Rollover',
    description: 'Creates a child market and links lineage on-chain',
    color: 'bg-blue-600',
    hoverColor: 'hover:bg-blue-500',
  },
  settlement_start: {
    label: 'Settlement Start',
    description: 'Triggers AI price fetch and opens the settlement window',
    color: 'bg-amber-600',
    hoverColor: 'hover:bg-amber-500',
  },
  settlement_finalize: {
    label: 'Settlement Finalize',
    description: 'Finalizes settlement on-chain if window expired and undisputed',
    color: 'bg-emerald-600',
    hoverColor: 'hover:bg-emerald-500',
  },
  challenge: {
    label: 'Challenge',
    description: 'Submits an alternative price to dispute the proposed settlement',
    color: 'bg-red-600',
    hoverColor: 'hover:bg-red-500',
  },
};

const STATUS_BADGES: Record<string, string> = {
  ACTIVE: 'bg-green-900/50 text-green-400 border-green-700/50',
  PENDING: 'bg-yellow-900/50 text-yellow-400 border-yellow-700/50',
  SETTLEMENT_REQUESTED: 'bg-amber-900/50 text-amber-400 border-amber-700/50',
  SETTLED: 'bg-blue-900/50 text-blue-400 border-blue-700/50',
  DEPLOYED: 'bg-purple-900/50 text-purple-400 border-purple-700/50',
};

function StatusBadge({ status }: { status: string }) {
  const cls = STATUS_BADGES[status] || 'bg-gray-900/50 text-gray-400 border-gray-700/50';
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      {status}
    </span>
  );
}

function formatDate(d: string | null) {
  if (!d) return '—';
  const date = new Date(d);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}

function timeUntil(d: string | null) {
  if (!d) return null;
  const diff = new Date(d).getTime() - Date.now();
  if (diff <= 0) return 'past';
  const hours = Math.floor(diff / 3_600_000);
  const mins = Math.floor((diff % 3_600_000) / 60_000);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h ${mins}m`;
}

export default function SettlementLifecyclePage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [actionResults, setActionResults] = useState<ActionResult[]>([]);
  const [inflight, setInflight] = useState<Set<string>>(new Set());
  const [challengePrice, setChallengePrice] = useState<string>('');

  const fetchMarkets = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/markets?limit=200');
      if (!res.ok) throw new Error(`Failed to fetch markets (${res.status})`);
      const json = await res.json();
      const list: Market[] = Array.isArray(json) ? json : json.markets || json.data || [];
      list.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
      setMarkets(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  const triggerAction = useCallback(
    async (marketId: string, action: Action) => {
      const key = `${marketId}:${action}`;
      setInflight((prev) => new Set(prev).add(key));

      const body: Record<string, unknown> = { action, market_id: marketId };
      if (action === 'challenge') {
        const price = parseFloat(challengePrice);
        if (!price || price <= 0) {
          setActionResults((prev) => [
            {
              marketId,
              action,
              status: 'error',
              error: 'Enter a valid positive price for challenge',
              timestamp: new Date().toISOString(),
            },
            ...prev,
          ]);
          setInflight((prev) => {
            const next = new Set(prev);
            next.delete(key);
            return next;
          });
          return;
        }
        body.price = price;
      }

      try {
        const res = await fetch('/api/debug/trigger-lifecycle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json().catch(() => ({}));
        setActionResults((prev) => [
          {
            marketId,
            action,
            status: res.ok ? 'success' : 'error',
            data: res.ok ? data : undefined,
            error: res.ok ? undefined : data?.error || `HTTP ${res.status}`,
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ]);
      } catch (e: unknown) {
        setActionResults((prev) => [
          {
            marketId,
            action,
            status: 'error',
            error: e instanceof Error ? e.message : String(e),
            timestamp: new Date().toISOString(),
          },
          ...prev,
        ]);
      } finally {
        setInflight((prev) => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [challengePrice],
  );

  const uniqueStatuses = Array.from(new Set(markets.map((m) => m.market_status))).sort();

  const filtered = markets.filter((m) => {
    if (statusFilter !== 'ALL' && m.market_status !== statusFilter) return false;
    if (!filter) return true;
    const q = filter.toLowerCase();
    return (
      m.symbol.toLowerCase().includes(q) ||
      m.name.toLowerCase().includes(q) ||
      m.market_identifier.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  });

  const selected = markets.find((m) => m.id === selectedId) || null;

  return (
    <div className="min-h-screen bg-[#0A0A0A] p-4 text-white">
      <div className="mx-auto max-w-7xl">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <a
            href="/debug"
            className="rounded border border-[#333] bg-[#141414] px-3 py-1.5 text-[11px] text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-white"
          >
            &larr; Debug
          </a>
          <h1 className="text-lg font-semibold tracking-tight">Settlement Lifecycle</h1>
          <button
            onClick={fetchMarkets}
            disabled={loading}
            className="ml-auto rounded border border-[#333] bg-[#141414] px-3 py-1.5 text-[11px] text-[#9CA3AF] hover:bg-[#1A1A1A] hover:text-white disabled:opacity-40"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-800/50 bg-red-950/30 px-4 py-2 text-[12px] text-red-400">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_420px]">
          {/* Left: Market list */}
          <div className="flex flex-col rounded-lg border border-[#1E1E1E] bg-[#111111]">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-2 border-b border-[#1E1E1E] px-4 py-3">
              <input
                className="flex-1 min-w-[180px] rounded border border-[#222] bg-[#0A0A0A] px-3 py-1.5 text-[12px] text-white placeholder-[#555] focus:border-[#444] focus:outline-none"
                placeholder="Search by symbol, name, or ID…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <select
                className="rounded border border-[#222] bg-[#0A0A0A] px-3 py-1.5 text-[12px] text-white focus:border-[#444] focus:outline-none"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="ALL">All statuses</option>
                {uniqueStatuses.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <span className="text-[11px] text-[#555]">
                {filtered.length} / {markets.length}
              </span>
            </div>

            {/* Market rows */}
            <div className="flex-1 overflow-y-auto" style={{ maxHeight: 'calc(100vh - 220px)' }}>
              {loading && markets.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[#555]">Loading markets…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="px-4 py-8 text-center text-[12px] text-[#555]">No markets found</div>
              )}
              {filtered.map((m) => {
                const isSelected = m.id === selectedId;
                const eta = timeUntil(m.settlement_date);
                return (
                  <button
                    key={m.id}
                    onClick={() => setSelectedId(isSelected ? null : m.id)}
                    className={`w-full text-left border-b border-[#1A1A1A] px-4 py-3 transition-colors ${
                      isSelected ? 'bg-[#1A1A2E]' : 'hover:bg-[#151515]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-white truncate">{m.symbol}</span>
                          <StatusBadge status={m.market_status} />
                        </div>
                        <div className="mt-0.5 text-[11px] text-[#666] truncate">{m.name}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[11px] text-[#666]">{formatDate(m.settlement_date)}</div>
                        {eta && eta !== 'past' && (
                          <div className="text-[10px] text-amber-500/80">{eta} left</div>
                        )}
                        {eta === 'past' && m.market_status === 'ACTIVE' && (
                          <div className="text-[10px] text-red-400">overdue</div>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: Selected market details + actions */}
          <div className="flex flex-col gap-4">
            {!selected ? (
              <div className="flex items-center justify-center rounded-lg border border-[#1E1E1E] bg-[#111111] p-12 text-[12px] text-[#555]">
                Select a market to trigger settlement actions
              </div>
            ) : (
              <>
                {/* Market info card */}
                <div className="rounded-lg border border-[#1E1E1E] bg-[#111111] p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-[14px] font-semibold">{selected.symbol}</div>
                      <div className="mt-0.5 text-[12px] text-[#888]">{selected.name}</div>
                    </div>
                    <StatusBadge status={selected.market_status} />
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    <div>
                      <div className="text-[#555]">Market ID</div>
                      <div className="font-mono text-[10px] text-[#aaa] break-all">{selected.id}</div>
                    </div>
                    <div>
                      <div className="text-[#555]">Identifier</div>
                      <div className="text-[#aaa]">{selected.market_identifier}</div>
                    </div>
                    <div>
                      <div className="text-[#555]">Settlement Date</div>
                      <div className="text-[#aaa]">{formatDate(selected.settlement_date)}</div>
                    </div>
                    <div>
                      <div className="text-[#555]">Contract</div>
                      <div className="font-mono text-[10px] text-[#aaa] break-all">
                        {selected.market_address || '—'}
                      </div>
                    </div>
                    {selected.proposed_settlement_value != null && (
                      <>
                        <div>
                          <div className="text-[#555]">Proposed Value</div>
                          <div className="text-amber-400">{selected.proposed_settlement_value}</div>
                        </div>
                        <div>
                          <div className="text-[#555]">Window Expires</div>
                          <div className="text-[#aaa]">{formatDate(selected.settlement_window_expires_at)}</div>
                        </div>
                      </>
                    )}
                    {selected.settlement_disputed && (
                      <div className="col-span-2">
                        <div className="text-red-400 font-semibold">
                          Disputed — alt value: {selected.alternative_settlement_value}
                        </div>
                      </div>
                    )}
                    {selected.settlement_value != null && (
                      <div>
                        <div className="text-[#555]">Final Settlement</div>
                        <div className="text-emerald-400 font-semibold">{selected.settlement_value}</div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Action buttons */}
                <div className="rounded-lg border border-[#1E1E1E] bg-[#111111] p-4">
                  <div className="text-[12px] font-medium text-white mb-3">Trigger Settlement Actions</div>
                  <div className="flex flex-col gap-2">
                    {(['rollover', 'settlement_start', 'settlement_finalize', 'challenge'] as Action[]).map(
                      (action) => {
                        const meta = ACTION_META[action];
                        const key = `${selected.id}:${action}`;
                        const isLoading = inflight.has(key);

                        return (
                          <div key={action}>
                            {action === 'challenge' && (
                              <div className="mb-1.5 mt-1">
                                <input
                                  className="w-full rounded border border-[#222] bg-[#0A0A0A] px-3 py-1.5 text-[12px] text-white placeholder-[#555] focus:border-[#444] focus:outline-none"
                                  placeholder="Challenge price (e.g. 42500.50)"
                                  type="number"
                                  step="any"
                                  min="0"
                                  value={challengePrice}
                                  onChange={(e) => setChallengePrice(e.target.value)}
                                />
                              </div>
                            )}
                            <button
                              onClick={() => triggerAction(selected.id, action)}
                              disabled={isLoading}
                              className={`w-full rounded px-4 py-2.5 text-left transition-colors disabled:opacity-50 ${meta.color} ${meta.hoverColor}`}
                            >
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="text-[12px] font-semibold text-white">{meta.label}</div>
                                  <div className="text-[10px] text-white/60">{meta.description}</div>
                                </div>
                                {isLoading && (
                                  <svg
                                    className="h-4 w-4 animate-spin text-white/80"
                                    fill="none"
                                    viewBox="0 0 24 24"
                                  >
                                    <circle
                                      className="opacity-25"
                                      cx="12"
                                      cy="12"
                                      r="10"
                                      stroke="currentColor"
                                      strokeWidth="4"
                                    />
                                    <path
                                      className="opacity-75"
                                      fill="currentColor"
                                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                                    />
                                  </svg>
                                )}
                              </div>
                            </button>
                          </div>
                        );
                      },
                    )}
                  </div>
                </div>

                {/* Results log for this market */}
                {actionResults.filter((r) => r.marketId === selected.id).length > 0 && (
                  <div className="rounded-lg border border-[#1E1E1E] bg-[#111111] p-4">
                    <div className="text-[12px] font-medium text-white mb-2">Action Log</div>
                    <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto">
                      {actionResults
                        .filter((r) => r.marketId === selected.id)
                        .map((r, i) => (
                          <div
                            key={i}
                            className={`rounded border p-2 text-[11px] ${
                              r.status === 'success'
                                ? 'border-emerald-800/40 bg-emerald-950/20'
                                : r.status === 'error'
                                  ? 'border-red-800/40 bg-red-950/20'
                                  : 'border-[#222] bg-[#0A0A0A]'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-2 mb-1">
                              <span className="font-semibold">
                                {ACTION_META[r.action].label}
                              </span>
                              <span
                                className={`text-[10px] ${
                                  r.status === 'success' ? 'text-emerald-400' : 'text-red-400'
                                }`}
                              >
                                {r.status}
                              </span>
                            </div>
                            <div className="text-[10px] text-[#666] mb-1">
                              {new Date(r.timestamp).toLocaleTimeString()}
                            </div>
                            {r.error && <div className="text-red-400 text-[10px]">{r.error}</div>}
                            {r.data && (
                              <pre className="mt-1 max-h-[120px] overflow-auto rounded bg-[#0A0A0A] p-2 text-[10px] text-[#888] whitespace-pre-wrap break-all">
                                {JSON.stringify(r.data, null, 2)}
                              </pre>
                            )}
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
