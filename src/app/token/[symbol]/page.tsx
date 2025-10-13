'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ethers } from 'ethers';
import { 
  TokenHeader, 
  TradingPanel, 
  TokenStats, 
  TransactionTable,
  ThreadPanel 
  
} from '@/components/TokenView';
import LightweightChart from '@/components/TokenView/LightweightChart';
// Removed smart contract hooks - functionality disabled
import { TokenData } from '@/types/token';
import { useOrderbookMarket } from '@/hooks/useOrderbookMarket';
import { useTokenFromMarket, useVAMMFromMarket } from '@/hooks/useTokenFromMarket';
import { useOrderbookMarketStats } from '@/hooks/useOrderbookMarketStats';
import NetworkSelector from '@/components/NetworkSelector';
import CountdownTicker from '@/components/CountdownTicker/CountdownTicker';
import LoadingScreen from '@/components/LoadingScreen';
import CryptoMarketTicker from '@/components/CryptoMarketTicker/CryptoMarketTicker';
// Removed contractDeployment import
// Removed useVAMMSettlement hook

interface TokenPageProps {
  params: Promise<{ symbol: string }>;
}

export default function TokenPage({ params }: TokenPageProps) {
  const { symbol } = use(params);
  const searchParams = useSearchParams();
  const router = useRouter();
  
  // Fetch real orderbook market data
  const { 
    marketData, 
    isLoading: isLoadingMarket, 
    error: marketError 
  } = useOrderbookMarket(symbol);
  
  // Transform orderbook market to compatible formats
  const baseTokenData = useTokenFromMarket(marketData?.market || null);
  const vammMarket = useVAMMFromMarket(marketData?.market || null);
  
  const isLoading = isLoadingMarket;
  const error = marketError;
  const settlementData = null;
  
  // Debug settlement data (remove contract data debugging)
  useEffect(() => {
    if (settlementData && vammMarket) {
      console.log('🕒 Settlement Data Calculated:', {
        marketSymbol: symbol,
        createdAt: vammMarket.created_at,
        settlementPeriodDays: vammMarket.settlement_period_days,
        // Settlement data properties would be available when real settlement data is implemented
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

  // Debug market data before calling stats hook
  useEffect(() => {
    if (marketData?.market) {
      console.log(`🏪 Debug TokenPage market data for ${symbol}:`, {
        metric_id: marketData.market.metric_id,
        market_address: marketData.market.market_address,
        market_status: marketData.market.market_status,
        chain_id: marketData.market.chain_id,
        hasValidAddress: marketData.market.market_address ? ethers.isAddress(marketData.market.market_address) : false
      });
    } else {
      console.log(`🏪 Debug TokenPage: No market data for ${symbol}`);
    }
  }, [marketData, symbol]);

  // Enhanced real-time price integration using OrderBook market data (on-chain only)
  const { marketData: stats, dataSource } = useOrderbookMarketStats(
    marketData?.market?.market_address,
    marketData?.market?.chain_id || 137,
    undefined,
    { autoRefresh: true, refreshInterval: 60000 }
  );

  // Enhanced price resolution with priority for real-time market activity
  const getResolvedPrice = () => {
    // PRIORITY ORDER FOR DISPLAY PRICE:
    // 1. Current active bid/ask spread (real market activity)
    // 2. Contract lastPrice ONLY if recent and meaningful
    // 3. Market tick_size (base price for new markets)
    // 4. Default fallback
    
    // FIRST: Use real-time order book data if available
    if (stats?.bestBid && stats.bestAsk && stats.bestBid > 0 && stats.bestAsk > 0) {
      return (stats.bestBid + stats.bestAsk) / 2;
    }
    
    // SECOND: Use smart contract lastPrice ONLY if it represents recent trading activity
    // Note: lastPrice can be stale from old trades, so we need to be careful
    if (stats?.lastPrice && stats.lastPrice > 0) {
      // TODO: Add timestamp check here to ensure lastPrice is recent
      // For now, we'll use it but consider it lower priority than order book
      return stats.lastPrice;
    }
    
    // THIRD: Use market tick_size as the base price for new markets
    if (marketData?.market?.tick_size && marketData.market.tick_size > 0) {
      return marketData.market.tick_size;
    }
    
    // FOURTH: Database fallback
    if (baseTokenData?.price && baseTokenData.price > 0) {
      return baseTokenData.price;
    }
    
    // Default fallback for completely new markets
    return 1.0;
  };

  const currentPrice = getResolvedPrice();
  const markPrice = currentPrice;
  
  // Debug logging for price resolution
  console.log(`💰 Price resolution for ${symbol}:`, {
    resolvedPrice: currentPrice,
    sources: {
      contractBestBid: stats?.bestBid,
      contractBestAsk: stats?.bestAsk,
      contractLastPrice: stats?.lastPrice,
      marketTickSize: marketData?.market?.tick_size,
      baseTokenPrice: baseTokenData?.price
    },
    priceSource: {
      usingBidAsk: !!(stats?.bestBid && stats?.bestAsk && stats.bestBid > 0 && stats.bestAsk > 0),
      usingLastPrice: !!(stats?.lastPrice && stats.lastPrice > 0 && !stats?.bestBid),
      usingTickSize: !!(marketData?.market?.tick_size && !stats?.lastPrice),
      usingFallback: currentPrice === 1.0
    },
    dataSource,
    marketStatus: marketData?.market?.market_status
  });
  const fundingRate = 0.0001 // Mock funding rate (would come from contract)
  const priceChange24h = baseTokenData?.priceChange24h || 0
  const priceChangePercent24h = baseTokenData ? (baseTokenData.priceChange24h / baseTokenData.price) * 100 : 0
  const isPriceLoading = isLoadingMarket
  const priceError = marketError
  // dataSource already from hook (contract|fallback|none); never DB
  const lastUpdated = new Date().toISOString() // Use current time since updated_at might not be available

  // Get trading data including collateral and position information from OrderBook
  const collateralBalance = '0' // TODO: Get from wallet/contract
  const allowance = '0' // TODO: Get from USDC allowance
  const isTradingLoading = isLoadingMarket
  const tradingError = marketError
  const positions = marketData?.positions || []
  const isLoadingPositions = isLoadingMarket
  
  // Create enhanced token data with OrderBook market data
  const tokenData = useMemo((): TokenData | null => {
    if (!baseTokenData || !vammMarket || !marketData?.market) return null;
    
    const market = marketData.market;
    
    // Use OrderBook contract data for pricing only
    let finalPrice = stats?.lastPrice || 0;
    let finalPriceChange = 0; // TODO: Calculate from historical data
    let priceDataSource = dataSource;
    
    // Prefer the currentPrice if it’s positive (same as stats.lastPrice)
    if (currentPrice > 0) {
      finalPrice = currentPrice;
      finalPriceChange = priceChangePercent24h;
    }
    
    console.log(`💰 OrderBook market data for ${symbol}:`, {
                dataSource: priceDataSource,
                finalPrice,
                finalPriceChange,
                marketStatus: market.market_status,
                totalVolume: market.total_volume,
                totalTrades: market.total_trades,
                smartContractLastPrice: stats?.lastPrice || 0,
                marketTickSize: market.tick_size || 0,
                hasActiveOrderBook: !!(stats?.bestBid || stats?.bestAsk),
                lastUpdated: new Date(lastUpdated).toISOString()
            });
    
    // Use real volume from OrderBook market
    const volume24h = market.total_volume || 0;
    
    return {
      ...baseTokenData,
      price: finalPrice,
      priceChange24h: finalPriceChange,
      volume24h,
      // Update market cap with real price
      marketCap: finalPrice * (baseTokenData.circulating_supply || 1000000),
      marketCapChange24h: finalPriceChange, // Approximate market cap change with price change
      // Add OrderBook specific data
      logo: market.icon_image_url,
      description: market.description,
      created_at: market.created_at
    };
  }, [baseTokenData, vammMarket, marketData, currentPrice, markPrice, priceChangePercent24h, dataSource, lastUpdated]);
  
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
        console.log('🏦 Mock USDC Address:', '0x194b4517a61D569aC8DBC47a22ed6F665B77a331');
      }
    }
  }, [searchParams]);

  // Mark initial loading as complete once we have ALL essential data from OrderBook
  useEffect(() => {
    if (!hasInitiallyLoaded && 
        baseTokenData && 
        vammMarket && 
        marketData?.market &&
        !isLoading && 
        !isTradingLoading && 
        markPrice !== undefined) {
       console.log('🎯 Initial load completed with OrderBook data:', {
        baseTokenData: !!baseTokenData,
        vammMarket: !!vammMarket,
        marketData: !!marketData,
        marketStatus: marketData.market.market_status,
        markPrice: markPrice,
        positionsCount: positions.length,
        hasRealTimeData: dataSource === 'orderbook'
      });
      setHasInitiallyLoaded(true);
    }
  }, [hasInitiallyLoaded, baseTokenData, vammMarket, marketData, isLoading, isTradingLoading, markPrice, positions.length, dataSource]);

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
                {tradingError ? 'Trading Data Error' : 'Market Not Found'}
              </div>
              <div className="text-gray-400 text-sm">
                {tradingError || error || `No market found for symbol: ${symbol}`}
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
    <div className="min-h-screen bg-black text-white">
      {/* Crypto Market Ticker at the top */}
      <CryptoMarketTicker className="border-b border-gray-800" />
      
      <div className="px-1 pb-8 pt-2">
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
              markPrice: Number(markPrice || 0), // Use resolved smart contract price
              fundingRate: Number(fundingRate || 0),
              currentPrice: Number(currentPrice || 0), // Use resolved smart contract price  
              priceChange24h: Number(priceChange24h || 0),
              priceChangePercent24h: Number(priceChangePercent24h || 0),
              dataSource: String(dataSource || 'contract'), // Indicate smart contract source
              lastUpdated: String(lastUpdated || '')
            }}
          />
        </div>
      </div>

        {/* Desktop Layout - Single-row flex: Chart | Transactions (w-80) | Trading */}
        <div className="hidden md:flex gap-1 mt-1" style={{ height: 'calc(100vh - 96px - 40px - 1rem - 1.5rem)' }}>
        {/* Left: Chart */}
        <div className="flex-1">
          <LightweightChart 
            symbol={symbol}
            height="100%"
            defaultPrice={tokenData?.price || 100}
          />
        </div>
        
        {/* Middle: Transactions with full height */}
        <div className="w-80 h-full">
          <TransactionTable 
            metricId={symbol}
            height="100%"
          />
        </div>

        {/* Right: Token header + trading stacked */}
        <div className="w-80 flex flex-col gap-1 h-full">
          <div className="flex-shrink-0 max-h-80 overflow-hidden">
            <TokenHeader symbol={symbol} />
          </div>
          <div className="flex-1 min-h-0 overflow-hidden">
            <TradingPanel 
              tokenData={tokenData} 
              vammMarket={vammMarket} 
              initialAction={tradingAction}
              marketData={{
                markPrice: Number(markPrice || 0), // Use resolved smart contract price
                fundingRate: Number(fundingRate || 0),
                currentPrice: Number(currentPrice || 0), // Use resolved smart contract price
                priceChange24h: Number(priceChange24h || 0),
                priceChangePercent24h: Number(priceChangePercent24h || 0),
                dataSource: String(dataSource || 'contract'), // Indicate smart contract source
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