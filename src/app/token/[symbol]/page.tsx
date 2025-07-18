'use client';

import { use, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { 
  TokenHeader, 
  TradingPanel, 
  TokenStats, 
  TradingViewWidget,
  TransactionTable,
  ThreadPanel 
  
} from '@/components/TokenView';
import { useVAMMTokenData } from '@/hooks/useVAMMTokenData';
import { useVAMMPriceData } from '@/hooks/useVAMMPriceData';
import { TokenData } from '@/types/token';
import NetworkSelector from '@/components/NetworkSelector';

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const { tokenData: baseTokenData, vammMarket, isLoading, error } = useVAMMTokenData(symbol);
  
  // Get real-time price data with polling
  const { 
    markPrice, 
    isLoading: isPriceLoading,
    error: priceError 
  } = useVAMMPriceData(vammMarket || undefined, {
    enablePolling: !!vammMarket?.vamm_address,
    pollingInterval: 10000 // Poll every 10 seconds for TokenStats updates
  });
  
  // Create enhanced token data with real-time price
  const tokenData = useMemo((): TokenData | null => {
    if (!baseTokenData || !vammMarket) return null;
    
    // Use real-time mark price if available, fallback to initial price
    const currentPrice = (markPrice && !isPriceLoading && !priceError) 
      ? parseFloat(markPrice) || vammMarket.initial_price
      : vammMarket.initial_price;
    
    // Calculate 24h change based on current vs initial price
    const priceChange24h = vammMarket.initial_price > 0 
      ? ((currentPrice - vammMarket.initial_price) / vammMarket.initial_price) * 100
      : 0;
    
    return {
      ...baseTokenData,
      price: currentPrice,
      priceChange24h,
      // Update market cap with real price
      marketCap: currentPrice * (baseTokenData.circulating_supply || 1000000),
      marketCapChange24h: priceChange24h, // Approximate market cap change with price change
    };
  }, [baseTokenData, vammMarket, markPrice, isPriceLoading, priceError]);
  
  // Get the trading action from URL params (long/short)
  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);
  
  // Track network errors
  const isNetworkError = error && (
    error.includes('Please switch your wallet to Polygon') || 
    error.includes('This contract is deployed on Polygon Mainnet')
  );

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'long' || action === 'short') {
      setTradingAction(action);
    }
  }, [searchParams]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-pulse text-white text-lg">Loading VAMM Market...</div>
          <div className="text-gray-400 text-sm">Fetching {symbol} futures contract data</div>
          {isPriceLoading && (
            <div className="text-gray-500 text-xs">Loading real-time price...</div>
          )}
        </div>
      </div>
    );
  }

  if (error || !tokenData || !vammMarket) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-4">
        <div className="flex flex-col items-center gap-6 text-center max-w-2xl w-full">
          
          {/* Network Error Handling */}
          {isNetworkError ? (
            <>
              <div className="text-yellow-500 text-xl font-semibold">⚠️ Wrong Network</div>
              <div className="text-gray-300 text-sm mb-4">
                The VAMM contracts are deployed on <span className="text-purple-400 font-medium">Polygon Mainnet</span>. 
                Please switch your wallet to Polygon to access this market.
              </div>
              
              <div className="bg-gray-900 p-6 rounded-xl border border-gray-700 w-full max-w-md">
                <div className="text-white text-lg font-medium mb-4">Switch to Polygon</div>
                <NetworkSelector compact={false} onNetworkChange={() => window.location.reload()} />
              </div>
              
              <div className="text-gray-500 text-xs">
                Error: {error}
              </div>
            </>
          ) : (
            /* Regular Market Not Found Error */
            <>
              <div className="text-red-500 text-lg">VAMM Market Not Found</div>
              <div className="text-gray-400 text-sm">
                {error || `No VAMM market found for symbol: ${symbol}`}
              </div>
              {priceError && (
                <div className="text-yellow-500 text-xs">
                  Price data unavailable: {priceError}
                </div>
              )}
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
    <div className="min-h-screen bg-black text-white px-1 py-1">
      {/* Mobile Layout - Single Column (TradingViewWidget + TradingPanel only) */}
      <div className="flex md:hidden flex-col gap-1">
        {/* Chart Component */}
        <div className="w-full">
          <TradingViewWidget 
            symbol={`${symbol}`}
            height={400}
            theme="dark"
          />
        </div>
        
        {/* Trading Panel */}
        <div className="w-full">
          <TradingPanel tokenData={tokenData} vammMarket={vammMarket} initialAction={tradingAction} />
        </div>
      </div>

      {/* Desktop Layout - Multi-component flex layout */}
      <div className="hidden md:flex flex-col gap-1">
        
        {/* Main Row: Chart column + TokenHeader/TradingPanel Group */}
        <div className="flex gap-1">
          {/* Left Column: Chart + ThreadPanel/TransactionTable */}
          <div className="flex-1 flex flex-col gap-1">
            {/* Chart Component */}
            <div>
              <TradingViewWidget 
                symbol={`${symbol}`}
                height={400}
                theme="dark"
              />
            </div>
            
            {/* ThreadPanel + TransactionTable row */}
            <div className="flex gap-1">
              <div className="flex-[2]">
                <TransactionTable vammAddress={vammMarket?.vamm_address} />
              </div>
              <div className="flex-1">
                <ThreadPanel />
              </div>
            </div>
          </div>
          
          {/* Right Column: TokenHeader + TradingPanel Group - fixed width, vertically stacked */}
          <div className="w-80 flex flex-col gap-1">
            <TokenHeader symbol={symbol} />
            <TradingPanel tokenData={tokenData} vammMarket={vammMarket} initialAction={tradingAction} />
          </div>
        </div>
        
        {/* Bottom Row: Token Stats aligned with chart width */}
        
        <div className="flex justify-center">
          <div className="flex-1">
            <TokenStats tokenData={tokenData} />
          </div>
          <div className="w-80"></div> {/* Spacer to align with layout */}
        </div>
      </div>
    </div>
  );
} 