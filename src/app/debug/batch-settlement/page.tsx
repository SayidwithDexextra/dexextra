'use client';
import React from 'react';

interface Market {
  id: string;
  name: string;
  market_address: string;
  market_status: string;
}

interface SettlementStatus {
  marketAddress: string;
  isSettled: boolean;
  batchProgress: {
    buyOrdersRemaining: string;
    sellOrdersRemaining: string;
    currentPhase: number;
    cursor: string;
    total: string;
  } | null;
  proposedPrice: {
    price: string;
    proposer: string;
  } | null;
  devModeEnabled: boolean;
}

interface SettlementResult {
  success: boolean;
  method?: string;
  message?: string;
  totalTransactions?: number;
  totalGasUsed?: string;
  phases?: Array<{
    phase: string;
    success: boolean;
    batches?: number;
    gasUsed?: string;
    error?: string;
  }>;
  settlementPrice?: string;
  alreadySettled?: boolean;
  error?: string;
}

const PHASE_NAMES: Record<number, string> = {
  0: 'Not Started',
  1: 'Cancelling Orders',
  2: 'Calculating Totals',
  3: 'Finalizing Haircut',
  4: 'Applying Settlements',
  5: 'Complete',
};

export default function BatchSettlementPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [adminSecret, setAdminSecret] = React.useState('');
  const [markets, setMarkets] = React.useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = React.useState<Market | null>(null);
  const [status, setStatus] = React.useState<SettlementStatus | null>(null);
  const [result, setResult] = React.useState<SettlementResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState(false);
  const [loadingMarkets, setLoadingMarkets] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  
  // Config options
  const [finalPrice, setFinalPrice] = React.useState('');
  const [tryRegularFirst, setTryRegularFirst] = React.useState(false);
  const [orderBatchSize, setOrderBatchSize] = React.useState(10);
  const [calcBatchSize, setCalcBatchSize] = React.useState(10);
  const [applyBatchSize, setApplyBatchSize] = React.useState(10);

  const fetchMarkets = React.useCallback(async () => {
    setLoadingMarkets(true);
    setError(null);
    try {
      const res = await fetch('/api/markets');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch markets');
      
      const activeMarkets = (data.markets || []).filter(
        (m: Market) => m.market_address && m.market_status === 'ACTIVE'
      );
      setMarkets(activeMarkets);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMarkets(false);
    }
  }, []);

  const fetchStatus = React.useCallback(async () => {
    if (!selectedMarket || !adminSecret) return;
    
    setLoadingStatus(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/debug/batch-settle?marketAddress=${selectedMarket.market_address}`,
        { headers: { 'x-admin-secret': adminSecret } }
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch status');
      setStatus(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingStatus(false);
    }
  }, [selectedMarket, adminSecret]);

  const runBatchSettle = React.useCallback(async () => {
    if (!selectedMarket || !adminSecret) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch('/api/debug/batch-settle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-secret': adminSecret,
        },
        body: JSON.stringify({
          marketAddress: selectedMarket.market_address,
          finalPrice: finalPrice || undefined,
          tryRegularFirst,
          orderBatchSize,
          calcBatchSize,
          applyBatchSize,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Settlement failed');
      setResult(data);
      fetchStatus();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [selectedMarket, adminSecret, finalPrice, tryRegularFirst, orderBatchSize, calcBatchSize, applyBatchSize, fetchStatus]);

  React.useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  React.useEffect(() => {
    if (selectedMarket && adminSecret) {
      fetchStatus();
    }
  }, [selectedMarket, adminSecret, fetchStatus]);

  if (!debugEnabled) {
    return (
      <div className="mx-auto max-w-3xl p-4">
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white">Debug pages disabled</div>
          <div className="mt-1 text-[11px] text-[#9CA3AF]">
            Set <span className="font-mono text-white/80">NEXT_PUBLIC_ENABLE_DEBUG_PAGES=true</span> to enable.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl p-4 space-y-4">
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-[14px] font-medium text-white">Batch Settlement</div>
            <div className="mt-1 text-[11px] text-[#9CA3AF]">
              One-click batch settlement for large markets that exceed gas limits.
            </div>
          </div>
          <a
            href="/debug"
            className="rounded border border-[#333333] bg-[#141414] px-3 py-2 text-[11px] text-white hover:bg-[#1A1A1A]"
          >
            Back to Debug
          </a>
        </div>
      </div>

      {/* Admin Secret */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <label className="block">
          <div className="text-[10px] text-[#808080] mb-1">Admin Secret (CRON_SECRET)</div>
          <input
            type="password"
            className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
            value={adminSecret}
            onChange={(e) => setAdminSecret(e.target.value)}
            placeholder="Enter admin secret..."
          />
        </label>
      </div>

      {/* Market Selection */}
      <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="text-[12px] font-medium text-white">Select Market</div>
          <button
            onClick={fetchMarkets}
            disabled={loadingMarkets}
            className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A] disabled:opacity-50"
          >
            {loadingMarkets ? 'Loading...' : 'Refresh'}
          </button>
        </div>

        <select
          className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
          value={selectedMarket?.id || ''}
          onChange={(e) => {
            const market = markets.find((m) => m.id === e.target.value);
            setSelectedMarket(market || null);
            setStatus(null);
            setResult(null);
          }}
        >
          <option value="">Select a market...</option>
          {markets.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name} - {m.market_address?.substring(0, 10)}...
            </option>
          ))}
        </select>

        {selectedMarket && (
          <div className="mt-2 text-[11px] text-[#9CA3AF] font-mono">
            {selectedMarket.market_address}
          </div>
        )}
      </div>

      {/* Status */}
      {selectedMarket && adminSecret && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="text-[12px] font-medium text-white">Market Status</div>
            <button
              onClick={fetchStatus}
              disabled={loadingStatus}
              className="rounded border border-[#333333] bg-[#141414] px-3 py-1.5 text-[11px] text-white hover:bg-[#1A1A1A] disabled:opacity-50"
            >
              {loadingStatus ? 'Loading...' : 'Refresh'}
            </button>
          </div>

          {status ? (
            <div className="space-y-2 text-[11px]">
              <div className="flex items-center gap-2">
                <span className="text-[#9CA3AF]">Settled:</span>
                <span className={status.isSettled ? 'text-green-400' : 'text-yellow-400'}>
                  {status.isSettled ? 'Yes' : 'No'}
                </span>
              </div>

              <div className="flex items-center gap-2">
                <span className="text-[#9CA3AF]">Dev Mode:</span>
                <span className={status.devModeEnabled ? 'text-green-400' : 'text-yellow-400'}>
                  {status.devModeEnabled ? 'Enabled' : 'Disabled'}
                </span>
                {!status.devModeEnabled && (
                  <span className="text-[10px] text-[#666]">(will be enabled on settlement)</span>
                )}
              </div>
              
              {status.proposedPrice && (
                <div className="flex items-center gap-2">
                  <span className="text-[#9CA3AF]">Proposed Price:</span>
                  <span className="text-white">${status.proposedPrice.price}</span>
                  <span className="text-[#666] text-[10px]">by {status.proposedPrice.proposer.substring(0, 10)}...</span>
                </div>
              )}

              {status.batchProgress && (
                <div className="mt-2 p-2 rounded bg-[#111] border border-[#222]">
                  <div className="text-[10px] text-[#666] mb-1">Batch Progress</div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[#9CA3AF]">Phase:</span>{' '}
                      <span className="text-white">{PHASE_NAMES[status.batchProgress.currentPhase] || status.batchProgress.currentPhase}</span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Progress:</span>{' '}
                      <span className="text-white">{status.batchProgress.cursor}/{status.batchProgress.total}</span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Buy Orders Left:</span>{' '}
                      <span className="text-white">{status.batchProgress.buyOrdersRemaining}</span>
                    </div>
                    <div>
                      <span className="text-[#9CA3AF]">Sell Orders Left:</span>{' '}
                      <span className="text-white">{status.batchProgress.sellOrdersRemaining}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : loadingStatus ? (
            <div className="text-[11px] text-[#666]">Loading status...</div>
          ) : null}
        </div>
      )}

      {/* Configuration */}
      {selectedMarket && adminSecret && !status?.isSettled && (
        <div className="rounded-md border border-[#222222] bg-[#0F0F0F] p-4">
          <div className="text-[12px] font-medium text-white mb-3">Settlement Configuration</div>
          
          <div className="grid grid-cols-2 gap-3">
            <label className="block col-span-2">
              <div className="text-[10px] text-[#808080] mb-1">
                Final Price (leave empty to use proposed price)
              </div>
              <input
                type="text"
                className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
                value={finalPrice}
                onChange={(e) => setFinalPrice(e.target.value)}
                placeholder={status?.proposedPrice?.price || 'e.g., 1.5000'}
              />
            </label>

            <label className="flex items-center gap-2 col-span-2">
              <input
                type="checkbox"
                checked={tryRegularFirst}
                onChange={(e) => setTryRegularFirst(e.target.checked)}
              />
              <span className="text-[11px] text-[#9CA3AF]">Try regular settlement first (faster if market is small)</span>
            </label>

            <label className="block">
              <div className="text-[10px] text-[#808080] mb-1">Order Batch Size</div>
              <input
                type="number"
                className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
                value={orderBatchSize}
                onChange={(e) => setOrderBatchSize(Number(e.target.value) || 100)}
              />
            </label>

            <label className="block">
              <div className="text-[10px] text-[#808080] mb-1">Calc Batch Size</div>
              <input
                type="number"
                className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
                value={calcBatchSize}
                onChange={(e) => setCalcBatchSize(Number(e.target.value) || 50)}
              />
            </label>

            <label className="block">
              <div className="text-[10px] text-[#808080] mb-1">Apply Batch Size</div>
              <input
                type="number"
                className="w-full rounded border border-[#222222] bg-[#111111] px-3 py-2 text-[12px] text-white"
                value={applyBatchSize}
                onChange={(e) => setApplyBatchSize(Number(e.target.value) || 50)}
              />
            </label>
          </div>
        </div>
      )}

      {/* Action Button */}
      {selectedMarket && adminSecret && !status?.isSettled && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 p-4">
          <div className="text-[12px] font-medium text-orange-300 mb-2">Execute Settlement</div>
          <div className="text-[11px] text-orange-200/70 mb-3">
            This will execute settlement on mainnet. The operation cannot be undone.
          </div>
          <button
            onClick={runBatchSettle}
            disabled={loading}
            className="w-full rounded bg-orange-500 px-4 py-3 text-[13px] font-medium text-white hover:bg-orange-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? 'Settling...' : 'Execute Batch Settlement'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-md border border-red-500/30 bg-red-500/10 p-4">
          <div className="text-[12px] font-medium text-red-300">Error</div>
          <div className="mt-1 text-[11px] text-red-200/80">{error}</div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`rounded-md border p-4 ${
          result.success 
            ? 'border-green-500/30 bg-green-500/10' 
            : 'border-red-500/30 bg-red-500/10'
        }`}>
          <div className={`text-[12px] font-medium ${result.success ? 'text-green-300' : 'text-red-300'}`}>
            {result.success ? 'Settlement Complete' : 'Settlement Failed'}
          </div>
          
          {result.message && (
            <div className="mt-1 text-[11px] text-white/80">{result.message}</div>
          )}

          {result.method && (
            <div className="mt-2 text-[11px]">
              <span className="text-[#9CA3AF]">Method:</span>{' '}
              <span className="text-white capitalize">{result.method}</span>
            </div>
          )}

          {result.settlementPrice && (
            <div className="text-[11px]">
              <span className="text-[#9CA3AF]">Settlement Price:</span>{' '}
              <span className="text-white">${result.settlementPrice}</span>
            </div>
          )}

          {result.totalTransactions !== undefined && (
            <div className="text-[11px]">
              <span className="text-[#9CA3AF]">Total Transactions:</span>{' '}
              <span className="text-white">{result.totalTransactions}</span>
            </div>
          )}

          {result.totalGasUsed && (
            <div className="text-[11px]">
              <span className="text-[#9CA3AF]">Total Gas Used:</span>{' '}
              <span className="text-white">{Number(result.totalGasUsed).toLocaleString()}</span>
            </div>
          )}

          {result.phases && result.phases.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-[#666] mb-1">Phases</div>
              <div className="space-y-1">
                {result.phases.map((p, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <span className={p.success ? 'text-green-400' : 'text-red-400'}>
                      {p.success ? '✓' : '✗'}
                    </span>
                    <span className="text-white">{p.phase}</span>
                    {p.batches !== undefined && (
                      <span className="text-[#666]">({p.batches} batches)</span>
                    )}
                    {p.error && (
                      <span className="text-red-300 text-[10px]">{p.error}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
