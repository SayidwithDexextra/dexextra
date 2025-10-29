'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  TokenHeader, 
  TradingPanel, 
  TokenStats, 
  TransactionTable,
  ThreadPanel,
  MarketActivityTabs
} from '@/components/TokenView';
import LightweightChart from '@/components/TokenView/LightweightChart';
// Removed smart contract hooks - functionality disabled
import { TokenData } from '@/types/token';
import NetworkSelector from '@/components/NetworkSelector';
import CountdownTicker from '@/components/CountdownTicker/CountdownTicker';
import LoadingScreen from '@/components/LoadingScreen';
import CryptoMarketTicker from '@/components/CryptoMarketTicker/CryptoMarketTicker';
import { MarketDataProvider, useMarketData } from '@/contexts/MarketDataContext';
// Removed contractDeployment import
// Removed useVAMMSettlement hook

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();

  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'long' || action === 'short') {
      setTradingAction(action);
      
      // Log mock USDC address when action is 'long'
      if (action === 'long') {
        console.log('🏦 Mock USDC Address:', '0x194b4517a61D569aC8DBC47a22ed6F665B77a331');
      }
    }
  }, [searchParams]);
  return (
    <MarketDataProvider symbol={symbol}>
      <TokenPageContent symbol={symbol} tradingAction={tradingAction} onSwitchNetwork={() => router.refresh()} />
    </MarketDataProvider>
  );
}

function TokenPageContent({ symbol, tradingAction, onSwitchNetwork }: { symbol: string; tradingAction: 'long' | 'short' | null; onSwitchNetwork: () => void; }) {
  const md = useMarketData();

  const tokenData = md.tokenData;
  // Prevent flicker: once we have initial data, keep rendering content even if background polling toggles isLoading
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  useEffect(() => {
    if (!hasLoadedOnce && !md.error && tokenData) {
      setHasLoadedOnce(true);
    }
  }, [hasLoadedOnce, md.error, tokenData]);
  const currentPrice = (md.markPrice ?? md.resolvedPrice) || 0;
  const markPrice = currentPrice;
  const fundingRate = 0;
  const priceChange24h = 0;
  const priceChangePercent24h = 0;
  const lastUpdated = md.lastUpdated || new Date().toISOString();

  const isNetworkError = !!(md.error && typeof (md.error as any) === 'string' && (
    (md.error as any).includes('Please switch your wallet to Polygon') ||
    (md.error as any).includes('This contract is deployed on Polygon Mainnet')
  ));

  const shouldShowLoading = useMemo(() => {
    // Only show the loading screen before the first successful data load
    if (!hasLoadedOnce) {
      if (md.isLoading) return true;
      if (!tokenData) return true;
    }
    return false;
  }, [hasLoadedOnce, md.isLoading, tokenData]);

  const loadingMessage = "Loading Trading Interface...";
  const loadingSubtitle = `Fetching ${symbol} market data, mark price, and available margin`;

  if (shouldShowLoading) {
    return (
      <LoadingScreen 
        message={loadingMessage}
        subtitle={loadingSubtitle}
      />
    );
  }

  if (md.error || !tokenData) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
          {isNetworkError ? (
            <>
              <div className="text-yellow-500 text-xl font-semibold">⚠️ Wrong Network</div>
              <div className="text-gray-300 text-sm mb-4">
                Please switch your wallet to Polygon to access this market.
              </div>
              <div className="bg-gray-900 p-6 rounded-xl border border-gray-700 w-full max-w-md">
                <div className="text-white text-lg font-medium mb-4">Switch to Polygon</div>
                <NetworkSelector compact={false} onNetworkChange={onSwitchNetwork} />
              </div>
              <div className="text-gray-500 text-xs">
                Error: {String(md.error)}
              </div>
            </>
          ) : (
            <>
              <div className="text-red-500 text-lg">Market Not Found</div>
              <div className="text-gray-400 text-sm">
                {String(md.error || `No market found for symbol: ${symbol}`)}
              </div>
              <div className="mt-4">
                <a 
                  href="/create-market" 
                  className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors"
                >
                  Create {symbol} Market
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white">
      <CryptoMarketTicker className="border-b border-gray-800" />
      <div className="px-1 pb-8 pt-2">
        <div className="flex md:hidden flex-col gap-1">
          <div className="w-full mt-1">
            <LightweightChart 
              symbol={symbol}
              height={399}
              defaultPrice={tokenData?.price || currentPrice || 100}
            />
          </div>
          <div className="w-full">
            <MarketActivityTabs symbol={symbol} />
          </div>
          <div className="w-full">
            <TradingPanel 
              tokenData={tokenData} 
              initialAction={tradingAction}
              marketData={{
                markPrice: Number(markPrice || 0),
                fundingRate: Number(fundingRate || 0),
                currentPrice: Number(currentPrice || 0),
                priceChange24h: Number(priceChange24h || 0),
                priceChangePercent24h: Number(priceChangePercent24h || 0),
                dataSource: 'contract',
                lastUpdated: String(lastUpdated || '')
              }}
            />
          </div>
        </div>

        <div className="hidden md:flex gap-1 mt-1" style={{ height: 'calc(100vh - 96px - 40px - 1rem - 1.5rem)' }}>
          <div className="flex-1 flex flex-col gap-0.5 h-full overflow-hidden">
            <div className="flex-shrink-0" style={{ height: '60%' }}>
              <LightweightChart 
                symbol={symbol}
                height="100%"
                defaultPrice={tokenData?.price || currentPrice || 100}
              />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <MarketActivityTabs symbol={symbol} className="h-full" />
            </div>
          </div>
          <div className="w-80 h-full">
            <TransactionTable 
              marketId={(md.market as any)?.id}
              marketIdentifier={(md.market as any)?.market_identifier || symbol}
              orderBookAddress={(md as any)?.orderBookAddress || (md.market as any)?.market_address || undefined}
              height="100%"
            />
          </div>
          <div className="w-80 flex flex-col gap-1 h-full">
            <div className="flex-shrink-0 max-h-80 overflow-hidden">
              <TokenHeader symbol={symbol} />
            </div>
            <div className="flex-1 min-h-0 overflow-hidden">
              <TradingPanel 
                tokenData={tokenData} 
                initialAction={tradingAction}
                marketData={{
                  markPrice: Number(markPrice || 0),
                  fundingRate: Number(fundingRate || 0),
                  currentPrice: Number(currentPrice || 0),
                  priceChange24h: Number(priceChange24h || 0),
                  priceChangePercent24h: Number(priceChangePercent24h || 0),
                  dataSource: 'contract',
                  lastUpdated: String(lastUpdated || '')
                }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}