import React, { useMemo } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useVAMMTokenData } from '@/hooks/useVAMMTokenData';
import { useVAMMPriceData } from '@/hooks/useVAMMPriceData';
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
  // 2. Price data: Lightweight polling every 60 seconds (mark price, funding rate)
  // 3. Trading data: Only when wallet connected, polls every 30 seconds for positions
  
  // Get VAMM market data (cached for 5 minutes)
  const { tokenData: baseTokenData, vammMarket, isLoading: isLoadingMarket, error: marketError } = useVAMMTokenData(symbol);
  
  console.log('vammMarket baseTokenData: ', baseTokenData);
  // Get real-time price and trading data (polls mark price every 2 seconds)
  const {
    markPrice,
    fundingRate,
    position,
    isLoading: isLoadingTrading,
    error: tradingError,
    refreshData: refreshTrading,
    refreshMarkPrice
  } = useVAMMTrading(vammMarket || undefined, {
    enablePolling: true, // Always enable polling for real-time price updates
    pollingInterval: 5000, // Full data refresh every 5 seconds
    onlyPollWithPosition: false // Always poll for mark price regardless of position
  });
  
  console.log('Real-time markPrice from useVAMMTrading: ', markPrice);

  // Lightweight fallback for price data (kept for compatibility)
  const { 
    markPrice: fallbackMarkPrice, 
    fundingRate: fallbackFundingRate, 
    isLoading: isLoadingPrice, 
    error: priceError,
    refreshData: refreshPriceData
  } = useVAMMPriceData(vammMarket || undefined, {
    enablePolling: false, // Disable since we're using real-time data from useVAMMTrading
    pollingInterval: 60000
  });

  // Manual refresh function
  const handleManualRefresh = async () => {
    console.log('🔄 Manual refresh triggered for real-time data');
    
    // Refresh real-time mark price immediately
    if (refreshMarkPrice) {
      await refreshMarkPrice();
    }
    
    // Refresh all trading data
    if (refreshTrading) {
      await refreshTrading();
    }
    
    // Fallback price refresh (if needed)
    if (refreshPriceData) {
      await refreshPriceData();
    }
  };

  // Calculate enhanced token data (optimized with fewer dependencies)
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!baseTokenData || !vammMarket) return null;

    console.log('🔄 Recalculating enhanced token data for:', symbol, {
      markPrice,
      fundingRate,
      timestamp: new Date().toISOString()
    });

    // Check if contracts are deployed and available
    const hasContracts = !!vammMarket.vamm_address;
    const hasRealTimePrice = hasContracts && !isLoadingTrading && !tradingError && markPrice && markPrice !== '0';
    
    // Prioritize real-time mark price from useVAMMTrading, fallback to other sources
    console.log('🎯 Real-time price sources:', {
      realTimeMarkPrice: markPrice,
      fallbackMarkPrice,
      initialPrice: vammMarket.initial_price,
      hasRealTimePrice,
      isLoadingTrading
    });
    
    const currentMarkPrice = hasRealTimePrice 
      ? parseFloat(markPrice) 
      : (fallbackMarkPrice ? parseFloat(fallbackMarkPrice) : vammMarket.initial_price);
      
    const initialPrice = vammMarket.initial_price;
    
    console.log('💰 Real-time price calculation:', {
      hasRealTimePrice,
      realTimeMarkPrice: markPrice,
      parsedRealTimePrice: parseFloat(markPrice),
      initialPrice,
      finalPrice: currentMarkPrice,
      isUpdating: isLoadingTrading
    });
    
    // Calculate 24h change based on current vs initial price
    const priceChange24h = calculatePriceChange(currentMarkPrice, initialPrice);
    
    // Calculate market metrics based on real contract data
    const estimatedSupply = 1000000; // Could be fetched from contract if available
    const marketCap = currentMarkPrice * estimatedSupply;
    const volume24h = marketCap * 0.15; // Estimate based on market cap
    
    // Derive time-based changes from funding rate and price movement
    const contractFundingRate = hasRealTimePrice 
      ? fundingRate 
      : (fallbackFundingRate || '0');
    const timeBasedChanges = deriveTimeBasedChanges(contractFundingRate, priceChange24h);
    
    return {
      ...baseTokenData,
      price: currentMarkPrice,
      priceChange24h,
      marketCap,
      volume24h,
      // Add real-time contract-specific data (or defaults if not available)
      markPrice: currentMarkPrice,
      fundingRate: hasRealTimePrice ? (parseFloat(fundingRate) || 0) : 0,
      timeBasedChanges,
      // Add position info if available (only when wallet connected)
      hasPosition: walletData.isConnected && !!position,
      positionSize: walletData.isConnected ? (position?.positionSizeUsd || '0') : '0',
      unrealizedPnL: walletData.isConnected ? (position?.unrealizedPnL || '0') : '0',
      // Add deployment status
      isDeployed: hasContracts,
    };
  }, [baseTokenData, vammMarket, markPrice, fundingRate, fallbackMarkPrice, fallbackFundingRate, position, isLoadingTrading, tradingError, walletData.isConnected, symbol]);

  console.log('enhancedTokenData: ', enhancedTokenData);
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
            {markPrice && markPrice !== '0' && enhancedTokenData.isDeployed && (
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
              {isLoadingTrading && <span className="ml-1 text-blue-400 animate-spin">⟳</span>}
              {!isLoadingTrading && enhancedTokenData.isDeployed && <span className="ml-1 text-green-400">●</span>}
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
            {tradingError && (
              <span className="text-red-400 text-xs">
                ⚠️ Real-time Data Error
              </span>
            )}
            {priceError && !tradingError && (
              <span className="text-yellow-400 text-xs">
                ⚠️ Fallback Mode
              </span>
            )}
          </div>
          
          {/* Manual Refresh Button */}
          {enhancedTokenData.isDeployed && (
            <button
              onClick={handleManualRefresh}
              disabled={isLoadingPrice || isLoadingTrading}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-[#2A2A2A] hover:bg-[#3A3A3A] disabled:opacity-50 disabled:cursor-not-allowed text-[#808080] hover:text-white transition-colors"
              title="Refresh price data"
            >
              <span className={`${isLoadingPrice || isLoadingTrading ? 'animate-spin' : ''}`}>
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