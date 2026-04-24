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
    txHash?: string;
    txHashes?: string[];
  }>;
  settlementPrice?: string;
  alreadySettled?: boolean;
  error?: string;
  txHash?: string;
}

interface StreamEvent {
  type: 'phase_start' | 'tx' | 'batch_tx' | 'phase_complete' | 'error' | 'complete' | 'info';
  phase?: string;
  txHash?: string;
  batchNum?: number;
  totalBatches?: number;
  gasUsed?: string;
  message?: string;
  data?: Record<string, unknown>;
}

interface LiveTransaction {
  phase: string;
  txHash: string;
  batchNum?: number;
  gasUsed?: string;
  timestamp: number;
}

const PHASE_NAMES: Record<number, string> = {
  0: 'Not Started',
  1: 'Cancelling Orders',
  2: 'Calculating Totals',
  3: 'Finalizing Haircut',
  4: 'Applying Settlements',
  5: 'Complete',
};

const PHASE_DISPLAY_NAMES: Record<string, string> = {
  dev_mode: 'Dev Mode',
  init: 'Initialize',
  regular: 'Regular Settlement',
  cancel_buy_orders: 'Cancel Buy Orders',
  cancel_sell_orders: 'Cancel Sell Orders',
  calculate_totals: 'Calculate Totals',
  finalize_haircut: 'Finalize Haircut',
  apply_settlements: 'Apply Settlements',
  complete: 'Complete',
};

const PHASE_COLORS: Record<string, string> = {
  dev_mode: 'text-purple-400',
  init: 'text-blue-400',
  regular: 'text-cyan-400',
  cancel_buy_orders: 'text-orange-400',
  cancel_sell_orders: 'text-orange-400',
  calculate_totals: 'text-yellow-400',
  finalize_haircut: 'text-pink-400',
  apply_settlements: 'text-green-400',
  complete: 'text-emerald-400',
};

