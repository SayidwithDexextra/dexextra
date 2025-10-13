"use client";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useOrderbookMarket } from '@/hooks/useOrderbookMarket';
import { useOrderBookPrice } from '@/hooks/useOrderBookPrice';
import { useOrderBookMarketInfo } from '@/hooks/useOrderBookMarketInfo';
import { useCentralVault } from '@/hooks/useCentralVault';
import { useVaultRouterPositions } from '@/hooks/useVaultRouterPositions';
// Removed hardcoded ALUMINUM_V1_MARKET import - now using dynamic market data

// Helper: format numbers with commas for readability
const formatNumberWithCommas = (value: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: value < 1 ? 6 : 2
  });
};

// Helper: format large numbers into readable strings
const formatLargeNumber = (value: number): string => {
  if (value >= 1e9) {
    return `$${(value / 1e9).toFixed(1)}B`;
  } else if (value >= 1e6) {
    return `$${(value / 1e6).toFixed(1)}M`;
  } else if (value >= 1e3) {
    return `$${(value / 1e3).toFixed(1)}K`;
  }
  return `$${formatNumberWithCommas(value)}`;
};

// Helper: color class based on positive/negative value
const getChangeColor = (val: number): string => (val >= 0 ? 'text-[#00D084]' : 'text-[#FF4747]');

// Helper: calculate price change percentage based on current vs entry price
const calculatePriceChange = (currentPrice: number, referencePrice: number): number => {
  if (referencePrice === 0) return 0;
  return ((currentPrice - referencePrice) / referencePrice) * 100;
};

// Helper: derive time-based changes from funding rate and market activity
const deriveTimeBasedChanges = (fundingRate: string, baseChange: number) => {
  const fundingRateNum = parseFloat(fundingRate) || 0;
  const marketVolatility = Math.abs(fundingRateNum) * 100; // Convert to percentage
  
  return {
    change5m: baseChange * 0.035 + marketVolatility * 0.1, // 5min approximation
    change1h: baseChange * 0.042 + marketVolatility * 0.2, // 1hour approximation  
    change6h: baseChange * 0.25 + marketVolatility * 0.3,   // 6hour approximation
  };
};



interface TokenHeaderProps {
  symbol: string; // The metric_id for the orderbook market
}

interface EnhancedTokenData {
  symbol: string;
  name: string;
  description: string;
  category: string;
  chain: string;
  logo?: string;
  price: number;
  markPrice: number;
  fundingRate: number;
  priceChange24h: number;
  priceChangePercent24h: number;
  marketCap: number;
  volume24h: number;
  timeBasedChanges: {
    change5m: number;
    change1h: number;
    change6h: number;
  };
  hasPosition: boolean;
  positionSize: string;
  unrealizedPnL: string;
  isDeployed: boolean;
  created_at?: string;
  marketStatus: string;
  settlementDate: string;
  totalTrades: number;
  openInterestLong: number;
  openInterestShort: number;
}

