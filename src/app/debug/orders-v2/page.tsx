'use client';

import React, { useState, useCallback } from 'react';

// ── Types matching the API response ─────────────────────────────────────
interface SerializedOrder {
  orderId: string;
  trader: string;
  price: string;
  priceFormatted: number;
  amount: string;
  amountFormatted: number;
  isBuy: boolean;
  side: 'BUY' | 'SELL';
  timestamp: number;
  timestampISO: string;
  nextOrderId: string;
  marginRequired: string;
  marginRequiredFormatted: number;
  isMarginOrder: boolean;
  market?: string;
}

interface MarketResult {
  symbol: string;
  address: string;
  buyCount: string;
  sellCount: string;
  bestBid: string;
  bestBidFormatted: number;
  bestAsk: string;
  bestAskFormatted: number;
  ordersFound: number;
}

interface ApiResponse {
  ok: boolean;
  elapsed_ms: number;
  totalOrders: number;
  marketsScanned: number;
  markets: MarketResult[];
  orders: SerializedOrder[];
  error?: string;
  warning?: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────
function truncateAddress(addr: string): string {
  if (!addr || addr.length < 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatNumber(n: number, decimals = 2): string {
  if (n === 0) return '0';
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(decimals)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(decimals)}K`;
  return n.toFixed(decimals);
}

function relativeTime(ts: number): string {
  if (!ts) return '-';
  const diff = Date.now() - ts;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ── Component ───────────────────────────────────────────────────────────
export default function DebugOrdersV2Page() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  // Filters
  const [marketFilter, setMarketFilter] = useState('');
  const [traderFilter, setTraderFilter] = useState('');
  const [maxOrderId, setMaxOrderId] = useState('500');
  const [maxEmpty, setMaxEmpty] = useState('20');

  // Response state
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ApiResponse | null>(null);

  // Table state
  const [sideFilter, setSideFilter] = useState<'ALL' | 'BUY' | 'SELL'>('ALL');
  const [sortField, setSortField] = useState<'orderId' | 'price' | 'amount' | 'timestamp'>('orderId');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [showRaw, setShowRaw] = useState(false);

  const fetchOrders = useCallback(async () => {
    setLoading(true);
    setError(null);
    setData(null);

    try {
      const params = new URLSearchParams();
      if (marketFilter.trim()) params.set('market', marketFilter.trim());
      if (traderFilter.trim()) params.set('trader', traderFilter.trim());
      if (maxOrderId.trim()) params.set('maxOrderId', maxOrderId.trim());
      if (maxEmpty.trim()) params.set('maxEmpty', maxEmpty.trim());

      const res = await fetch(`/api/debug/orders-v2?${params.toString()}`);
      const json = (await res.json()) as ApiResponse;
      if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
      setData(json);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [marketFilter, traderFilter, maxOrderId, maxEmpty]);

  // Filtered + sorted orders
  const displayOrders = React.useMemo(() => {
    if (!data?.orders) return [];
    let orders = [...data.orders];
    if (sideFilter !== 'ALL') orders = orders.filter((o) => o.side === sideFilter);

    orders.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'orderId':
          cmp = Number(BigInt(a.orderId) - BigInt(b.orderId));
          break;
        case 'price':
          cmp = a.priceFormatted - b.priceFormatted;
          break;
        case 'amount':
          cmp = a.amountFormatted - b.amountFormatted;
          break;
        case 'timestamp':
          cmp = a.timestamp - b.timestamp;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });

    return orders;
  }, [data, sideFilter, sortField, sortDir]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDir('desc');
    }
  };

  const sortIcon = (field: typeof sortField) => {
    if (sortField !== field) return '';
    return sortDir === 'asc' ? ' \u25B2' : ' \u25BC';
  };

  // ── Disabled gate ───────────────────────────────────────────────────
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

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className="mx-auto max-w-7xl p-4 space-y-4">
      {/* Header */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <div className="text-[13px] font-medium text-white">Debug: On-Chain Orders V2</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              Reads orders directly from deployed OrderBook smart contracts via{' '}
              <span className="font-mono text-white/80">/api/debug/orders-v2</span>.
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

      {/* Filters */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="text-[11px] font-medium text-white/70 mb-3">Query Parameters</div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Market (symbol filter)</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white placeholder:text-[#555]"
              value={marketFilter}
              onChange={(e) => setMarketFilter(e.target.value)}
              placeholder="e.g. BTC-USD (blank = all)"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Trader address</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white placeholder:text-[#555] font-mono"
              value={traderFilter}
              onChange={(e) => setTraderFilter(e.target.value)}
              placeholder="0x... (blank = iterate IDs)"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Max order ID to scan</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={maxOrderId}
              onChange={(e) => setMaxOrderId(e.target.value)}
              placeholder="500"
            />
          </label>

          <label className="block">
            <div className="text-[10px] text-[#808080] mb-1">Max consecutive empty</div>
            <input
              className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
              value={maxEmpty}
              onChange={(e) => setMaxEmpty(e.target.value)}
              placeholder="20"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            onClick={fetchOrders}
            disabled={loading}
            className="rounded bg-white px-4 py-2 text-[12px] font-medium text-black hover:bg-white/90 disabled:opacity-50 transition-opacity"
          >
            {loading ? 'Fetching...' : 'Fetch Orders'}
          </button>
          {error && <div className="text-[11px] text-red-400">{error}</div>}
          {data && !error && (
            <div className="text-[11px] text-emerald-400">
              Found {data.totalOrders} orders across {data.marketsScanned} markets in {data.elapsed_ms}ms
            </div>
          )}
        </div>
      </div>

      {/* Market Summary Cards */}
      {data && data.markets.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.markets.map((m) => (
            <div key={m.address} className="rounded-md border border-[#222222] bg-[#0F0F0F] p-3">
              <div className="flex items-center justify-between">
                <div className="text-[12px] font-medium text-white">{m.symbol}</div>
                <div className="text-[10px] font-mono text-[#9CA3AF]">{truncateAddress(m.address)}</div>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                <div>
                  <span className="text-[#808080]">Buy orders: </span>
                  <span className="text-emerald-400 tabular-nums">{m.buyCount}</span>
                </div>
                <div>
                  <span className="text-[#808080]">Sell orders: </span>
                  <span className="text-red-400 tabular-nums">{m.sellCount}</span>
                </div>
                <div>
                  <span className="text-[#808080]">Best Bid: </span>
                  <span className="text-white tabular-nums">{m.bestBidFormatted > 0 ? formatNumber(m.bestBidFormatted, 4) : '-'}</span>
                </div>
                <div>
                  <span className="text-[#808080]">Best Ask: </span>
                  <span className="text-white tabular-nums">{m.bestAskFormatted > 0 ? formatNumber(m.bestAskFormatted, 4) : '-'}</span>
                </div>
                <div className="col-span-2">
                  <span className="text-[#808080]">Fetched orders: </span>
                  <span className="text-white tabular-nums">{m.ordersFound}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Orders Table */}
      {data && data.orders.length > 0 && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] overflow-hidden">
          {/* Table toolbar */}
          <div className="flex flex-wrap items-center gap-3 border-b border-[#222222] px-4 py-2.5">
            <div className="text-[11px] font-medium text-white/70">
              Orders ({displayOrders.length}
              {sideFilter !== 'ALL' ? ` ${sideFilter}` : ''})
            </div>

            <div className="ml-auto flex items-center gap-2">
              {(['ALL', 'BUY', 'SELL'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setSideFilter(s)}
                  className={[
                    'rounded px-2.5 py-1 text-[10px] font-medium transition-colors',
                    sideFilter === s
                      ? s === 'BUY'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : s === 'SELL'
                          ? 'bg-red-500/20 text-red-300 border border-red-500/30'
                          : 'bg-white/10 text-white border border-white/20'
                      : 'bg-transparent text-[#808080] border border-transparent hover:text-white/70',
                  ].join(' ')}
                >
                  {s}
                </button>
              ))}

              <label className="ml-2 flex items-center gap-1.5 text-[10px] text-[#808080] cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showRaw}
                  onChange={(e) => setShowRaw(e.target.checked)}
                  className="accent-white"
                />
                Raw JSON
              </label>
            </div>
          </div>

          {showRaw ? (
            <pre className="overflow-auto p-4 text-[11px] text-white/80 max-h-[600px]">
              {JSON.stringify(displayOrders, null, 2)}
            </pre>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[11px]">
                <thead>
                  <tr className="border-b border-[#1A1A1A] text-left text-[10px] text-[#808080]">
                    <th
                      className="px-3 py-2 cursor-pointer hover:text-white/70 select-none"
                      onClick={() => handleSort('orderId')}
                    >
                      ID{sortIcon('orderId')}
                    </th>
                    <th className="px-3 py-2">Market</th>
                    <th className="px-3 py-2">Side</th>
                    <th
                      className="px-3 py-2 text-right cursor-pointer hover:text-white/70 select-none"
                      onClick={() => handleSort('price')}
                    >
                      Price{sortIcon('price')}
                    </th>
                    <th
                      className="px-3 py-2 text-right cursor-pointer hover:text-white/70 select-none"
                      onClick={() => handleSort('amount')}
                    >
                      Amount{sortIcon('amount')}
                    </th>
                    <th className="px-3 py-2 text-right">Margin Req</th>
                    <th className="px-3 py-2">Trader</th>
                    <th
                      className="px-3 py-2 text-right cursor-pointer hover:text-white/70 select-none"
                      onClick={() => handleSort('timestamp')}
                    >
                      Time{sortIcon('timestamp')}
                    </th>
                    <th className="px-3 py-2 text-center">Margin</th>
                  </tr>
                </thead>
                <tbody>
                  {displayOrders.map((order) => (
                    <tr
                      key={`${order.market}-${order.orderId}`}
                      className="border-b border-[#111111] hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-2 font-mono text-white/90 tabular-nums">{order.orderId}</td>
                      <td className="px-3 py-2 text-white/70">{order.market || '-'}</td>
                      <td className="px-3 py-2">
                        <span
                          className={[
                            'inline-block rounded px-1.5 py-0.5 text-[10px] font-medium',
                            order.isBuy
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400',
                          ].join(' ')}
                        >
                          {order.side}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white tabular-nums">
                        {formatNumber(order.priceFormatted, 4)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white/80 tabular-nums">
                        {formatNumber(order.amountFormatted, 4)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-white/60 tabular-nums">
                        {order.marginRequiredFormatted > 0
                          ? formatNumber(order.marginRequiredFormatted, 2)
                          : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-white/50" title={order.trader}>
                        {truncateAddress(order.trader)}
                      </td>
                      <td className="px-3 py-2 text-right text-white/50" title={order.timestampISO}>
                        {relativeTime(order.timestamp)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {order.isMarginOrder ? (
                          <span className="inline-block h-2 w-2 rounded-full bg-amber-400" title="Margin order" />
                        ) : (
                          <span className="inline-block h-2 w-2 rounded-full bg-[#333]" title="Spot order" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {data && data.orders.length === 0 && !error && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-8 text-center">
          <div className="text-[12px] text-white/60">No orders found on-chain for the given filters.</div>
          <div className="mt-1 text-[11px] text-[#808080]">
            Try increasing max order ID or checking a different market.
          </div>
        </div>
      )}

      {/* Raw API response */}
      {data && (
        <details className="rounded-md border border-[#222222] bg-[#0F0F0F]">
          <summary className="cursor-pointer px-4 py-3 text-[11px] text-white/60 hover:text-white/80">
            Full API Response ({data.elapsed_ms}ms)
          </summary>
          <pre className="overflow-auto border-t border-[#222222] p-4 text-[11px] text-white/70 max-h-[500px]">
            {JSON.stringify(data, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