export default function BatchSettlementPage() {
  const debugEnabled =
    process.env.NODE_ENV !== 'production' ||
    String(process.env.NEXT_PUBLIC_ENABLE_DEBUG_PAGES || '').toLowerCase() === 'true';

  const [markets, setMarkets] = React.useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = React.useState<Market | null>(null);
  const [status, setStatus] = React.useState<SettlementStatus | null>(null);
  const [result, setResult] = React.useState<SettlementResult | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [loadingStatus, setLoadingStatus] = React.useState(false);
  const [loadingMarkets, setLoadingMarkets] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  
  // Live streaming state
  const [currentPhase, setCurrentPhase] = React.useState<string | null>(null);
  const [liveTransactions, setLiveTransactions] = React.useState<LiveTransaction[]>([]);
  const [statusMessages, setStatusMessages] = React.useState<string[]>([]);
  const liveLogRef = React.useRef<HTMLDivElement>(null);
  
  // Config options
  const [finalPrice, setFinalPrice] = React.useState('');
  const [tryRegularFirst, setTryRegularFirst] = React.useState(false);
  const [resumeFromPhase, setResumeFromPhase] = React.useState(false);
  const [orderBatchSize, setOrderBatchSize] = React.useState(10);
  const [calcBatchSize, setCalcBatchSize] = React.useState(10);
  const [applyBatchSize, setApplyBatchSize] = React.useState(10);
  
  // Auto-scroll live log
  React.useEffect(() => {
    if (liveLogRef.current) {
      liveLogRef.current.scrollTop = liveLogRef.current.scrollHeight;
    }
  }, [liveTransactions, statusMessages]);

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
    if (!selectedMarket) return;
    
    setLoadingStatus(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/debug/batch-settle?marketAddress=${selectedMarket.market_address}`
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to fetch status');
      setStatus(data);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingStatus(false);
    }
  }, [selectedMarket]);

  const runBatchSettle = React.useCallback(async () => {
    if (!selectedMarket) return;
    
    setLoading(true);
    setError(null);
    setResult(null);
    setCurrentPhase(null);
    setLiveTransactions([]);
    setStatusMessages([]);
    
    try {
      const res = await fetch('/api/debug/batch-settle', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          marketAddress: selectedMarket.market_address,
          finalPrice: finalPrice || undefined,
          tryRegularFirst,
          resumeFromPhase,
          orderBatchSize,
          calcBatchSize,
          applyBatchSize,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Settlement failed');
      }

      // Handle streaming response
      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response stream');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const event: StreamEvent = JSON.parse(line.slice(6));
              
              switch (event.type) {
                case 'phase_start':
                  setCurrentPhase(event.phase || null);
                  setStatusMessages(prev => [...prev, `▶ ${PHASE_DISPLAY_NAMES[event.phase || ''] || event.phase}: ${event.message || 'Starting...'}`]);
                  break;
                  
                case 'tx':
                case 'batch_tx':
                  if (event.txHash && event.phase) {
                    setLiveTransactions(prev => [...prev, {
                      phase: event.phase!,
                      txHash: event.txHash!,
                      batchNum: event.batchNum,
                      gasUsed: event.gasUsed,
                      timestamp: Date.now(),
                    }]);
                  }
                  break;
                  
                case 'phase_complete':
                  setStatusMessages(prev => [...prev, `✓ ${PHASE_DISPLAY_NAMES[event.phase || ''] || event.phase} complete${event.totalBatches ? ` (${event.totalBatches} batches)` : ''}`]);
                  break;
                  
                case 'info':
                  setStatusMessages(prev => [...prev, `ℹ ${event.message}`]);
                  break;
                  
                case 'error':
                  setError(event.message || 'Unknown error');
                  setStatusMessages(prev => [...prev, `✗ Error: ${event.message}`]);
                  break;
                  
                case 'complete':
                  setCurrentPhase(null);
                  if (event.data) {
                    setResult(event.data as unknown as SettlementResult);
                  }
                  setStatusMessages(prev => [...prev, `🎉 ${event.message || 'Settlement complete'}`]);
                  fetchStatus();
                  break;
              }
            } catch {
              // Ignore parse errors for incomplete events
            }
          }
        }
      }
    } catch (e: any) {
      setError(e.message);
      setStatusMessages(prev => [...prev, `✗ Error: ${e.message}`]);
    } finally {
      setLoading(false);
      setCurrentPhase(null);
    }
  }, [selectedMarket, finalPrice, tryRegularFirst, resumeFromPhase, orderBatchSize, calcBatchSize, applyBatchSize, fetchStatus]);

  React.useEffect(() => {
    fetchMarkets();
  }, [fetchMarkets]);

  React.useEffect(() => {
    if (selectedMarket) {
      fetchStatus();
    }
  }, [selectedMarket, fetchStatus]);

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
      {selectedMarket && (
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
                <div className={`mt-2 p-2 rounded border ${status.batchProgress.currentPhase > 0 ? 'bg-orange-500/10 border-orange-500/30' : 'bg-[#111] border-[#222]'}`}>
                  <div className="flex items-center justify-between mb-1">
                    <div className="text-[10px] text-[#666]">Batch Progress</div>
                    {status.batchProgress.currentPhase > 0 && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-300 font-medium">
                        IN PROGRESS
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div>
                      <span className="text-[#9CA3AF]">Phase:</span>{' '}
                      <span className={status.batchProgress.currentPhase > 0 ? 'text-orange-300' : 'text-white'}>
                        {PHASE_NAMES[status.batchProgress.currentPhase] || status.batchProgress.currentPhase}
                      </span>
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
                  {status.batchProgress.currentPhase > 0 && (
                    <div className="mt-2 text-[10px] text-orange-200/70">
                      A batch is already in progress. Enable &quot;Resume from existing batch&quot; to continue.
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : loadingStatus ? (
            <div className="text-[11px] text-[#666]">Loading status...</div>
          ) : null}
        </div>
      )}

      {/* Configuration */}
      {selectedMarket && !status?.isSettled && (
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

            <label className="flex items-center gap-2 col-span-2">
              <input
                type="checkbox"
                checked={resumeFromPhase}
                onChange={(e) => setResumeFromPhase(e.target.checked)}
                className="accent-orange-500"
              />
              <span className="text-[11px] text-orange-300">Resume from existing batch (if one is in progress)</span>
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
      {selectedMarket && !status?.isSettled && (
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

      {/* Live Transaction Log */}
      {(loading || liveTransactions.length > 0 || statusMessages.length > 0) && (
        <div className="rounded-md border border-[#222222] bg-[#0a0a0a] p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div className="text-[12px] font-medium text-white">Live Transaction Log</div>
              {loading && currentPhase && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full bg-[#111] border border-[#333] ${PHASE_COLORS[currentPhase] || 'text-white'}`}>
                  {PHASE_DISPLAY_NAMES[currentPhase] || currentPhase}
                </span>
              )}
            </div>
            {loading && (
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] text-green-400">Streaming</span>
              </div>
            )}
          </div>

          {/* Status Messages */}
          {statusMessages.length > 0 && (
            <div className="mb-3 p-2 rounded bg-[#0f0f0f] border border-[#1a1a1a] max-h-32 overflow-y-auto">
              {statusMessages.map((msg, i) => (
                <div key={i} className="text-[10px] text-[#9CA3AF] font-mono py-0.5">
                  {msg}
                </div>
              ))}
            </div>
          )}

          {/* Transaction Feed */}
          <div 
            ref={liveLogRef}
            className="space-y-1 max-h-64 overflow-y-auto pr-2"
            style={{ scrollbarWidth: 'thin', scrollbarColor: '#333 #0a0a0a' }}
          >
            {liveTransactions.length === 0 && loading && (
              <div className="text-[11px] text-[#666] text-center py-4">
                Waiting for transactions...
              </div>
            )}
            {liveTransactions.map((tx, i) => (
              <div 
                key={`${tx.txHash}-${i}`} 
                className="flex items-center gap-2 py-1 px-2 rounded bg-[#111] border border-[#1a1a1a] group hover:bg-[#161616] transition-colors"
              >
                <span className={`text-[10px] font-medium min-w-[80px] ${PHASE_COLORS[tx.phase] || 'text-white'}`}>
                  {tx.batchNum !== undefined ? `Batch ${tx.batchNum}` : PHASE_DISPLAY_NAMES[tx.phase] || tx.phase}
                </span>
                <a 
                  href={`https://explorer.hyperliquid.xyz/tx/${tx.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] font-mono text-blue-400 hover:text-blue-300 hover:underline flex-1 truncate"
                >
                  {tx.txHash}
                </a>
                {tx.gasUsed && (
                  <span className="text-[9px] text-[#666] opacity-0 group-hover:opacity-100 transition-opacity">
                    {Number(tx.gasUsed).toLocaleString()} gas
                  </span>
                )}
                <span className="text-[9px] text-[#444]">
                  {new Date(tx.timestamp).toLocaleTimeString()}
                </span>
              </div>
            ))}
          </div>

          {/* Summary */}
          {liveTransactions.length > 0 && (
            <div className="mt-3 pt-3 border-t border-[#1a1a1a] flex items-center justify-between text-[10px] text-[#666]">
              <span>{liveTransactions.length} transaction{liveTransactions.length !== 1 ? 's' : ''}</span>
              <span>
                Total gas: {liveTransactions.reduce((sum, tx) => sum + (parseInt(tx.gasUsed || '0', 10) || 0), 0).toLocaleString()}
              </span>
            </div>
          )}
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

          {result.txHash && (
            <div className="text-[11px]">
              <span className="text-[#9CA3AF]">Transaction:</span>{' '}
              <a 
                href={`https://explorer.hyperliquid.xyz/tx/${result.txHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:underline font-mono"
              >
                {result.txHash.substring(0, 10)}...{result.txHash.substring(result.txHash.length - 8)}
              </a>
            </div>
          )}

          {result.phases && result.phases.length > 0 && (
            <div className="mt-3">
              <div className="text-[10px] text-[#666] mb-1">Phases</div>
              <div className="space-y-2">
                {result.phases.map((p, i) => (
                  <div key={i} className="p-2 rounded bg-[#0a0a0a] border border-[#1a1a1a]">
                    <div className="flex items-center gap-2 text-[11px]">
                      <span className={p.success ? 'text-green-400' : 'text-red-400'}>
                        {p.success ? '✓' : '✗'}
                      </span>
                      <span className="text-white font-medium">{p.phase}</span>
                      {p.batches !== undefined && (
                        <span className="text-[#666]">({p.batches} batch{p.batches !== 1 ? 'es' : ''})</span>
                      )}
                    </div>
                    {p.error && (
                      <div className="mt-1 text-red-300 text-[10px]">{p.error}</div>
                    )}
                    {p.txHash && (
                      <div className="mt-1 text-[10px]">
                        <span className="text-[#666]">tx: </span>
                        <a 
                          href={`https://explorer.hyperliquid.xyz/tx/${p.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:underline font-mono"
                        >
                          {p.txHash.substring(0, 10)}...{p.txHash.substring(p.txHash.length - 8)}
                        </a>
                      </div>
                    )}
                    {p.txHashes && p.txHashes.length > 0 && (
                      <div className="mt-1 text-[10px]">
                        <span className="text-[#666]">txs: </span>
                        <div className="mt-0.5 flex flex-wrap gap-1">
                          {p.txHashes.map((hash, j) => (
                            <a 
                              key={j}
                              href={`https://explorer.hyperliquid.xyz/tx/${hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-400 hover:underline font-mono px-1 py-0.5 bg-[#111] rounded"
                            >
                              {j + 1}: {hash.substring(0, 8)}...
                            </a>
                          ))}
                        </div>
                      </div>
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
