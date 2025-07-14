'use client';

import { use, useEffect, useState } from 'react';
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

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const { tokenData, vammMarket, isLoading, error } = useVAMMTokenData(symbol);
  
  // Get the trading action from URL params (long/short)
  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);

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
        </div>
      </div>
    );
  }

  if (error || !tokenData || !vammMarket) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 text-center max-w-md">
          <div className="text-red-500 text-lg">VAMM Market Not Found</div>
          <div className="text-gray-400 text-sm">
            {error || `No VAMM market found for symbol: ${symbol}`}
          </div>
          <div className="mt-4">
            <a 
              href="/create-market" 
              className="bg-purple-600 hover:bg-purple-700 text-white px-6 py-2 rounded-lg transition-colors"
            >
              Create {symbol} Market
            </a>
          </div>
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