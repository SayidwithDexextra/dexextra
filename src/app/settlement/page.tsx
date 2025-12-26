'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMarkets } from '@/hooks/useMarkets';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';
import { getMetricAIWorkerBaseUrl } from '@/lib/metricAiWorker';

type SettleState = {
  marketId: string | null;
  priceInput: string;
  confirming: boolean;
  isSubmitting: boolean;
  txHash: string | null;
  error: string | null;
  success: string | null;
  isAnalyzing: boolean;
  waybackUrl?: string | null;
  waybackTs?: string | null;
};

export default function SettlementPage() {
  const { markets, isLoading, error, refetch } = useMarkets({ status: 'ACTIVE', limit: 100 });

  const [state, setState] = useState<SettleState>({
    marketId: null,
    priceInput: '',
    confirming: false,
    isSubmitting: false,
    txHash: null,
    error: null,
    success: null,
    isAnalyzing: false,
    waybackUrl: null,
    waybackTs: null,
  });

  const selectedMarket = useMemo(() => markets.find(m => m.id === state.marketId) || null, [markets, state.marketId]);

  const closeModals = () => setState(prev => ({ ...prev, error: null, success: null }));

  const isReady = (settlementDate?: string) => {
    if (!settlementDate) return false;
    const ts = Date.parse(settlementDate);
    if (Number.isNaN(ts)) return false;
    return Date.now() >= ts;
  };

  const isWindowActive = (m?: any) => {
    if (!m) return false;
    if (!m.proposed_settlement_value || !m.settlement_window_expires_at) return false;
    try {
      return new Date(m.settlement_window_expires_at).getTime() > Date.now();
    } catch {
      return false;
    }
  };

  const handleOpenSettle = (marketId: string) => {
    setState(prev => ({ ...prev, marketId, priceInput: '', confirming: false, txHash: null }));
  };

  const handleConfirmToggle = () => {
    setState(prev => ({ ...prev, confirming: !prev.confirming }));
  };

  const handleSettle = async () => {
    if (!selectedMarket) return;
    const price = (state.priceInput || '').trim();
    if (!price || Number(price) <= 0 || !Number.isFinite(Number(price))) {
      setState(prev => ({ ...prev, error: 'Enter a valid positive settlement price.' }));
      return;
    }

    try {
      setState(prev => ({ ...prev, isSubmitting: true, error: null, success: null, txHash: null }));

      // Start the 24h settlement window via API (no on-chain tx)
      const resp = await fetch('/api/settlements/propose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          market_id: selectedMarket.id,
          price: Number(price)
        })
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({} as any));
        throw new Error(j?.error || 'Failed to start settlement window');
      }
      const j = await resp.json();
      const updated = j?.market || null;

      // Best-effort: archive primary metric source via Wayback and capture URL
      let waybackUrl: string | null = null;
      let waybackTs: string | null = null;
      try {
        const metricUrl = (selectedMarket as any)?.initial_order?.metricUrl || (selectedMarket as any)?.initial_order?.metric_url || null;
        const aiSourceUrl = (selectedMarket as any)?.market_config?.ai_source_locator?.url || null;
        const primaryUrl = (typeof metricUrl === 'string' && metricUrl) || (typeof aiSourceUrl === 'string' && aiSourceUrl) || null;
        if (primaryUrl) {
          const arch = await fetch('/api/archives/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: primaryUrl, captureScreenshot: true, skipIfRecentlyArchived: true })
          });
          if (arch.ok) {
            const j = await arch.json().catch(() => ({} as any));
            if (j && j.success && j.waybackUrl) {
              waybackUrl = j.waybackUrl;
              waybackTs = j.timestamp || null;
              setState(prev => ({ ...prev, waybackUrl, waybackTs }));
            }
          }
        }
      } catch {}

      // Optionally persist the archive URL into market_config (without changing status)
      try {
        if (waybackUrl) {
          const mergedConfig = { ...((selectedMarket as any)?.market_config || {}), settlement_wayback_url: waybackUrl, settlement_wayback_timestamp: waybackTs };
          await fetch('/api/markets', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              id: selectedMarket.id,
              market_config: mergedConfig
            }),
          });
        }
        await refetch();
      } catch {}

      setState(prev => ({
        ...prev,
        success: `Settlement window started. ${updated?.settlement_window_expires_at ? `Expires ${new Date(updated.settlement_window_expires_at).toLocaleString()}` : ''}${waybackUrl ? `\nArchived snapshot: ${waybackUrl}` : ''}`,
        isSubmitting: false,
        confirming: false,
      }));

    } catch (e: any) {
      setState(prev => ({
        ...prev,
        isSubmitting: false,
        error: e?.message || 'Failed to start settlement window. Please try again.',
      }));
    }
  };

  const proposeSettlementPrice = async () => {
    if (!selectedMarket) return;
    try {
      const urls: string[] = [];
      const metricUrl = (selectedMarket as any)?.initial_order?.metricUrl || (selectedMarket as any)?.initial_order?.metric_url || null;
      const aiSourceUrl = (selectedMarket as any)?.market_config?.ai_source_locator?.url || null;
      if (metricUrl && typeof metricUrl === 'string') urls.push(metricUrl);
      if (aiSourceUrl && typeof aiSourceUrl === 'string' && !urls.includes(aiSourceUrl)) urls.push(aiSourceUrl);

      if (urls.length === 0) {
        setState(prev => ({ ...prev, error: 'No metric URL configured for this market.' }));
        return;
      }

      setState(prev => ({ ...prev, isAnalyzing: true, error: null }));

      // Fire-and-forget: Attempt to archive the primary URL during AI analysis (with light retries)
      try {
        const primaryUrl = (typeof metricUrl === 'string' && metricUrl) || (typeof aiSourceUrl === 'string' && aiSourceUrl) || null;
        if (primaryUrl) {
          (async () => {
            try {
              const attempt = async () => {
                const resp = await fetch('/api/archives/save', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ url: primaryUrl, captureScreenshot: false, skipIfRecentlyArchived: true })
                });
                const j = await resp.json().catch(() => ({} as any));
                return { ok: resp.ok && j?.success, data: j } as const;
              };

              for (let i = 0; i < 3; i++) {
                const res = await attempt();
                if (res.ok && res.data?.waybackUrl) {
                  setState(prev => ({ ...prev, waybackUrl: res.data.waybackUrl, waybackTs: res.data.timestamp || null }));
                  break;
                }
                // backoff: 3s, 5s
                await new Promise(r => setTimeout(r, i === 0 ? 3000 : 5000));
              }
            } catch {}
          })();
        }
      } catch {}

      const metric = selectedMarket.market_identifier || selectedMarket.symbol;
      // Use external worker with polling to avoid blocking
      let workerUrl = '';
      try {
        workerUrl = getMetricAIWorkerBaseUrl();
      } catch {
        workerUrl = '';
      }
      let resolution: any = null;
      if (workerUrl) {
        try {
          const resStart = await fetch(`${workerUrl}/api/metric-ai`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              metric,
              description: `Propose final settlement price for ${selectedMarket.symbol}`,
              urls,
              related_market_id: selectedMarket.id,
              context: 'settlement',
            }),
          });
          if (resStart.status !== 202) {
            const j = await resStart.json().catch(() => ({} as any));
            throw new Error(j?.error || 'Worker start failed');
          }
          const startJson = await resStart.json().catch(() => ({} as any));
          const jobId = String(startJson?.jobId || '');
          const startTs = Date.now();
          const timeoutMs = 15000;
          while (Date.now() - startTs < timeoutMs) {
            await new Promise(r => setTimeout(r, 1500));
            const resStatus = await fetch(`${workerUrl}/api/metric-ai?jobId=${encodeURIComponent(jobId)}`, { cache: 'no-store' });
            const st = await resStatus.json().catch(() => ({} as any));
            if (st?.status === 'completed' && st?.result) {
              resolution = st.result;
              break;
            }
            if (st?.status === 'failed') {
              break;
            }
          }
        } catch (e: any) {
          // fallback keeps resolution null
          console.warn('[settlement] worker analysis failed', e?.message || String(e));
        }
      }
      if (!resolution) {
        throw new Error('AI analysis did not return a result in time');
      }
      const suggestion = resolution?.asset_price_suggestion || resolution?.value;
      if (!suggestion || isNaN(Number(suggestion))) {
        throw new Error('AI did not return a valid price suggestion');
      }
      setState(prev => ({ ...prev, priceInput: String(suggestion), isAnalyzing: false }));
    } catch (e: any) {
      setState(prev => ({ ...prev, error: e?.message || 'Failed to propose price', isAnalyzing: false }));
    }
  };

  const MarketRow = (m: any) => {
    const ready = isReady(m.settlement_date);
    const windowActive = isWindowActive(m);
    const dateStr = m.settlement_date ? new Date(m.settlement_date).toLocaleString() : '—';
    return (
      <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="flex items-center justify-between p-2.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className={ready ? 'w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400' : 'w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]'} />
            <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
              <span className="text-[11px] font-medium text-[#808080] truncate">{m.symbol}</span>
              <span className="text-[10px] text-[#606060]">•</span>
              <span className="text-[10px] text-white font-mono truncate">{m.market_identifier}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded" title="Settlement Date">
              {dateStr}
            </div>
            {windowActive && (
              <div className="text-[10px] text-yellow-400 bg-[#1A1A1A] px-1.5 py-0.5 rounded" title="Settlement window active">
                Window Active
              </div>
            )}
            <button
              onClick={() => handleOpenSettle(m.id)}
              disabled={!m.market_address || state.isSubmitting || windowActive}
              className="text-xs text-red-400 hover:text-red-300 disabled:text-[#404040]"
              title={!m.market_address ? 'Missing market address' : (windowActive ? 'Window active' : 'Start 24h Window')}
            >
              {windowActive ? 'Window Active' : 'Start Window'}
            </button>
          </div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5">
              <span className="text-[#606060]">OB:</span>
              <span className="text-[10px] text-white font-mono ml-1">{m.market_address || '—'}</span>
            </div>
            <div className="text-[9px] pt-1.5">
              <span className="text-[#606060]">Archive:</span>
              {m?.market_config?.settlement_wayback_url ? (
                <a
                  href={m.market_config.settlement_wayback_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-blue-400 hover:text-blue-300 ml-1 truncate inline-block max-w-[80%] align-middle"
                  title={m.market_config.settlement_wayback_url}
                >
                  {m.market_config.settlement_wayback_url}
                </a>
              ) : (
                <span className="text-[10px] text-white font-mono ml-1">—</span>
              )}
            </div>
            {windowActive && m.settlement_window_expires_at && (
              <div className="text-[9px] pt-1.5">
                <span className="text-[#606060]">Window Expires:</span>
                <span className="text-[10px] text-white font-mono ml-1">
                  {new Date(m.settlement_window_expires_at).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  useEffect(() => {
    if (!selectedMarket) return;
  }, [selectedMarket]);

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Settlement</h4>
        <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">{markets.length}</div>
      </div>

      {isLoading && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-blue-400 animate-pulse" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">Loading…</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-1 bg-[#2A2A2A] rounded-full overflow-hidden">
                <div className="h-full bg-blue-400 animate-pulse" style={{ width: '60%' }} />
              </div>
              <div className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-pulse" />
            </div>
          </div>
        </div>
      )}

      {!isLoading && !error && markets.length === 0 && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-[#404040]" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
                <span className="text-[11px] font-medium text-[#808080]">No markets found</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {markets.map(m => (
          <MarketRow key={m.id} {...m} />
        ))}
      </div>

      {state.waybackUrl && (
        <div className="group bg-[#0F0F0F] rounded-md border border-[#222222] mt-2">
          <div className="p-2.5">
            <div className="text-[9px] text-[#606060]">Archived snapshot:</div>
            <a
              href={state.waybackUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-blue-400 hover:text-blue-300 break-all"
            >
              {state.waybackUrl}
            </a>
            {state.waybackTs && (
              <div className="text-[9px] text-[#606060] mt-0.5">Timestamp: <span className="text-white">{state.waybackTs}</span></div>
            )}
          </div>
        </div>
      )}

      {selectedMarket && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="flex items-center justify-between p-2.5">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
              <div className="flex items-center gap-1.5 min-w-0 flex-1 truncate">
                <span className="text-[11px] font-medium text-[#808080] truncate">Settle:</span>
                <span className="text-[10px] text-white font-mono truncate">{selectedMarket.symbol}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setState(prev => ({ ...prev, marketId: null, priceInput: '', confirming: false }))} className="text-xs text-[#606060] hover:text-[#9CA3AF]">Close</button>
            </div>
          </div>
          <div className="px-2.5 pb-3 border-t border-[#1A1A1A]">
            <div className="flex items-center gap-2">
              <input
                value={state.priceInput}
                onChange={e => setState(prev => ({ ...prev, priceInput: e.target.value }))}
                placeholder="Final price (USDC, 6d)"
                inputMode="decimal"
                className="bg-[#0F0F0F] text-white text-[10px] border border-[#222222] rounded px-2 py-1 outline-none focus:border-[#333333] min-w-[180px]"
              />
              <button
                onClick={proposeSettlementPrice}
                disabled={state.isAnalyzing || state.isSubmitting}
                className="text-xs text-blue-400 hover:text-blue-300 disabled:text-[#404040]"
              >
                {state.isAnalyzing ? 'Analyzing…' : 'AI Propose'}
              </button>
              <button
                onClick={handleConfirmToggle}
                className="text-xs text-red-400 hover:text-red-300"
              >
                {state.confirming ? 'Unconfirm' : 'Confirm'}
              </button>
              <button
                onClick={handleSettle}
                disabled={!state.confirming || state.isSubmitting}
                className="text-xs text-red-400 hover:text-red-300 disabled:text-[#404040]"
              >
                {state.isSubmitting ? 'Starting…' : 'Start 24h Window'}
              </button>
            </div>
            <div className="mt-2 text-[9px] text-[#606060]">
              Network: <span className="text-white">{selectedMarket.network} (chainId {selectedMarket.chain_id})</span>
            </div>
            <div className="mt-1 text-[9px] text-[#606060]">
              Archive:{' '}
              {(selectedMarket as any)?.market_config?.settlement_wayback_url ? (
                <a
                  href={(selectedMarket as any).market_config.settlement_wayback_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 break-all"
                >
                  {(selectedMarket as any).market_config.settlement_wayback_url}
                </a>
              ) : (
                <span className="text-white">—</span>
              )}
            </div>
            {isWindowActive(selectedMarket) && selectedMarket.settlement_window_expires_at && (
              <div className="mt-1 text-[9px] text-[#606060]">
                Window Expires:{' '}
                <span className="text-white">
                  {new Date(selectedMarket.settlement_window_expires_at as string).toLocaleString()}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      <ErrorModal isOpen={!!state.error} onClose={closeModals} title="Action Failed" message={state.error || ''} />
      <SuccessModal isOpen={!!state.success} onClose={closeModals} title="Window Started" message={state.success || ''} />
    </div>
  );
}


