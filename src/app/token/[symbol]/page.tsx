'use client';

import { use, useState, useEffect, useMemo } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { ethers } from 'ethers';
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
import { useMarket } from '@/hooks/useMarket';
import { CONTRACT_ADDRESSES, populateMarketInfoClient } from '@/lib/contractConfig';
// Removed imports for deleted hooks
import { useOrderBookContractData } from '@/hooks/useOrderBookContractData';
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
  
  // Fetch market data
  const {
    market,
    isLoading: isLoadingMarket,
    error: marketError
  } = useMarket(symbol);
  // Normalize to original shape expected elsewhere in this file
  const marketData: any = market ? { market } : { market: null };
  
  // Using placeholder values instead of deleted hooks
  const baseTokenData = null; // Removed useTokenFromMarket hook
  const vammMarket = null; // Removed useVAMMFromMarket hook
  
  // Ensure MARKET_INFO has this market before proceeding to avoid placeholder mode
  const [isMarketInfoReady, setIsMarketInfoReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        // If already populated for this symbol on client, skip
        const key = (symbol.split('-')[0] || symbol).toUpperCase();
        const existing = (CONTRACT_ADDRESSES as any).MARKET_INFO?.[key];
        if (!existing) {
          await populateMarketInfoClient(symbol);
        }
      } catch {}
      if (mounted) setIsMarketInfoReady(true);
    })();
    return () => { mounted = false };
  }, [symbol]);

  const isLoading = isLoadingMarket || !isMarketInfoReady;
  const error = marketError;
  const settlementData = null;
  
  // Settlement debugging removed for OrderBook-only mode
  
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
    
    // VAMM flow removed in OrderBook-only mode
  };

  // Debug market data before calling stats hook
  useEffect(() => {
    if (marketData?.market) {
      console.log(`🏪 Debug TokenPage market data for ${symbol}:`, {
        id: marketData.market.id,
        market_identifier: marketData.market.market_identifier,
        symbol: marketData.market.symbol,
        name: marketData.market.name,
        market_address: marketData.market.market_address,
        market_status: marketData.market.market_status,
        chain_id: marketData.market.chain_id,
        hasValidAddress: marketData.market.market_address ? ethers.isAddress(marketData.market.market_address) : false
      });
      
      // Additional debug for TransactionTable props
      console.log(`🔄 TransactionTable props for ${symbol}:`, {
        marketId: marketData.market.id,
        marketIdentifier: marketData.market.market_identifier || symbol
      });
    } else {
      console.log(`🏪 Debug TokenPage: No market data for ${symbol}`);
    }
  }, [marketData, symbol]);

  // Live contract reads from OrderBook diamond
  const { data: obLive, isLoading: obLoading, error: obError } = useOrderBookContractData(symbol, { refreshInterval: 15000, orderBookAddress: marketData?.market?.market_address || undefined, marketIdBytes32: marketData?.market?.market_id_bytes32 || undefined });

  // Enhanced price resolution with priority for real-time market activity
  const getResolvedPrice = () => {
    // PRIORITY ORDER FOR DISPLAY PRICE:
    // 1. Current active bid/ask spread (real market activity)
    // 2. Contract lastPrice ONLY if recent and meaningful
    // 3. Market tick_size (base price for new markets)
    // 4. Default fallback
    
    // FIRST: Use real-time order book data if available
    if (obLive?.bestBid && obLive?.bestAsk && obLive.bestBid > 0 && obLive.bestAsk > 0) {
      return (obLive.bestBid + obLive.bestAsk) / 2;
    }
    
    // SECOND: Use smart contract lastPrice ONLY if it represents recent trading activity
    // Note: lastPrice can be stale from old trades, so we need to be careful
    if (obLive?.lastTradePrice && obLive.lastTradePrice > 0) {
      // TODO: Add timestamp check here to ensure lastPrice is recent
      // For now, we'll use it but consider it lower priority than order book
      return obLive.lastTradePrice;
    }
    
    // THIRD: Use market tick_size as the base price for new markets
    if (marketData?.market?.tick_size && marketData.market.tick_size > 0) {
      return marketData.market.tick_size;
    }
    
    // FOURTH: Database fallback
    // DB fallback removed in OrderBook-only mode
    
    // Default fallback for completely new markets
    return 1.0;
  };

  // Prefer live mark price from OrderBook; fallback to resolver
  const currentPrice = obLive?.markPrice ?? getResolvedPrice();
  const markPrice = currentPrice;
  
  // Debug logging for price resolution
  console.log(`💰 Price resolution for ${symbol}:`, {
    resolvedPrice: currentPrice,
    sources: {
      contractBestBid: obLive?.bestBid,
      contractBestAsk: obLive?.bestAsk,
      contractLastPrice: obLive?.lastTradePrice,
      marketTickSize: marketData?.market?.tick_size,
    },
    priceSource: {
      usingBidAsk: !!(obLive?.bestBid && obLive?.bestAsk && obLive.bestBid > 0 && obLive.bestAsk > 0),
      usingLastPrice: !!(obLive?.lastTradePrice && obLive.lastTradePrice > 0 && !(obLive?.bestBid && obLive?.bestAsk)),
      usingTickSize: !!(marketData?.market?.tick_size && !(obLive?.lastTradePrice)),
      usingFallback: currentPrice === 1.0
    },
    marketStatus: marketData?.market?.market_status
  });
  const fundingRate = 0 // Not exposed on OB facets; keep 0 for now
  const priceChange24h = obLive?.priceChange24h || 0
  const priceChangePercent24h = obLive?.priceChange24h ? (obLive.priceChange24h / Math.max(currentPrice, 1)) * 100 : 0
  const isPriceLoading = isLoadingMarket || obLoading
  const priceError = marketError || obError || null
  const lastUpdated = obLive?.lastUpdated || new Date().toISOString()

  // Get trading data including collateral and position information from OrderBook
  const collateralBalance = '0' // TODO: Get from wallet/contract
  const allowance = '0' // TODO: Get from USDC allowance
  const isTradingLoading = isLoadingMarket
  const tradingError = marketError
  const positions = marketData?.positions || []
  const isLoadingPositions = isLoadingMarket
  
  // Create token data in OrderBook-only mode (no vAMM/base token dependencies)
  const tokenData = useMemo((): TokenData | null => {
    const market = marketData?.market;
    const name = market?.metric_id || symbol;
    const finalPrice = currentPrice > 0 ? currentPrice : (obLive?.markPrice || 1);
    const volume24h = obLive?.volume24h || market?.total_volume || 0;

    return {
      symbol,
      name,
      price: finalPrice,
      priceChange24h: priceChangePercent24h,
      volume24h,
      marketCap: finalPrice * 1000000,
      marketCapChange24h: priceChangePercent24h,
      chain: String(market?.chain_id || 'polygon'),
      logo: market?.icon_image_url,
      description: market?.description,
      created_at: market?.created_at
    };
  }, [symbol, marketData, currentPrice, priceChangePercent24h, obLive]);
  
  // Get the trading action from URL params (long/short)
  const [tradingAction, setTradingAction] = useState<'long' | 'short' | null>(null);
  
  // Track whether initial loading has completed (to prevent re-loading)
  const [hasInitiallyLoaded, setHasInitiallyLoaded] = useState(false);
  
  // Track network errors
  const isNetworkError = !!(error && typeof (error as any) === 'string' && (
    (error as any).includes('Please switch your wallet to Polygon') ||
    (error as any).includes('This contract is deployed on Polygon Mainnet')
  ));

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

  // Mark initial loading as complete for OrderBook-only mode
  useEffect(() => {
    if (!hasInitiallyLoaded && !isLoading && !isTradingLoading) {
      setHasInitiallyLoaded(true);
    }
  }, [hasInitiallyLoaded, isLoading, isTradingLoading]);

  // Show loading screen only once during initial page load
  const shouldShowLoading = useMemo(() => {
    if (isLoading || isTradingLoading) return true;
    if (error || tradingError) return false;
    if (!tokenData) return true;
    return false;
  }, [isLoading, isTradingLoading, error, tradingError, tokenData]);

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
  if (error || tradingError || !tokenData) {
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
                Error: {String(error)}
              </div>
            </>
          ) : (
            /* Regular Market Not Found Error */
            <>
              <div className="text-red-500 text-lg">
                {tradingError ? 'Trading Data Error' : 'Market Not Found'}
              </div>
              <div className="text-gray-400 text-sm">
                {String(tradingError || error || `No market found for symbol: ${symbol}`)}
              </div>
              {priceError && (
                <div className="text-yellow-500 text-xs">
                  Price data unavailable: {String(priceError)}
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
            defaultPrice={tokenData?.price || (obLive?.markPrice || 100)}
          />
        </div>
        
        {/* Market Activity Tabs - Below Chart */}
        <div className="w-full">
          <MarketActivityTabs symbol={symbol} />
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
              dataSource: 'contract',
              lastUpdated: String(lastUpdated || '')
            }}
          />
        </div>
      </div>

        {/* Desktop Layout - Single-row flex: Chart | Transactions (w-80) | Trading */}
        <div className="hidden md:flex gap-1 mt-1" style={{ height: 'calc(100vh - 96px - 40px - 1rem - 1.5rem)' }}>
          {/* Left Column: Chart + Market Activity Tabs */}
          <div className="flex-1 flex flex-col gap-0.5 h-full overflow-hidden">
            {/* Chart - Takes flexible space */}
            <div className="flex-shrink-0" style={{ height: '60%' }}>
              <LightweightChart 
                symbol={symbol}
                height="100%"
                defaultPrice={tokenData?.price || (obLive?.markPrice || 100)}
              />
            </div>
            
            {/* Market Activity Tabs - Takes remaining space */}
            <div className="flex-1 min-h-0 overflow-hidden">
              <MarketActivityTabs symbol={symbol} className="h-full" />
            </div>
          </div>
          
          {/* Middle: Transactions with full height */}
          <div className="w-80 h-full">
            <TransactionTable 
              marketId={market?.id}
              marketIdentifier={market?.market_identifier || symbol}
              orderBookAddress={obLive?.orderBookAddress || market?.market_address || undefined}
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