export default function TokenHeader({ symbol }: TokenHeaderProps) {
  const { walletData } = useWallet();
  
  // Scroll detection state
  const [isPriceSectionVisible, setIsPriceSectionVisible] = useState(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const priceSectionRef = useRef<HTMLDivElement>(null);
  
  // OPTIMIZED DATA FETCHING STRATEGY:
  // 1. Market data: Fetch from orderbook_markets table
  // 2. Price data: Real-time contract calls to OrderBook contracts
  // 3. Trading data: Fetch positions from market_positions table
  
  // Get orderbook market data
  const {
    marketData,
    isLoading: isLoadingMarket,
    error: marketError,
    refetch: refetchMarket
  } = useOrderbookMarket(symbol, {
    autoRefresh: true,
    refreshInterval: 120000 // 2 minutes for market data (less frequent)
  });
  
  // console.log('🏪 OrderBook Market Data Status:', {
  //   symbol,
  //   hasMarketData: !!marketData,
  //   marketAddress: marketData?.market?.market_address,
  //   marketStatus: marketData?.market?.market_status,
  //   isLoadingMarket,
  //   marketError,
  //   deploymentStatus: marketData?.metadata?.deployment_status
  // });
  
  // Legacy contract stats removed - using direct OrderBook calls only

  // TradingRouter removed - using direct OrderBook calls only

  // Get DIRECT market info from OrderBook contract (includes lastPrice from smart contract)
  const {
    marketInfo: contractMarketInfo,
    orderBookPrices: contractPrices,
    isLoading: isLoadingDirectPrice,
    error: directPriceError,
    refetch: refreshDirectPrice
  } = useOrderBookMarketInfo(
    marketData?.market?.market_address, // Use the actual OrderBook address
    {
      autoRefresh: true,
      refreshInterval: 15000 // 15 seconds for direct price (most frequent)
    }
  );

  // Keep legacy hook for backward compatibility (but prioritize new data)
  const {
    priceData: legacyOrderBookPrice,
  } = useOrderBookPrice(
    marketData?.market?.market_address,
    {
      autoRefresh: false, // Disable auto-refresh since we're using the new hook as primary
      refreshInterval: 0
    }
  );
  
  // console.log('💰 OrderBook market statistics:', {
  //   lastPrice: contractMarketData?.lastPrice,
  //   volume24h: contractMarketData?.volume24h,
  //   priceChange24h: contractMarketData?.priceChange24h,
  //   bestBid: contractMarketData?.bestBid,
  //   bestAsk: contractMarketData?.bestAsk,
  //   isLoadingMarketStats,
  //   marketStatsError,
  //   dataSource,
  //   marketAddress: marketData?.market?.market_address,
  //   chainId: marketData?.market?.chain_id
  // });

  // Get user positions from VaultRouter
  const {
    positions: vaultPositions,
    marginSummary,
    isLoading: isLoadingPositions,
    error: positionsError,
    refetch: refetchPositions
  } = useVaultRouterPositions(
    walletData.isConnected && walletData.address ? walletData.address : undefined,
    {
      autoRefresh: true,
      refreshInterval: 30000 // 30 seconds
    }
  );
  
  // Legacy position data (kept for backward compatibility)
  const legacyPositions = marketData?.positions || [];
  const isLoadingTrading = isLoadingPositions; // Use VaultRouter loading state
  const tradingError = positionsError; // Use VaultRouter error state
  const refreshTrading = refetchPositions; // Use VaultRouter refresh function

  // Manual refresh function
  const handleManualRefresh = async () => {
    console.log('🔄 Manual refresh triggered for OrderBook data and VaultRouter positions');
    
    // Refresh DIRECT OrderBook price data
    if (refreshDirectPrice) {
      await refreshDirectPrice();
    }
    
    // Refresh VaultRouter positions data
    if (refetchPositions) {
      await refetchPositions();
    }
    
    // Refresh market data
    if (refetchMarket) {
      await refetchMarket();
    }
  };

  // Calculate enhanced token data from HyperLiquid orderbook market
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!marketData?.market) return null;

    const market = marketData.market;
    
    // SMART CONTRACT MARKET INFO PRIORITY: Use lastPrice from getMarketInfo() as primary source
    // Priority order: contractMarketInfo.lastPrice > contractPrices.midPrice > legacy fallbacks
    
    // Get market info directly from smart contract (our target: lastPrice field)
    const contractLastPrice = contractMarketInfo?.lastPrice || 0;
    const contractCurrentPrice = contractMarketInfo?.currentPrice || 0;
    const contractBestBid = contractPrices?.bestBid || 0;
    const contractBestAsk = contractPrices?.bestAsk || 0;
    const contractMidPrice = contractPrices?.midPrice || 0;
    
    // Legacy data for fallback
    const legacyBestBid = legacyOrderBookPrice?.bestBid || 0;
    const legacyBestAsk = legacyOrderBookPrice?.bestAsk || 0;
    const legacyMidPrice = legacyOrderBookPrice?.midPrice || 0;
    const legacyLastTradePrice = legacyOrderBookPrice?.lastTradePrice || 0;
    
    // Calculate display price with PRIORITY TO LASTPRICE FROM SMART CONTRACT
    let currentMarkPrice = 0;
    let priceSource = 'none';
    
    // 🎯 PRIMARY: Use lastPrice from smart contract market variable (this is our target!)
    if (contractLastPrice > 0) {
      currentMarkPrice = contractLastPrice;
      priceSource = 'contract-lastPrice';
    }
    // SECONDARY: Use current mid-price from order book
    else if (contractMidPrice > 0) {
      currentMarkPrice = contractMidPrice;
      priceSource = 'contract-midPrice';
    }
    // TERTIARY: Use currentPrice from smart contract (mark price)
    else if (contractCurrentPrice > 0) {
      currentMarkPrice = contractCurrentPrice;
      priceSource = 'contract-currentPrice';
    }
    // FALLBACK: Use calculated mid from bid/ask
    else if (contractBestBid > 0 && contractBestAsk > 0) {
      currentMarkPrice = (contractBestBid + contractBestAsk) / 2;
      priceSource = 'contract-calculated-mid';
    }
    // FALLBACK: Single side
    else if (contractBestBid > 0 || contractBestAsk > 0) {
      currentMarkPrice = contractBestBid || contractBestAsk;
      priceSource = 'contract-single-side';
    }
    // LAST RESORT: Legacy hook data
    else if (legacyLastTradePrice > 0) {
      currentMarkPrice = legacyLastTradePrice;
      priceSource = 'legacy-lastTrade';
    }
    else if (legacyMidPrice > 0) {
      currentMarkPrice = legacyMidPrice;
      priceSource = 'legacy-mid';
    }
    
    // Use contract bid/ask prices with legacy fallback
    const bestBid = contractBestBid || legacyBestBid;
    const bestAsk = contractBestAsk || legacyBestAsk;
    
    // HyperLiquid OrderBook contracts don't have funding rates or historical price changes
    const currentFundingRate = 0;
    const priceChangeValue = 0; // No historical data available from direct OrderBook calls
    const priceChangePercentValue = 0; // No historical data available from direct OrderBook calls

    console.log('🎯 Smart Contract Market Info for:', symbol, {
      // PRIMARY: Smart Contract Market Data
      contractLastPrice, // 🎯 This is our target field!
      contractCurrentPrice,
      contractBestBid,
      contractBestAsk,
      contractMidPrice,
      contractSymbol: contractMarketInfo?.symbol,
      contractIsActive: contractMarketInfo?.isActive,
      contractOpenInterest: contractMarketInfo?.openInterest,
      contractVolume24h: contractMarketInfo?.volume24h,
      
      // FALLBACK: Legacy Hook Data
      legacyBestBid,
      legacyBestAsk,
      legacyMidPrice,
      legacyLastTradePrice,
      
      // Final Computed Values
      finalPrice: currentMarkPrice,
      finalBestBid: bestBid,
      finalBestAsk: bestAsk,
      priceSource, // Shows which price source was used
      spread: bestAsk - bestBid,
      
      // Status
      isLoadingDirectPrice,
      directPriceError: directPriceError || 'none',
      timestamp: new Date().toISOString()
    });

    // Check if HyperLiquid contracts are deployed and available
    const hasContracts = !!market.market_address && market.market_status === 'ACTIVE';
    
    // Use real-time price data from smart contract market info
    const hasValidRealTimePrice = hasContracts && 
      currentMarkPrice > 0 &&
      contractMarketInfo?.isActive &&
      !directPriceError && 
      !isLoadingDirectPrice;
    
    console.log('✅ Smart Contract Price Validation:', {
      currentMarkPrice,
      priceSource, // Shows which price source was selected
      contractLastPrice, // 🎯 Our primary target
      contractCurrentPrice,
      bestBid,
      bestAsk,
      hasValidRealTimePrice,
      hasContracts,
      contractIsActive: contractMarketInfo?.isActive,
      isLoadingDirectPrice,
      directPriceError: directPriceError || 'none',
      marketStatus: market.market_status,
      
      priceChangeValue,
      priceChangePercentValue
    });
    
    // Calculate market metrics based on orderbook data
    const estimatedSupply = 1000000; // Could be derived from open interest
    const marketCap = currentMarkPrice * estimatedSupply;
    const volume24h = market.total_volume || 0;
    
    // Derive time-based changes from funding rate and price movement
    const timeBasedChanges = deriveTimeBasedChanges(
      currentFundingRate.toString(), 
      priceChangePercentValue
    );
    
    // Find user position for this market from VaultRouter
    // Use the actual market ID from the current market data instead of hardcoded V1
    const currentMarketId = marketData?.market?.metric_id || symbol;
    const userPosition = vaultPositions?.find(pos => 
      walletData.isConnected && 
      pos.marketId.toLowerCase() === currentMarketId.toLowerCase()
    );
    
    // Calculate unrealized PnL for this specific market
    let unrealizedPnL = 0;
    if (userPosition && currentMarkPrice > 0) {
      const priceDiff = currentMarkPrice - userPosition.entryPrice;
      unrealizedPnL = priceDiff * userPosition.sizeAbs * (userPosition.isLong ? 1 : -1);
    }
    
    // Use total unrealized PnL from margin summary if available (more accurate)
    const totalUnrealizedPnL = marginSummary?.unrealizedPnL || unrealizedPnL;
    
    return {
      symbol: market.metric_id,
      name: market.metric_id.replace(/_/g, ' '), // Convert metric_id to readable name
      description: market.description,
      category: market.category,
      chain: market.chain_id === 137 ? 'Polygon' : `Chain ${market.chain_id}`,
      logo: market.icon_image_url,
      price: currentMarkPrice,
      markPrice: currentMarkPrice,
      fundingRate: currentFundingRate,
      priceChange24h: priceChangeValue,
      priceChangePercent24h: priceChangePercentValue,
      marketCap,
      volume24h,
      timeBasedChanges,
      // Position info (only when wallet connected) - using VaultRouter data
      hasPosition: walletData.isConnected && !!userPosition,
      positionSize: walletData.isConnected ? (userPosition?.sizeAbs.toString() || '0') : '0',
      unrealizedPnL: walletData.isConnected ? totalUnrealizedPnL.toString() : '0',
      // Deployment and market status
      isDeployed: hasContracts,
      created_at: market.created_at,
      marketStatus: market.market_status,
      settlementDate: market.settlement_date,
      totalTrades: market.total_trades || 0,
      openInterestLong: market.open_interest_long || 0,
      openInterestShort: market.open_interest_short || 0
    };
  }, [
    marketData, 
    contractMarketInfo, // Primary: Smart contract market info (includes lastPrice!)
    contractPrices, // Primary: Smart contract order book prices
    legacyOrderBookPrice, // Fallback: Legacy price data
    vaultPositions, // VaultRouter positions
    marginSummary, // VaultRouter margin summary
    isLoadingDirectPrice,
    directPriceError,
    walletData.isConnected, 
    walletData.address, 
    symbol
  ]);

  // console.log('🖥️ Final enhancedTokenData for UI:', {
  //   symbol,
  //   markPrice: enhancedTokenData?.markPrice,
  //   price: enhancedTokenData?.price,
  //   hasEnhancedData: !!enhancedTokenData,
  //   dataSource: dataSource,
  //   marketStatus: enhancedTokenData?.marketStatus,
  //   isDeployed: enhancedTokenData?.isDeployed
  // });

  // Scroll detection effect using Intersection Observer for better performance
  useEffect(() => {
    const priceSection = priceSectionRef.current;
    const scrollContainer = scrollContainerRef.current;
    
    if (!priceSection || !scrollContainer) return;

    // Create intersection observer to detect when price section is visible
    const IO = (typeof globalThis !== 'undefined' && (globalThis as any).IntersectionObserver
      ? (globalThis as any).IntersectionObserver
      : null);
    if (!IO) return;

    const observer = new IO(
      (entries: any[]) => {
        const entry = entries[0];
        setIsPriceSectionVisible(entry.isIntersecting);
      },
      {
        root: scrollContainer, // Observe within the scroll container
        threshold: 0.1, // Trigger when at least 10% is visible
        rootMargin: '0px' // No margin
      }
    );

    observer.observe(priceSection);
    
    // Cleanup
    return () => {
      observer.disconnect();
    };
  }, [enhancedTokenData]); // Re-run when token data changes
  // Loading state - only show loading if market data is loading
  if (isLoadingMarket) {
    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-white text-sm">Loading orderbook market data...</div>
      </div>
    );
  }

  // Error state - distinguish between market not found and actual errors
  if (marketError || !enhancedTokenData) {
    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-red-400 text-sm text-center">
          <div className="mb-2">Error loading market data:</div>
          <div className="text-xs text-gray-400">
            {marketError || 'Unknown error'}
          </div>
          <button 
            onClick={refetchMarket}
            className="mt-3 px-3 py-1 bg-red-600 hover:bg-red-700 rounded text-xs transition-colors"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // Handle case where market exists but contracts aren't deployed yet
  if (!enhancedTokenData.isDeployed || enhancedTokenData.marketStatus !== 'ACTIVE') {
    const statusText = {
      'PENDING': 'Market Creation Pending',
      'DEPLOYING': 'Contracts Deploying',
      'TRADING_ENDED': 'Trading Has Ended',
      'SETTLEMENT_REQUESTED': 'Settlement In Progress',
      'SETTLED': 'Market Settled',
      'EXPIRED': 'Market Expired',
      'PAUSED': 'Market Paused',
      'ERROR': 'Deployment Error'
    }[enhancedTokenData.marketStatus] || 'Market Not Active';

    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-yellow-400 text-sm text-center">
          <div className="mb-2">⚠️ {statusText}</div>
          <div className="text-xs text-gray-400 mb-2">
            Status: {enhancedTokenData.marketStatus}
          </div>
          {enhancedTokenData.marketStatus === 'PENDING' && (
            <div className="text-xs text-gray-400">
              This market is awaiting contract deployment. Trading is not yet available.
            </div>
          )}
          {enhancedTokenData.marketStatus === 'SETTLED' && (
            <div className="text-xs text-gray-400">
              This market has been settled. Final settlement date: {new Date(enhancedTokenData.settlementDate).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>
    );
  }

  const isPositive = enhancedTokenData.priceChangePercent24h >= 0;
  const { change5m, change1h, change6h } = enhancedTokenData.timeBasedChanges;
  
  // Check for valid real-time price for UI indicators (using smart contract market info)
  const showLiveIndicator = enhancedTokenData?.isDeployed && 
    enhancedTokenData?.markPrice > 0 && 
    contractMarketInfo?.isActive && 
    !directPriceError && 
    !isLoadingDirectPrice;

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 h-full max-h-full flex flex-col">
      {/* Sticky Token Identity Section - Always Visible */}
      <div className="sticky top-0 z-10 flex-shrink-0">
        <div>
          <div className="p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-1 h-1 rounded-full flex-shrink-0 ${enhancedTokenData.isDeployed ? 'bg-green-400' : 'bg-yellow-400'}`} />
                <span className="text-[10px] font-medium text-[#808080]">Token Information</span>
              </div>
              <span className="text-[9px] text-[#606060]">{enhancedTokenData.marketStatus}</span>
            </div>
            
            <div className="flex items-center gap-2">
              {enhancedTokenData.logo && (
                <Image 
                  src={enhancedTokenData.logo} 
                  alt={enhancedTokenData.name}
                  width={28}
                  height={28}
                  className="w-7 h-7 rounded border border-[#333333] object-cover flex-shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-xs font-medium text-white mb-0.5 truncate">
                  {enhancedTokenData.name}
                </h1>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1 py-0.5 rounded">
                    {enhancedTokenData.symbol}
                  </span>
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1 py-0.5 rounded">
                    {enhancedTokenData.chain}
                  </span>
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1 py-0.5 rounded">
                    OrderBook
                  </span>
                  {!enhancedTokenData.isDeployed && (
                    <span className="text-[10px] text-yellow-400 bg-[#2A2A1A] px-1 py-0.5 rounded">
                      PENDING
                    </span>
                  )}
                  {enhancedTokenData.hasPosition && (
                    <span className="text-[10px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">
                      POS
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Conditional Price Display - Shows when price section is scrolled out of view */}
            {!isPriceSectionVisible && (
              <div className="mt-1.5 pt-1.5 border-t border-[#333333] animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[13px] font-bold text-white">
                      ${formatNumberWithCommas(enhancedTokenData.markPrice)}
                    </span>
                    <span className={`text-[10px] font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '↑' : '↓'} {Math.abs(enhancedTokenData.priceChangePercent24h).toFixed(2)}%
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    {showLiveIndicator && (
                      <span className="text-[7px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">LIVE</span>
                    )}
                    <div className={`w-1 h-1 rounded-full ${showLiveIndicator ? 'bg-green-400 animate-pulse' : 'bg-blue-400'}`} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div ref={scrollContainerRef} className="flex-1 overflow-y-auto token-header-scroll space-y-1.5 p-1">

      {/* Price Section - Sophisticated Design */}
      <div ref={priceSectionRef} className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
        <div className="p-2">
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-1.5">
              <div className={`w-1 h-1 rounded-full flex-shrink-0 ${showLiveIndicator ? 'bg-green-400 animate-pulse' : 'bg-blue-400'}`} />
              <span className="text-[10px] font-medium text-[#808080]">Current Price</span>
            </div>
            <div className="flex items-center gap-1">
              {showLiveIndicator && (
                <span className="text-[7px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">LIVE</span>
              )}
              <span className="text-[9px] text-[#606060]">USDC</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-bold text-white">
                ${formatNumberWithCommas(enhancedTokenData.markPrice)}
              </span>
              <span className={`text-[11px] font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                {isPositive ? '↑' : '↓'} {Math.abs(enhancedTokenData.priceChangePercent24h).toFixed(2)}%
              </span>
            </div>
            
            {/* Manual Refresh Button - Compact */}
            {enhancedTokenData.isDeployed && (
              <button
                onClick={handleManualRefresh}
                disabled={isLoadingDirectPrice || isLoadingTrading}
                className={`w-5 h-5 flex items-center justify-center rounded transition-all duration-200 ${
                  isLoadingDirectPrice || isLoadingTrading 
                    ? 'bg-blue-400/10 text-blue-400' 
                    : 'bg-[#1A1A1A] hover:bg-[#2A2A2A] text-[#606060] hover:text-white'
                }`}
                title="Refresh direct OrderBook price data"
              >
                <span className={`text-[10px] ${isLoadingDirectPrice || isLoadingTrading ? 'animate-spin' : ''}`}>
                  ⟳
                </span>
              </button>
            )}
          </div>
          
          {/* Price Details */}
          <div className="mt-1.5 space-y-1 text-[9px]">
            <div className="flex justify-between">
              <span className="text-[#606060]">Mark Price:</span>
              <div className="flex items-center gap-1">
                <span className="text-white font-mono">${formatNumberWithCommas(enhancedTokenData.markPrice)}</span>
                {isLoadingDirectPrice && <span className="text-blue-400 animate-spin">⟳</span>}
                {!isLoadingDirectPrice && enhancedTokenData.isDeployed && showLiveIndicator && (
                  <span className="text-green-400" title="Real-time from direct OrderBook contract">●</span>
                )}
                {directPriceError && (
                  <span className="text-red-400" title="Error fetching OrderBook price data">⚠</span>
                )}
              </div>
            </div>
            
            <div className="flex justify-between">
              <span className="text-[#606060]">Total Trades:</span>
              <span className="text-white font-mono">{enhancedTokenData.totalTrades}</span>
            </div>
            
            {enhancedTokenData.isDeployed && enhancedTokenData.fundingRate !== 0 && (
              <div className="flex justify-between">
                <span className="text-[#606060]">Funding Rate:</span>
                <span className={`font-mono ${enhancedTokenData.fundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {enhancedTokenData.fundingRate > 0 ? '+' : ''}{(enhancedTokenData.fundingRate * 100).toFixed(4)}%
                </span>
              </div>
            )}
            
            {/* Status Messages */}
            {!enhancedTokenData.isDeployed && (
              <div className="flex justify-between">
                <span className="text-[#606060]">Status:</span>
                <span className="text-yellow-400">Deployment Pending</span>
              </div>
            )}

            {directPriceError && (
              <div className="flex justify-between">
                <span className="text-[#606060]">Error:</span>
                <span className="text-red-400">OrderBook Connection</span>
              </div>
            )}
            {tradingError && (
              <div className="flex justify-between">
                <span className="text-[#606060]">Trading Data:</span>
                <span className="text-red-400">Error</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Position summary removed to reduce vertical height */}

      {/* Market Statistics and Price Changes removed to reduce vertical height */}
      
      {/* Custom scrollbar styles */}
      <style jsx>{`
        /* Webkit scrollbar styles */
        :global(.token-header-scroll::-webkit-scrollbar) {
          width: 6px;
        }
        
        :global(.token-header-scroll::-webkit-scrollbar-track) {
          background: transparent;
        }
        
        :global(.token-header-scroll::-webkit-scrollbar-thumb) {
          background: #22C55E;
          border-radius: 3px;
        }
        
        :global(.token-header-scroll::-webkit-scrollbar-thumb:hover) {
          background: #16A34A;
        }
        
        /* Firefox scrollbar styles */
        :global(.token-header-scroll) {
          scrollbar-width: thin;
          scrollbar-color: #22C55E transparent;
        }
      `}</style>
      
      </div> {/* End of Scrollable Content Area */}
    </div>
  );
}