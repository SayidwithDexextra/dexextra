import React, { useMemo, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useOrderbookMarket } from '@/hooks/useOrderbookMarket';
import { useOrderbookMarketStats } from '@/hooks/useOrderbookMarketStats';

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
  
  console.log('🏪 OrderBook Market Data Status:', {
    symbol,
    hasMarketData: !!marketData,
    marketAddress: marketData?.market?.market_address,
    marketStatus: marketData?.market?.market_status,
    isLoadingMarket,
    marketError,
    deploymentStatus: marketData?.metadata?.deployment_status
  });
  
  // Get market statistics from OrderBook contract
  const {
    marketData: contractMarketData,
    isLoading: isLoadingMarketStats,
    error: marketStatsError,
    refetch: refreshMarketStats,
    dataSource
  } = useOrderbookMarketStats(
    marketData?.market?.market_address,
    marketData?.market?.chain_id || 137, // Default to Polygon
    marketData?.market?.last_trade_price || 0, // Fallback price
    {
      autoRefresh: true,
      refreshInterval: 60000 // 1 minute for market stats (much less frequent)
    }
  );
  
  console.log('💰 OrderBook market statistics:', {
    lastPrice: contractMarketData?.lastPrice,
    volume24h: contractMarketData?.volume24h,
    priceChange24h: contractMarketData?.priceChange24h,
    bestBid: contractMarketData?.bestBid,
    bestAsk: contractMarketData?.bestAsk,
    isLoadingMarketStats,
    marketStatsError,
    dataSource,
    marketAddress: marketData?.market?.market_address,
    chainId: marketData?.market?.chain_id
  });

  // Get user positions from market data
  const positions = marketData?.positions || [];
  const isLoadingTrading = isLoadingMarket; // Loading state for positions
  const tradingError = marketError; // Use same error state
  const refreshTrading = refetchMarket; // Use same refresh function

  // Manual refresh function
  const handleManualRefresh = async () => {
    console.log('🔄 Manual refresh triggered for real-time data');
    
    // Refresh unified mark price
    if (refreshMarketStats) {
      await refreshMarketStats();
    }
    
    // Refresh trading data and positions
    if (refreshTrading) {
      await refreshTrading();
    }
  };

  // Calculate enhanced token data from orderbook market
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!marketData?.market) return null;

    const market = marketData.market;
    const currentMarkPrice = contractMarketData?.lastPrice || market.last_trade_price || 0;
    const currentFundingRate = 0; // OrderBook contracts don't have funding rates
    const priceChangeValue = contractMarketData?.priceChange24h || 0;
    const priceChangePercentValue = currentMarkPrice > 0 ? (priceChangeValue / currentMarkPrice) * 100 : 0;

    console.log('🔄 Recalculating enhanced token data for:', symbol, {
      currentMarkPrice,
      currentFundingRate,
      priceChangeValue,
      priceChangePercentValue,
      dataSource,
      timestamp: new Date().toISOString()
    });

    // Check if contracts are deployed and available
    const hasContracts = !!market.market_address && market.market_status === 'ACTIVE';
    
    // Use real-time price data when available
    const hasValidRealTimePrice = hasContracts && 
      !marketStatsError && 
      !isLoadingMarketStats &&
      currentMarkPrice > 0 &&
      dataSource === 'contract';
    
    console.log('🎯 OrderBook price sources:', {
      currentMarkPrice,
      dataSource,
      priceChangeValue,
      priceChangePercentValue,
      hasValidRealTimePrice,
      hasContracts,
      marketStatsError: marketStatsError || 'none',
      isLoadingMarketStats,
      marketStatus: market.market_status
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
    
    // Find user position for this market
    const userPosition = positions?.find(pos => 
      walletData.isConnected && 
      walletData.address &&
      pos.trader_wallet_address.toLowerCase() === walletData.address.toLowerCase()
    );
    
    // Calculate unrealized PnL if position exists
    let unrealizedPnL = 0;
    if (userPosition && currentMarkPrice > 0) {
      const priceDiff = currentMarkPrice - userPosition.entry_price;
      const multiplier = userPosition.is_long ? 1 : -1;
      unrealizedPnL = priceDiff * userPosition.quantity * multiplier;
    }
    
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
      // Position info (only when wallet connected)
      hasPosition: walletData.isConnected && !!userPosition,
      positionSize: walletData.isConnected ? (userPosition?.quantity.toString() || '0') : '0',
      unrealizedPnL: walletData.isConnected ? unrealizedPnL.toString() : '0',
      // Deployment and market status
      isDeployed: hasContracts,
      created_at: market.created_at,
      marketStatus: market.market_status,
      settlementDate: market.settlement_date,
      totalTrades: market.total_trades || 0,
      openInterestLong: market.open_interest_long || 0,
      openInterestShort: market.open_interest_short || 0
    };
  }, [marketData, contractMarketData, positions, isLoadingMarketStats, marketStatsError, dataSource, walletData.isConnected, walletData.address, symbol]);

  console.log('🖥️ Final enhancedTokenData for UI:', {
    symbol,
    markPrice: enhancedTokenData?.markPrice,
    price: enhancedTokenData?.price,
    hasEnhancedData: !!enhancedTokenData,
    dataSource: dataSource,
    marketStatus: enhancedTokenData?.marketStatus,
    isDeployed: enhancedTokenData?.isDeployed
  });

  // Scroll detection effect using Intersection Observer for better performance
  useEffect(() => {
    const priceSection = priceSectionRef.current;
    const scrollContainer = scrollContainerRef.current;
    
    if (!priceSection || !scrollContainer) return;

    // Create intersection observer to detect when price section is visible
    const observer = new IntersectionObserver(
      (entries) => {
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
  
  // Check for valid real-time price for UI indicators
  const realTimePriceValue = contractMarketData?.lastPrice || null;
  const showLiveIndicator = enhancedTokenData.isDeployed && 
    !marketStatsError && 
    realTimePriceValue !== null && 
    !isNaN(realTimePriceValue) && 
    realTimePriceValue >= 0 &&
    dataSource === 'contract';

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 h-full max-h-full flex flex-col">
      {/* Sticky Token Identity Section - Always Visible */}
      <div className="sticky top-0 z-10 flex-shrink-0">
        <div>
          <div className="p-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${enhancedTokenData.isDeployed ? 'bg-green-400' : 'bg-yellow-400'}`} />
                <span className="text-[11px] font-medium text-[#808080]">Token Information</span>
              </div>
              <span className="text-[10px] text-[#606060]">{enhancedTokenData.marketStatus}</span>
            </div>
            
            <div className="flex items-center gap-2">
              {enhancedTokenData.logo && (
                <Image 
                  src={enhancedTokenData.logo} 
                  alt={enhancedTokenData.name}
                  width={40}
                  height={40}
                  className="w-10 h-10 rounded border border-[#333333] object-cover flex-shrink-0"
                />
              )}
              <div className="min-w-0 flex-1">
                <h1 className="text-sm font-medium text-white mb-1 truncate">
                  {enhancedTokenData.name}
                </h1>
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {enhancedTokenData.symbol}
                  </span>
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    {enhancedTokenData.chain}
                  </span>
                  <span className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
                    OrderBook
                  </span>
                  {!enhancedTokenData.isDeployed && (
                    <span className="text-[10px] text-yellow-400 bg-[#2A2A1A] px-1.5 py-0.5 rounded">
                      PENDING
                    </span>
                  )}
                  {enhancedTokenData.hasPosition && (
                    <span className="text-[10px] text-green-400 bg-[#1A2A1A] px-1.5 py-0.5 rounded">
                      POS
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            {/* Conditional Price Display - Shows when price section is scrolled out of view */}
            {!isPriceSectionVisible && (
              <div className="mt-2 pt-2 border-t border-[#333333] animate-in fade-in duration-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-baseline gap-2">
                    <span className="text-sm font-bold text-white">
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
        <div className="p-2.5">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${showLiveIndicator ? 'bg-green-400 animate-pulse' : 'bg-blue-400'}`} />
              <span className="text-[11px] font-medium text-[#808080]">Current Price</span>
            </div>
            <div className="flex items-center gap-1">
              {showLiveIndicator && (
                <span className="text-[8px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">LIVE</span>
              )}
              <span className="text-[10px] text-[#606060]">USDC</span>
            </div>
          </div>
          
          <div className="flex items-center justify-between">
            <div className="flex items-baseline gap-2">
              <span className="text-lg font-bold text-white">
                ${formatNumberWithCommas(enhancedTokenData.markPrice)}
              </span>
              <span className={`text-xs font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                {isPositive ? '↑' : '↓'} {Math.abs(enhancedTokenData.priceChangePercent24h).toFixed(2)}%
              </span>
            </div>
            
            {/* Manual Refresh Button - Compact */}
            {enhancedTokenData.isDeployed && (
              <button
                onClick={handleManualRefresh}
                disabled={isLoadingMarketStats || isLoadingTrading}
                className={`w-6 h-6 flex items-center justify-center rounded transition-all duration-200 ${
                  isLoadingMarketStats || isLoadingTrading 
                    ? 'bg-blue-400/10 text-blue-400' 
                    : 'bg-[#1A1A1A] hover:bg-[#2A2A2A] text-[#606060] hover:text-white'
                }`}
                title="Refresh mark price and trading data"
              >
                <span className={`text-xs ${isLoadingMarketStats || isLoadingTrading ? 'animate-spin' : ''}`}>
                  ⟳
                </span>
              </button>
            )}
          </div>
          
          {/* Price Details */}
          <div className="mt-2 space-y-1 text-[9px]">
            <div className="flex justify-between">
              <span className="text-[#606060]">Mark Price:</span>
              <div className="flex items-center gap-1">
                <span className="text-white font-mono">${formatNumberWithCommas(enhancedTokenData.markPrice)}</span>
                {isLoadingMarketStats && <span className="text-blue-400 animate-spin">⟳</span>}
                {!isLoadingMarketStats && enhancedTokenData.isDeployed && !marketStatsError && (
                  <span className="text-green-400" title="Real-time from contract">●</span>
                )}
                {marketStatsError && (
                  <span className="text-yellow-400" title="Fallback price">◐</span>
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
            {marketStatsError && (
              <div className="flex justify-between">
                <span className="text-[#606060]">Price Source:</span>
                <span className="text-yellow-400">Fallback Mode</span>
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

      {/* Position Info - Sophisticated Design */}
      {walletData.isConnected && enhancedTokenData.isDeployed && (
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="p-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                  enhancedTokenData.hasPosition 
                    ? parseFloat(enhancedTokenData.unrealizedPnL) >= 0 ? 'bg-green-400' : 'bg-red-400'
                    : 'bg-[#404040]'
                }`} />
                <span className="text-[11px] font-medium text-[#808080]">Position</span>
              </div>
              <span className="text-[10px] text-[#606060]">
                {enhancedTokenData.hasPosition ? 'ACTIVE' : 'NONE'}
              </span>
            </div>
            
            {enhancedTokenData.hasPosition ? (
              <div className="space-y-1 text-[9px]">
                <div className="flex justify-between">
                  <span className="text-[#606060]">Size:</span>
                  <div className="flex items-center gap-1">
                    <span className="text-white font-mono">
                      ${formatNumberWithCommas(parseFloat(enhancedTokenData.positionSize))}
                    </span>
                    {isLoadingTrading && <span className="text-blue-400 animate-spin">⟳</span>}
                  </div>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#606060]">Unrealized PnL:</span>
                  <span className={`font-mono ${parseFloat(enhancedTokenData.unrealizedPnL) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    ${formatNumberWithCommas(parseFloat(enhancedTokenData.unrealizedPnL))}
                  </span>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-center py-1">
                <span className="text-[10px] text-[#606060]">
                  {isLoadingTrading ? 'Loading position...' : 'No active position'}
                </span>
              </div>
            )}
            
            {tradingError && (
              <div className="mt-2 pt-1 border-t border-[#1A1A1A]">
                <div className="flex justify-between text-[9px]">
                  <span className="text-[#606060]">Status:</span>
                  <span className="text-red-400">Trading Data Error</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Market Statistics - Sophisticated Design */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-medium text-[#9CA3AF] uppercase tracking-wide">Market Statistics</h4>
          <div className="text-[10px] text-[#606060] bg-[#1A1A1A] px-1.5 py-0.5 rounded">
            Live
          </div>
        </div>
        
        {/* Market Info Grid */}
        <div className="grid grid-cols-2 gap-1.5">
          {/* Created */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-purple-400" />
                <span className="text-[9px] text-[#808080] uppercase">Created</span>
              </div>
            </div>
            <span className="text-[10px] font-medium text-white">
              {enhancedTokenData.created_at ? `${Math.max(0, Math.floor((Date.now() - new Date(enhancedTokenData.created_at).getTime()) / (1000 * 60 * 60 * 24)))}d ago` : 'N/A'}
            </span>
          </div>

          {/* Market Cap */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-blue-400" />
                <span className="text-[9px] text-[#808080] uppercase">Market Cap</span>
              </div>
            </div>
            <span className="text-[10px] font-medium text-white" title={formatLargeNumber(enhancedTokenData.marketCap)}>
              {formatLargeNumber(enhancedTokenData.marketCap)}
            </span>
          </div>

          {/* Volume */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-cyan-400" />
                <span className="text-[9px] text-[#808080] uppercase">Volume 24h</span>
              </div>
            </div>
            <span className="text-[10px] font-medium text-white" title={formatLargeNumber(enhancedTokenData.volume24h)}>
              {formatLargeNumber(enhancedTokenData.volume24h)}
            </span>
          </div>

          {/* Mark Price */}
          <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded border border-[#222222] hover:border-[#333333] transition-all duration-200 p-2">
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-1">
                <div className="w-1 h-1 rounded-full bg-green-400" />
                <span className="text-[9px] text-[#808080] uppercase">Mark Price</span>
              </div>
            </div>
            <span className="text-[10px] font-medium text-white font-mono" title={`$${formatNumberWithCommas(enhancedTokenData.markPrice)}`}>
              ${formatNumberWithCommas(enhancedTokenData.markPrice)}
            </span>
          </div>
        </div>

        {/* Price Changes Grid */}
        <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200">
          <div className="p-2.5">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-yellow-400" />
                <span className="text-[11px] font-medium text-[#808080]">Price Changes</span>
              </div>
              <span className="text-[10px] text-[#606060]">Timeframes</span>
            </div>
            
            <div className="grid grid-cols-4 gap-2">
              {/* 5min Change */}
              <div className="text-center">
                <div className="text-[8px] text-[#606060] mb-0.5 uppercase">5min</div>
                <span className={`text-[9px] font-medium ${getChangeColor(change5m)}`}>
                  {change5m >= 0 ? '+' : ''}{change5m.toFixed(2)}%
                </span>
              </div>

              {/* 1h Change */}
              <div className="text-center">
                <div className="text-[8px] text-[#606060] mb-0.5 uppercase">1h</div>
                <span className={`text-[9px] font-medium ${getChangeColor(change1h)}`}>
                  {change1h >= 0 ? '+' : ''}{change1h.toFixed(2)}%
                </span>
              </div>

              {/* 6h Change */}
              <div className="text-center">
                <div className="text-[8px] text-[#606060] mb-0.5 uppercase">6h</div>
                <span className={`text-[9px] font-medium ${getChangeColor(change6h)}`}>
                  {change6h >= 0 ? '+' : ''}{change6h.toFixed(2)}%
                </span>
              </div>

              {/* 24h Change */}
              <div className="text-center">
                <div className="text-[8px] text-[#606060] mb-0.5 uppercase">24h</div>
                <span className={`text-[9px] font-medium ${getChangeColor(enhancedTokenData.priceChangePercent24h)}`}>
                  {enhancedTokenData.priceChangePercent24h >= 0 ? '+' : ''}{enhancedTokenData.priceChangePercent24h.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      
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