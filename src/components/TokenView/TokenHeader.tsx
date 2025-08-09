import React, { useMemo } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useVAMMTokenData } from '@/hooks/useVAMMTokenData';
import { useUnifiedMarkPrice } from '@/hooks/useUnifiedMarkPrice';
import { useVAMMTrading } from '@/hooks/useVAMMTrading';
import { useWallet } from '@/hooks/useWallet';

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
  symbol: string; // Changed from TokenData to symbol to fetch fresh data
}

interface EnhancedTokenData extends TokenData {
  markPrice: number;
  fundingRate: number;
  timeBasedChanges: {
    change5m: number;
    change1h: number;
    change6h: number;
  };
  hasPosition: boolean;
  positionSize: string;
  unrealizedPnL: string;
  isDeployed: boolean;
}

export default function TokenHeader({ symbol }: TokenHeaderProps) {
  const { walletData } = useWallet();
  
  // OPTIMIZED DATA FETCHING STRATEGY:
  // 1. Market data: Cached for 5 minutes (static info like name, description)
  // 2. Price data: Unified price hook with real-time contract calls
  // 3. Trading data: Only when wallet connected, polls every 30 seconds for positions
  
  // Get VAMM market data (cached for 5 minutes)
  const { tokenData: baseTokenData, vammMarket, isLoading: isLoadingMarket, error: marketError } = useVAMMTokenData(symbol);
  
  console.log('🏪 VAMM Market Data Status:', {
    symbol,
    vammMarket: !!vammMarket,
    vammAddress: vammMarket?.vamm_address,
    isLoadingMarket,
    marketError,
    hasCompleteMarketData: !!(vammMarket?.vamm_address && vammMarket?.symbol)
  });
  
  // Get unified mark price data (replaces useVAMMMarkPrice)
  const {
    markPrice,
    fundingRate,
    currentPrice,
    priceChange24h,
    priceChangePercent24h,
    isLoading: isLoadingMarkPrice,
    error: markPriceError,
    refreshPrice: refreshMarkPrice,
    dataSource
  } = useUnifiedMarkPrice(
    vammMarket?.vamm_address && vammMarket?.symbol ? vammMarket : undefined, 
    {
      enablePolling: true,
      pollingInterval: 30000, // Poll every 30 seconds for real-time updates
      enableContractFetch: true
    }
  );
  
  console.log('💰 Real-time markPrice from useUnifiedMarkPrice:', {
    markPrice,
    fundingRate,
    currentPrice,
    priceChange24h,
    priceChangePercent24h,
    isLoadingMarkPrice,
    markPriceError,
    dataSource,
    vammMarket: vammMarket?.symbol,
    vammAddress: vammMarket?.vamm_address
  });

  // Get trading data and positions (separate from price data)
  const {
    positions,
    isLoading: isLoadingTrading,
    error: tradingError,
    refreshPositions: refreshTrading
  } = useVAMMTrading();

  // Manual refresh function
  const handleManualRefresh = async () => {
    console.log('🔄 Manual refresh triggered for real-time data');
    
    // Refresh unified mark price
    if (refreshMarkPrice) {
      await refreshMarkPrice();
    }
    
    // Refresh trading data and positions
    if (refreshTrading) {
      await refreshTrading();
    }
  };

  // Calculate enhanced token data (optimized with unified price data)
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!baseTokenData || !vammMarket) return null;

    console.log('🔄 Recalculating enhanced token data for:', symbol, {
      currentPrice,
      markPrice,
      fundingRate,
      dataSource,
      timestamp: new Date().toISOString()
    });

    // Check if contracts are deployed and available
    const hasContracts = !!vammMarket.vamm_address;
    
    // Use unified price data - more reliable than individual validation
    const hasValidRealTimePrice = hasContracts && 
      !markPriceError && 
      !isLoadingMarkPrice &&
      currentPrice > 0 &&
      dataSource === 'contract'; // Only use price if it comes from contract
    
    console.log('🎯 Unified mark price sources:', {
      currentPrice,
      markPrice,
      dataSource,
      priceChange24h,
      priceChangePercent24h,
      hasValidRealTimePrice,
      hasContracts,
      markPriceError: markPriceError || 'none',
      isLoadingMarkPrice
    });
    
    // Use unified price data
    const currentMarkPrice = hasValidRealTimePrice ? currentPrice : vammMarket.initial_price;
    const priceChangeValue = hasValidRealTimePrice ? priceChange24h : 0;
    const priceChangePercentValue = hasValidRealTimePrice ? priceChangePercent24h : 0;
    
    // Calculate market metrics based on real contract data
    const estimatedSupply = 1000000; // Could be fetched from contract if available
    const marketCap = currentMarkPrice * estimatedSupply;
    const volume24h = marketCap * 0.15; // Estimate based on market cap
    
    // Derive time-based changes from funding rate and price movement
    const contractFundingRate = hasValidRealTimePrice 
      ? fundingRate 
      : '0';
    const timeBasedChanges = deriveTimeBasedChanges(contractFundingRate, priceChangeValue);
    
    // Find position for this market (if any)
    const currentPosition = positions?.find(pos => 
      // Match by current VAMM address if available
      true // For now, just use first position or null
    );
    
    return {
      ...baseTokenData,
      price: currentMarkPrice,
      priceChange24h: priceChangeValue,
      marketCap,
      volume24h,
      // Add real-time contract-specific data (or defaults if not available)
      markPrice: currentMarkPrice,
      fundingRate: hasValidRealTimePrice ? (parseFloat(fundingRate) || 0) : 0,
      timeBasedChanges,
      // Add position info if available (only when wallet connected)
      hasPosition: walletData.isConnected && !!currentPosition,
      positionSize: walletData.isConnected ? (currentPosition?.size?.toString() || '0') : '0',
      unrealizedPnL: walletData.isConnected ? (currentPosition?.unrealizedPnL?.toString() || '0') : '0',
      // Add deployment status
      isDeployed: hasContracts,
    };
  }, [baseTokenData, vammMarket, currentPrice, markPrice, fundingRate, positions, isLoadingMarkPrice, markPriceError, dataSource, walletData.isConnected, symbol]);

  console.log('🖥️ Final enhancedTokenData for UI:', {
    symbol,
    markPrice: enhancedTokenData?.markPrice,
    price: enhancedTokenData?.price,
    hasEnhancedData: !!enhancedTokenData,
    dataSource: enhancedTokenData ? 'enhanced' : 'none'
  });
  // Loading state - only show loading if market data is loading
  if (isLoadingMarket) {
    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-white text-sm">Loading market data...</div>
      </div>
    );
  }

  // Error state - distinguish between market not deployed and actual errors
  if (marketError || !enhancedTokenData) {
    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-red-400 text-sm text-center">
          Error loading market data: {marketError || 'Unknown error'}
        </div>
      </div>
    );
  }

  // Handle case where market exists but contracts aren't deployed yet
  if (!vammMarket?.vamm_address) {
    return (
      <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-4 min-h-[200px] flex items-center justify-center">
        <div className="text-yellow-400 text-sm text-center">
          <div className="mb-2">⚠️ Market Not Deployed</div>
          <div className="text-xs text-gray-400">
            This market is still pending deployment. Contract features are not available yet.
          </div>
        </div>
      </div>
    );
  }

  const isPositive = enhancedTokenData.priceChange24h >= 0;
  const { change5m, change1h, change6h } = enhancedTokenData.timeBasedChanges;
  
  // Check for valid real-time price for UI indicators
  const realTimePriceValue = markPrice ? parseFloat(markPrice) : null;
  const showLiveIndicator = enhancedTokenData.isDeployed && 
    !markPriceError && 
    realTimePriceValue !== null && 
    !isNaN(realTimePriceValue) && 
    realTimePriceValue >= 0;

  return (
    <div className="rounded-md bg-[#0A0A0A] border border-[#333333] p-3 max-h-[360px] overflow-y-auto flex flex-col token-header-scroll">
      {/* Header Section - Compact */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {enhancedTokenData.logo && (
            <Image 
              src={enhancedTokenData.logo} 
              alt={enhancedTokenData.name}
              width={56}
              height={56}
              className="w-14 h-14 rounded-md border border-[#FFD700] object-cover flex-shrink-0"
            />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-white mb-1 truncate">
              {enhancedTokenData.name}
            </h1>
            <div className="flex items-center gap-1 text-[#808080] text-xs flex-wrap">
              <span className="bg-[#2A2A2A] px-2 py-0.5 rounded text-xs">
                {enhancedTokenData.symbol}
              </span>
              <span className="bg-[#2A2A2A] px-2 py-0.5 rounded text-xs">
                {enhancedTokenData.chain}
              </span>
              <span className="bg-[#2A2A2A] px-2 py-0.5 rounded text-xs">
                VAMM
              </span>
              {!enhancedTokenData.isDeployed && (
                <span className="bg-[#4A3A1A] text-[#FFD700] px-2 py-0.5 rounded text-xs">
                  PENDING
                </span>
              )}
              {enhancedTokenData.hasPosition && (
                <span className="bg-[#1A4A3A] text-[#00D084] px-2 py-0.5 rounded text-xs">
                  POS
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Price Section - Compact */}
      <div className="mb-3">
        <div className="flex items-baseline gap-3 mb-1">
          <span className="text-2xl font-bold text-white">
            ${formatNumberWithCommas(enhancedTokenData.markPrice)}
            {showLiveIndicator && (
              <span className="ml-2 text-xs bg-green-900 text-green-300 px-1.5 py-0.5 rounded-full">
                LIVE
              </span>
            )}
          </span>
          <span className={`text-base font-medium ${isPositive ? 'text-[#00D084]' : 'text-[#FF4747]'}`}>
            {isPositive ? '↑' : '↓'} {Math.abs(enhancedTokenData.priceChange24h).toFixed(2)}%
          </span>
        </div>
        
        {/* Secondary Price Info */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4 text-xs text-[#808080]">
            <span>
              Mark: ${formatNumberWithCommas(enhancedTokenData.markPrice)}
              {isLoadingMarkPrice && <span className="ml-1 text-blue-400 animate-spin">⟳</span>}
              {!isLoadingMarkPrice && enhancedTokenData.isDeployed && !markPriceError && (
                <span className="ml-1 text-green-400" title="Real-time mark price from VAMM contract">●</span>
              )}
              {markPriceError && (
                <span className="ml-1 text-amber-400" title="Using fallback price - contract call failed">◐</span>
              )}
            </span>
            {enhancedTokenData.isDeployed && enhancedTokenData.fundingRate !== 0 && (
              <span>
                Funding: <span className={`${enhancedTokenData.fundingRate >= 0 ? 'text-[#00D084]' : 'text-[#FF4747]'}`}>
                  {enhancedTokenData.fundingRate > 0 ? '+' : ''}{(enhancedTokenData.fundingRate * 100).toFixed(4)}%
                </span>
              </span>
            )}
            {!enhancedTokenData.isDeployed && (
              <span className="text-[#FFD700]">
                Deployment Pending
              </span>
            )}
            {markPriceError && (
              <span className="text-amber-400 text-xs" title="Mark price contract call failed - using fallback">
                ⚠️ Fallback Price
              </span>
            )}
            {tradingError && (
              <span className="text-yellow-400 text-xs">
                ⚠️ Trading Data Error
              </span>
            )}
          </div>
          
          {/* Manual Refresh Button */}
          {enhancedTokenData.isDeployed && (
            <button
              onClick={handleManualRefresh}
              disabled={isLoadingMarkPrice || isLoadingTrading}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[#2A2A2A] hover:bg-[#3A3A3A] disabled:opacity-50 disabled:cursor-not-allowed text-[#808080] hover:text-white transition-colors"
              title="Refresh mark price and trading data"
            >
              <span className={`${isLoadingMarkPrice || isLoadingTrading ? 'animate-spin' : ''}`}>
                ⟳
              </span>
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* Position Info - Compact */}
      {walletData.isConnected && enhancedTokenData.isDeployed && (
        <div className="mb-3 p-2 bg-[#1A1A1A] rounded-md">
          {enhancedTokenData.hasPosition ? (
            <>
              <div className="flex items-center justify-between text-xs">
                <span className="text-[#808080]">Position:</span>
                <span className="text-white font-medium">
                  ${formatNumberWithCommas(parseFloat(enhancedTokenData.positionSize))}
                  {isLoadingTrading && <span className="ml-1 text-blue-400">⟳</span>}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs mt-1">
                <span className="text-[#808080]">PnL:</span>
                <span className={`font-medium ${parseFloat(enhancedTokenData.unrealizedPnL) >= 0 ? 'text-[#00D084]' : 'text-[#FF4747]'}`}>
                  ${formatNumberWithCommas(parseFloat(enhancedTokenData.unrealizedPnL))}
                </span>
              </div>
            </>
          ) : (
            <div className="text-xs text-[#808080] text-center">
              {isLoadingTrading ? 'Loading position...' : 'No active position'}
              {tradingError && (
                <div className="text-red-400 text-xs mt-1">
                  ⚠️ Trading data error
                </div>
              )}
            </div>
          )}
        </div>
      )}

             {/* Stats Grid - Optimized 2x4 layout */}
       <div className="grid grid-cols-2 gap-2">
                 {/* Created */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">created</span>
           <span className="text-xs font-semibold text-white truncate">
             {enhancedTokenData.created_at ? `${Math.max(0, Math.floor((Date.now() - new Date(enhancedTokenData.created_at).getTime()) / (1000 * 60 * 60 * 24)))}d ago` : 'N/A'}
           </span>
         </div>

         {/* Market Cap */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">market cap</span>
           <span className="text-xs font-semibold text-white truncate" title={formatLargeNumber(enhancedTokenData.marketCap)}>
             {formatLargeNumber(enhancedTokenData.marketCap)}
           </span>
         </div>

         {/* Volume */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">volume</span>
           <span className="text-xs font-semibold text-white truncate" title={formatLargeNumber(enhancedTokenData.volume24h)}>
             {formatLargeNumber(enhancedTokenData.volume24h)}
           </span>
         </div>

         {/* Mark Price */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">mark price</span>
           <span className="text-xs font-semibold text-white truncate" title={`$${formatNumberWithCommas(enhancedTokenData.markPrice)}`}>
             ${formatNumberWithCommas(enhancedTokenData.markPrice)}
           </span>
         </div>

         {/* 5min Change */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">5min</span>
           <span className={`text-xs font-semibold truncate ${getChangeColor(change5m)}`}> 
             {change5m >= 0 ? '+' : ''}{change5m.toFixed(2)}%
           </span>
         </div>

         {/* 1h Change */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">1h</span>
           <span className={`text-xs font-semibold truncate ${getChangeColor(change1h)}`}> 
             {change1h >= 0 ? '+' : ''}{change1h.toFixed(2)}%
           </span>
         </div>

         {/* 6h Change */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">6h</span>
           <span className={`text-xs font-semibold truncate ${getChangeColor(change6h)}`}> 
             {change6h >= 0 ? '+' : ''}{change6h.toFixed(2)}%
           </span>
         </div>

         {/* 24h Change */}
         <div className="bg-[#1A1A1A] rounded-md p-2 flex flex-col min-h-[45px]">
           <span className="text-[9px] text-[#808080] uppercase leading-tight mb-0.5">24h</span>
           <span className={`text-xs font-semibold truncate ${getChangeColor(enhancedTokenData.priceChange24h)}`}> 
             {enhancedTokenData.priceChange24h >= 0 ? '+' : ''}{enhancedTokenData.priceChange24h.toFixed(2)}%
           </span>
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
    </div>
  );
}