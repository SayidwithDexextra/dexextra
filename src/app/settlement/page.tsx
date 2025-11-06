'use client';

import { useEffect, useMemo, useState } from 'react';
import { ethers } from 'ethers';
import { useMarkets } from '@/hooks/useMarkets';
import { initializeContracts } from '@/lib/contracts';
import { ensureHyperliquidWallet } from '@/lib/network';
import { ErrorModal, SuccessModal } from '@/components/StatusModals';

type SettleState = {
  marketId: string | null;
  priceInput: string;
  confirming: boolean;
  isSubmitting: boolean;
  txHash: string | null;
  error: string | null;
  success: string | null;
  isAnalyzing: boolean;
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
  });

  const selectedMarket = useMemo(() => markets.find(m => m.id === state.marketId) || null, [markets, state.marketId]);

  const closeModals = () => setState(prev => ({ ...prev, error: null, success: null }));

  const isReady = (settlementDate?: string) => {
    if (!settlementDate) return false;
    const ts = Date.parse(settlementDate);
    if (Number.isNaN(ts)) return false;
    return Date.now() >= ts;
  };

  const handleOpenSettle = (marketId: string) => {
    setState(prev => ({ ...prev, marketId, priceInput: '', confirming: false, txHash: null }));
  };

  const handleConfirmToggle = () => {
    setState(prev => ({ ...prev, confirming: !prev.confirming }));
  };

  const handleSettle = async () => {
    if (!selectedMarket) return;
    if (!selectedMarket.market_address) {
      setState(prev => ({ ...prev, error: 'Missing market address for this market.' }));
      return;
    }

    const price = (state.priceInput || '').trim();
    if (!price || Number(price) <= 0 || !Number.isFinite(Number(price))) {
      setState(prev => ({ ...prev, error: 'Enter a valid positive settlement price.' }));
      return;
    }

    try {
      setState(prev => ({ ...prev, isSubmitting: true, error: null, success: null, txHash: null }));

      const signer = await ensureHyperliquidWallet();
      const net = await signer.provider!.getNetwork();
      const connectedChainId = Number(net.chainId);

      if (selectedMarket.chain_id && connectedChainId !== Number(selectedMarket.chain_id)) {
        throw new Error(`Wrong network. Connect to chainId ${selectedMarket.chain_id}.`);
      }

      const contracts = await initializeContracts({
        providerOrSigner: signer,
        orderBookAddressOverride: selectedMarket.market_address,
        chainId: selectedMarket.chain_id,
        marketIdBytes32: (selectedMarket as any)?.market_id_bytes32 || undefined,
        marketIdentifier: selectedMarket.market_identifier,
        marketSymbol: selectedMarket.symbol,
      });

      const finalPrice6 = ethers.parseUnits(String(price), 6);
      const tx = await contracts.obSettlement.settleMarket(finalPrice6);
      const receipt = await tx.wait();

      setState(prev => ({ ...prev, txHash: tx.hash }));

      try {
        await fetch('/api/markets', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: selectedMarket.id,
            market_status: 'SETTLED',
            settlement_value: Number(price),
            settlement_timestamp: new Date().toISOString(),
            is_active: false,
          }),
        });
        await refetch();
      } catch {}

      setState(prev => ({
        ...prev,
        success: `Settlement executed. Tx: ${tx.hash.substring(0, 10)}…` ,
        isSubmitting: false,
        confirming: false,
      }));

    } catch (e: any) {
      setState(prev => ({
        ...prev,
        isSubmitting: false,
        error: e?.message || 'Settlement failed. Please try again.',
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

      const metric = selectedMarket.market_identifier || selectedMarket.symbol;
      const response = await fetch('/api/resolve-metric-fast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          metric,
          description: `Propose final settlement price for ${selectedMarket.symbol}`,
          urls
        })
      });
      if (!response.ok) {
        const j = await response.json().catch(() => ({} as any));
        throw new Error(j?.error || 'AI analysis failed');
      }
      const data = await response.json();
      const resolution = data?.data || {};
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
            <button
              onClick={() => handleOpenSettle(m.id)}
              disabled={!m.market_address || state.isSubmitting}
              className="text-xs text-red-400 hover:text-red-300 disabled:text-[#404040]"
              title={!m.market_address ? 'Missing market address' : 'Settle'}
            >
              Settle
            </button>
          </div>
        </div>
        <div className="opacity-0 group-hover:opacity-100 max-h-0 group-hover:max-h-20 overflow-hidden transition-all duration-200">
          <div className="px-2.5 pb-2 border-t border-[#1A1A1A]">
            <div className="text-[9px] pt-1.5">
              <span className="text-[#606060]">OB:</span>
              <span className="text-[10px] text-white font-mono ml-1">{m.market_address || '—'}</span>
            </div>
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
                {state.isSubmitting ? 'Settling…' : 'Execute Settlement'}
              </button>
            </div>
            <div className="mt-2 text-[9px] text-[#606060]">
              Network: <span className="text-white">{selectedMarket.network} (chainId {selectedMarket.chain_id})</span>
            </div>
          </div>
        </div>
      )}

      <ErrorModal isOpen={!!state.error} onClose={closeModals} title="Settlement Failed" message={state.error || ''} />
      <SuccessModal isOpen={!!state.success} onClose={closeModals} title="Settlement Complete" message={state.success || ''} />
    </div>
  );
}


