'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { 
  TokenHeader, 
  TradingPanel, 
  TokenStats, 
  TransactionTable,
  ThreadPanel 
  
} from '@/components/TokenView';
import LightweightChart from '@/components/TokenView/LightweightChart';
import { useVAMMTokenData } from '@/hooks/useVAMMTokenData';
import { useUnifiedMarkPrice } from '@/hooks/useUnifiedMarkPrice';
import { useVAMMTrading } from '@/hooks/useVAMMTrading';
import { TokenData } from '@/types/token';
import NetworkSelector from '@/components/NetworkSelector';
import CountdownTicker from '@/components/CountdownTicker/CountdownTicker';
import LoadingScreen from '@/components/LoadingScreen';
import { DEFAULT_ADDRESSES } from '@/lib/contractDeployment';
import { useVAMMSettlement } from '@/hooks/useVAMMSettlement';

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  const { 
    tokenData: baseTokenData, 
    vammMarket, 
    isLoading, 
    error
    // Remove contractData since it's no longer available
  } = useVAMMTokenData(symbol);
  
  // Get settlement data from smart contract/market data
  const settlementData = useVAMMSettlement(vammMarket);
  
  // Debug settlement data (remove contract data debugging)
  useEffect(() => {
    if (settlementData && vammMarket) {
      console.log('🕒 Settlement Data Calculated:', {
        marketSymbol: symbol,
        createdAt: vammMarket.created_at,
        settlementPeriodDays: vammMarket.settlement_period_days,
        settlementDate: settlementData.settlementDate,
        daysUntilSettlement: settlementData.daysUntilSettlement,
        settlementPhase: settlementData.settlementPhase,
        isNearSettlement: settlementData.isNearSettlement
      });
    }
  }, [settlementData, vammMarket, symbol]);
  
  const launchDate = new Date();
  launchDate.setDate(launchDate.getDate() + 7);

  const handleLaunchComplete = () => {
     console.log('Launch countdown completed!');
     console.log('Launch Sale has started! 🚀');
  };

  const handleSettlementComplete = (marketSymbol?: string, settlementPhase?: string) => {
    console.log(`Settlement completed for ${marketSymbol}!`);
    console.log(`Settlement phase: ${settlementPhase}`);
    console.log('Market positions are now being settled based on final metric values 📊');
    
    // Here you could add additional settlement logic such as:
    // - Triggering smart contract settlement functions
    // - Refreshing position data
    // - Updating UI to show settlement results
    // - Sending analytics events
    
    if (vammMarket?.vamm_address) {
      console.log(`VAMM Address for settlement: ${vammMarket.vamm_address}`);
      // TODO: Integrate with actual settlement contract calls
    }
  };

  // Enhanced real-time price integration using unified price hook
  const { 
    currentPrice,
    markPrice, 
    fundingRate,
    priceChange24h,
    priceChangePercent24h,
    isLoading: isPriceLoading,
    error: priceError,
    dataSource,
    lastUpdated
  } = useUnifiedMarkPrice(vammMarket || undefined, {
    enablePolling: true,
    pollingInterval: 30000, // Poll every 30 seconds for real-time updates
    enableContractFetch: true
  });

  // Get trading data including collateral and position information
  const {
    collateralBalance,
    allowance,
    isLoading: isTradingLoading,
    error: tradingError
  } = useVAMMTrading();
  
  // Create enhanced token data with unified real-time price
  const tokenData = useMemo((): TokenData | null => {
    if (!baseTokenData || !vammMarket) return null;
    
    // Use unified price data only (no more fallback to contractData)
    let finalPrice = vammMarket.initial_price;
    let finalPriceChange = 0;
    let priceDataSource = 'initial';
    
    // Use contract data from unified hook only
    if (dataSource === 'contract' && currentPrice > 0) {
      finalPrice = currentPrice;
      finalPriceChange = priceChangePercent24h;
      priceDataSource = 'unified-contract';
    }
    
    console.log(`💰 Unified price data for ${symbol}:`, {
      dataSource: priceDataSource,
      finalPrice,
      finalPriceChange,
      unifiedDataSource: dataSource,
      currentPrice,
      markPrice,
      lastUpdated: new Date(lastUpdated).toISOString()
    });
    
    // Use estimated volume since we no longer have contract volume data
    const volume24h = baseTokenData.volume24h;
    
    return {
      ...baseTokenData,
      price: finalPrice,
      priceChange24h: finalPriceChange,
      volume24h,
      // Update market cap with real price
      marketCap: finalPrice * (baseTokenData.circulating_supply || 1000000),
      marketCapChange24h: finalPriceChange, // Approximate market cap change with price change
    };
  }, [baseTokenData, vammMarket, currentPrice, markPrice, priceChangePercent24h, dataSource, lastUpdated]);
  
  // Get the trading action from URL params (long/short)
  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);
  
  // Track whether initial loading has completed (to prevent re-loading)
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  
  // Track network errors
  const isNetworkError = error && (
    error.includes('Please switch your wallet to Polygon') || 
    error.includes('This contract is deployed on Polygon Mainnet')
  );

  useEffect(() => {
    const action = searchParams.get('action');
    if (action === 'long' || action === 'short') {
      setTradingAction(action);
      
      // Log mock USDC address when action is 'long'
      if (action === 'long') {
        console.log('🏦 Mock USDC Address:', DEFAULT_ADDRESSES.mockUSDC);
      }
    }
  }, [searchParams]);

  // Mark initial loading as complete once we have ALL essential data (including contract data)
  useEffect(() => {
    if (!hasInitiallyLoaded && 
        baseTokenData && 
        vammMarket && 
        !isLoading && 
        !isTradingLoading && 
        (markPrice) && // Either contract data OR pusher price
        collateralBalance !== undefined) {
       console.log('🎯 Initial load completed with all contract data:', {
        baseTokenData: !!baseTokenData,
        vammMarket: !!vammMarket,
        markPrice: markPrice,
        collateralBalance: collateralBalance,
        hasRealTimeData: !!(markPrice)
      });
      setHasInitiallyLoaded(true);
    }
  }, [hasInitiallyLoaded, baseTokenData, vammMarket, isLoading, isTradingLoading, markPrice, collateralBalance]);

  // Show loading screen only once during initial page load
  const shouldShowLoading = useMemo(() => {
    // Show loading if we're still fetching initial data
    if (isLoading || isTradingLoading) {
      return true;
    }
    
    // If we have an error, don't show loading
    if (error || tradingError) {
      return false;
    }
    
    // If we don't have essential data yet and no error, keep loading
    if (!baseTokenData || !vammMarket || !tokenData) {
      return true;
    }
    
    // All essential data is loaded
    return false;
  }, [isLoading, isTradingLoading, error, tradingError, baseTokenData, vammMarket]);

  // Enhanced loading message
  const loadingMessage = "Loading Trading Interface...";
  const loadingSubtitle = `Fetching ${symbol} market data, mark price, and available margin`;

  // Show loading screen during initial data fetch
  if (shouldShowLoading) {
    return (
      <LoadingScreen 
        message={loadingMessage}
        subtitle={loadingSubtitle}
      />
    );
  }

  // Only show error after loading is complete and we still don't have data
  if (error || tradingError || !tokenData || !vammMarket) {
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
                <NetworkSelector compact={false} onNetworkChange={() => router.refresh()} />
              </div>
              
              <div className="text-gray-500 text-xs">
                Error: {error}
              </div>
            </>
          ) : (
            /* Regular Market Not Found Error */
            <>
              <div className="text-red-500 text-lg">
                {tradingError ? 'Trading Data Error' : 'VAMM Market Not Found'}
              </div>
              <div className="text-gray-400 text-sm">
                {tradingError || error || `No VAMM market found for symbol: ${symbol}`}
              </div>
              {priceError && (
                <div className="text-yellow-500 text-xs">
                  Price data unavailable: {priceError}
                </div>
              )}
              {tradingError && (
                <div className="text-orange-500 text-xs mt-2">
                  Trading functionality may be limited until this is resolved.
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
    <div className="min-h-screen bg-black text-white px-1">
      {/* Mobile Layout - Single Column (TradingViewWidget + TradingPanel only) */}
      <div className="flex md:hidden flex-col gap-1">
        {/* Chart Component */}
        <div className="w-full mt-1">
          <LightweightChart 
            symbol={symbol}
            height={399}
            defaultPrice={tokenData?.price || 100}
          />
        </div>
        
        {/* Trading Panel */}
        <div className="w-full">
          <TradingPanel 
            tokenData={tokenData} 
            vammMarket={vammMarket} 
            initialAction={tradingAction}
            marketData={{
              markPrice: Number(markPrice || currentPrice || tokenData?.price || 0),
              fundingRate: Number(fundingRate || 0),
              currentPrice: Number(currentPrice || tokenData?.price || 0),
              priceChange24h: Number(priceChange24h || 0),
              priceChangePercent24h: Number(priceChangePercent24h || 0),
              dataSource: String(dataSource || 'static'),
              lastUpdated: String(lastUpdated || '')
            }}
          />
        </div>
      </div>

      {/* Desktop Layout - Multi-component flex layout */}
      <div className="hidden md:flex flex-col gap-1">
        
        {/* Main Row: Chart column + TokenHeader/TradingPanel Group */}
        <div className="flex gap-1 mt-1">
          {/* Left Column: Chart + ThreadPanel/TransactionTable */}
          <div className="flex-1 flex flex-col gap-1">
            {/* Chart Component */}
            <div>
              <LightweightChart 
                symbol={symbol}
                height={370}
                defaultPrice={tokenData?.price || 100}
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
            <TradingPanel 
              tokenData={tokenData} 
              vammMarket={vammMarket} 
              initialAction={tradingAction}
              marketData={{
                markPrice: Number(markPrice || currentPrice || tokenData?.price || 0),
                fundingRate: Number(fundingRate || 0),
                currentPrice: Number(currentPrice || tokenData?.price || 0),
                priceChange24h: Number(priceChange24h || 0),
                priceChangePercent24h: Number(priceChangePercent24h || 0),
                dataSource: String(dataSource || 'static'),
                lastUpdated: String(lastUpdated || '')
              }}
            />
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


      {settlementData ? (
        <CountdownTicker
          targetDate={settlementData.settlementDate}
          title="Settlement Date"
          subtitle={`Settlement in ${settlementData.daysUntilSettlement} days - The final date for contract resolution`}
          onComplete={handleLaunchComplete}
          onSettlementComplete={handleSettlementComplete}
          showBanner={true}
          settlementPhase={settlementData.settlementPhase}
          marketSymbol={symbol}
        />
      ) : (
        <CountdownTicker
          targetDate={launchDate}
          title="Settlement Date"
          subtitle="The date of the settlement of the contract"
          onComplete={handleLaunchComplete}
          showBanner={true}
        />
      )}


    </div>
  );
} 