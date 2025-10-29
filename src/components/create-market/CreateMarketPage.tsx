'use client';

import { useState } from 'react';
import { ethers } from 'ethers';
import { CreateMarketForm } from './CreateMarketForm';
import type { MarketFormData } from '@/hooks/useCreateMarketForm';
import { useRouter } from 'next/navigation';

export const CreateMarketPage = () => {
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleCreateMarket = async (marketData: MarketFormData) => {
    setIsLoading(true);
    try {
      // 1) Build facet cut from server (uses env facet addresses + ABIs)
      const cutRes = await fetch('/api/orderbook/cut');
      if (!cutRes.ok) throw new Error('Failed to build facet cut');
      const { cut, initFacet } = await cutRes.json();
      // Normalize cut into tuple format [facetAddress, action, functionSelectors]
      const cutArg = (Array.isArray(cut) ? cut : []).map((c: any) => [
        c.facetAddress,
        typeof c.action === 'number' ? c.action : 0,
        c.functionSelectors,
      ]);

      // 2) Connect user's wallet
      // @ts-ignore
      if (!(globalThis as any).window?.ethereum) throw new Error('Wallet not found');
      // @ts-ignore
      const provider = new ethers.BrowserProvider((globalThis as any).window.ethereum);
      const signer = await provider.getSigner();

      // 3) Resolve factory address & ABI
      const factoryAddress =
        process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS ||
        (process.env as any).NEXT_PUBLIC_FUTURES_MARKET_FACTORY;
      if (!factoryAddress) throw new Error('Factory address not configured');
      const factoryAbi = (await import('@/../Dexetrav5/artifacts/src/FuturesMarketFactory.sol/FuturesMarketFactory.json')).default.abi;
      const factory = new ethers.Contract(factoryAddress, factoryAbi, signer);

      // 4) Params
      const symbol = marketData.symbol;
      const metricUrl = marketData.metricUrl;
      const settlementTs = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const startPrice6 = ethers.parseUnits(String(marketData.startPrice || '1'), 6);
      const dataSource = marketData.dataSource || 'User Provided';
      const tags = marketData.tags || [];
      const treasury = marketData.treasury;

      // 5) Create market
      const tx = await factory.createFuturesMarketDiamond(
        symbol,
        metricUrl,
        settlementTs,
        startPrice6,
        dataSource,
        tags,
        await signer.getAddress(),
        cutArg,
        initFacet,
        '0x'
      );
      const receipt = await tx.wait();

      // 6) Parse event
      let orderBook: string | null = null;
      let marketId: string | null = null;
      try {
        const iface = new ethers.Interface(factoryAbi);
        for (const log of receipt.logs || []) {
          try {
            const parsed = iface.parseLog(log);
            if (parsed?.name === 'FuturesMarketCreated') {
              orderBook = parsed.args?.orderBook as string;
              marketId = parsed.args?.marketId as string;
              break;
            }
          } catch {}
        }
      } catch {}
      if (!orderBook || !marketId) throw new Error('Could not parse created market');

      // 7) Server-admin role grant (required)
      {
        const resp = await fetch('/api/markets/grant-roles', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            orderBook,
            coreVault: process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || (process.env as any).NEXT_PUBLIC_CORE_VAULT_ADDRESS || null,
          }),
        });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({} as any));
          throw new Error(err?.error || 'Admin role grant failed');
        }
      }

      // 8) Save to Supabase via server API
      try {
        const network = await provider.getNetwork();
        await fetch('/api/markets/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            marketIdentifier: symbol,
            symbol,
            name: `${(symbol.split('-')[0] || symbol).toUpperCase()} Futures`,
            description: `OrderBook market for ${symbol}`,
            category: Array.isArray(tags) && tags.length ? tags[0] : 'CUSTOM',
            decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
            minimumOrderSize: Number(process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1),
            settlementDate: settlementTs,
            tradingEndDate: null,
            dataRequestWindowSeconds: Number(process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600),
            autoSettle: true,
            oracleProvider: null,
            initialOrder: { metricUrl, startPrice: String(marketData.startPrice), dataSource, tags },
            chainId: Number(network.chainId),
            networkName: String(process.env.NEXT_PUBLIC_NETWORK_NAME || ''),
            creatorWalletAddress: await signer.getAddress(),
            iconImageUrl: null,
            bannerImageUrl: null,
            supportingPhotoUrls: [],
            marketAddress: orderBook,
            marketIdBytes32: marketId,
            transactionHash: receipt?.hash || null,
            blockNumber: receipt?.blockNumber || null,
            gasUsed: receipt?.gasUsed?.toString?.() || null,
          }),
        });
      } catch {}

      router.push('/markets');
    } catch (error) {
      console.error('Error creating market:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="h-screen flex items-center bg-[#0F0F0F]">
      <div className="w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header Card */}
        <div className="group bg-[#0F0F0F] hover:bg-[#101010] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 mb-6">
          <div className="flex items-center justify-between p-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-green-400" />
                <h2 className="text-white text-lg font-medium truncate">Create New Market</h2>
              </div>
              <div className="mt-1 text-[11px] text-[#808080] truncate">
                Configure market parameters and resolve data sources with AI
              </div>
            </div>
          </div>
          <div className="h-px bg-gradient-to-r from-blue-500/40 via-transparent to-transparent" />
        </div>

        {/* Form */}
        <CreateMarketForm onSubmit={handleCreateMarket} isLoading={isLoading} />
      </div>
    </div>
  );
};