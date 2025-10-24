"use client";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useMarket } from '@/hooks/useMarket';
import { useOrderBookPrice } from '@/hooks/useOrderBookPrice';
import { useCoreVault } from '@/hooks/useCoreVault';
// Legacy hooks removed
// Removed hardcoded ALUMINUM_V1_MARKET import - now using dynamic market data

// Helper: format numbers with commas for readability
const formatNumberWithCommas = (value: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
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

// Import DecryptedText for animation
import DecryptedText from '../Header/DecryptedText';


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
  const wallet = useWallet() as any;
  const address = wallet?.walletData?.address || undefined;
  const isConnected = wallet?.walletData?.isConnected;
  const [activeTab, setActiveTab] = useState(0);
  const vaultData = useCoreVault(address);

  console.log('vaultDatax', vaultData);
  
  // Debug wallet connection issues
  useEffect(() => {
    console.log('Wallet connection status in TokenHeader:', { address, isConnected });
    if (!isConnected) {
      console.log('Wallet is not connected, vault data may not be available.');
    }
  }, [address, isConnected]);
  
  // Propagate core vault values globally so other components can react
  useEffect(() => {
    try {
      const detail = {
        address: address || null,
        isConnected: isConnected,
        isLoading: vaultData?.isLoading ?? true,
        error: vaultData?.error ? String(vaultData.error) : null,
        marginUsed: vaultData?.marginUsed ?? '0',
        marginReserved: vaultData?.marginReserved ?? '0',
        availableBalance: vaultData?.availableBalance ?? '0',
        realizedPnL: (vaultData as any)?.realizedPnL ?? null,
        unrealizedPnL: (vaultData as any)?.unrealizedPnL ?? null
      };
      console.log('[Dispatch] 📢 [EVT][TokenHeader] Dispatch coreVaultSummary', detail);
      const evt = new CustomEvent('coreVaultSummary', { detail });
      if (typeof window !== 'undefined') window.dispatchEvent(evt);
    } catch (e) {
      // no-op
    }
  }, [address, isConnected, vaultData?.isLoading, vaultData?.error, vaultData?.marginUsed, vaultData?.marginReserved, vaultData?.availableBalance]);
  
  // Scroll detection state
  const [isPriceSectionVisible, setIsPriceSectionVisible] = useState(true);
  const [isLimitTabActive, setIsLimitTabActive] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const priceSectionRef = useRef<HTMLDivElement>(null);
  
  // Listen for changes in limit tab status from TradingPanel
  useEffect(() => {
    const handleLimitTabChange: EventListener = (event: Event) => {
      const customEvent = event as CustomEvent<{ isLimitTabActive: boolean }>;
      console.log('[Dispatch] 🎧 [EVT][TokenHeader] Received limitTabChange', customEvent.detail);
      setIsLimitTabActive(customEvent.detail.isLimitTabActive);
    };
    const onOrdersUpdated = (e: any) => {
      try {
        console.log('[Dispatch] 🎧 [EVT][TokenHeader] Received ordersUpdated', e?.detail);
        // If needed, could recalc a badge or force a render. No state change required here.
      } catch {}
    };

    console.log('[Dispatch] 🔗 [EVT][TokenHeader] Subscribing to limitTabChange');
    window.addEventListener('limitTabChange', handleLimitTabChange);
    window.addEventListener('ordersUpdated', onOrdersUpdated);
    return () => {
      console.log('[Dispatch] 🧹 [EVT][TokenHeader] Unsubscribing from limitTabChange');
      window.removeEventListener('limitTabChange', handleLimitTabChange);
      window.removeEventListener('ordersUpdated', onOrdersUpdated);
    };
  }, []);
  
  // OPTIMIZED DATA FETCHING STRATEGY:
  // 1. Market data: Fetch from orderbook_markets table
  // 2. Price data: Real-time contract calls to OrderBook contracts
  // 3. Trading data: Fetch positions from market_positions table
  
  // Get market data from the new unified markets table
  const {
    market: marketData,
    isLoading: isLoadingMarket,
    error: marketError
  } = useMarket(symbol);
  
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

  // Market info and orderbook prices - removed legacy useOrderBookMarketInfo hook
  const contractMarketInfo = null;
  const contractPrices = null;
  const isLoadingDirectPrice = false;
  const directPriceError = null;
  const refreshDirectPrice = null;

  // Keep legacy hook for backward compatibility
  const {
    priceData: legacyOrderBookPrice
  } = useOrderBookPrice(marketData?.market_identifier);
  
  // Position data (placeholder as legacy hooks were removed)
  const vaultPositions: any[] = [];
  const marginSummary = { unrealizedPnL: 0 };
  const isLoadingTrading = false;
  const tradingError = null;
  const refetchMarket = () => {}; // Placeholder for the refetch function

  // Manual refresh function
  const handleManualRefresh = () => {
    console.log('🔄 Manual refresh triggered for OrderBook data');
    // Refresh functionality removed as we removed the legacy hooks
  };

  // Calculate enhanced token data from HyperLiquid orderbook market
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!marketData) return null;

    const market = marketData;
    
    // Since we removed the legacy hooks, we'll use simplified price handling
    const legacyPrice = legacyOrderBookPrice?.price ? Number(legacyOrderBookPrice.price) : 0;
    const currentMarkPrice = legacyPrice || 0; // Remove default fallback price, let animation handle it
    
    // HyperLiquid OrderBook contracts don't have funding rates or historical price changes
    const currentFundingRate = 0;
    const priceChangeValue = 0; 
    const priceChangePercentValue = 0;
    
    // Check if HyperLiquid contracts are deployed and available
    const hasContracts = market.market_status === 'ACTIVE';
    
    // Calculate market metrics based on orderbook data
    const estimatedSupply = 1000000; // Could be derived from open interest
    const marketCap = currentMarkPrice * estimatedSupply;
    const volume24h = 0; // No volume data available
    
    // Derive time-based changes from funding rate and price movement
    const timeBasedChanges = deriveTimeBasedChanges(
      currentFundingRate.toString(), 
      priceChangePercentValue
    );
    
    return {
      symbol: market.market_identifier,
      name: market.name || market.market_identifier.replace(/_/g, ' '), // Use name or convert market_identifier to readable name
      description: market.description || '',
      category: 'General', // Default category
      chain: 'Unknown', // Default chain
      logo: '', // No logo available
      price: Number(currentMarkPrice),
      markPrice: Number(currentMarkPrice),
      fundingRate: currentFundingRate,
      priceChange24h: priceChangeValue,
      priceChangePercent24h: priceChangePercentValue,
      marketCap,
      volume24h,
      timeBasedChanges,
      // Position info (only when wallet connected)
      hasPosition: false, // Removed VaultRouter positions
      positionSize: '0',
      unrealizedPnL: '0',
      // Deployment and market status
      isDeployed: hasContracts,
      created_at: market.created_at,
      marketStatus: market.market_status,
      settlementDate: '',
      totalTrades: 0,
      openInterestLong: 0,
      openInterestShort: 0
    };
  }, [
    marketData, 
    legacyOrderBookPrice, // Legacy price data
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

  // Broadcast mark price to any interested listeners (e.g., charts)
  useEffect(() => {
    if (!enhancedTokenData) return;
    try {
      const detail = {
        symbol: enhancedTokenData.symbol,
        price: Number(enhancedTokenData.markPrice) || 0,
        timestamp: Date.now()
      };
      console.log('[Dispatch] 📢 [EVT][TokenHeader] Dispatch marketMarkPrice', detail);
      const evt = new CustomEvent('marketMarkPrice', { detail });
      if (typeof window !== 'undefined') window.dispatchEvent(evt);
    } catch (e) {
      // no-op
    }
  }, [enhancedTokenData?.symbol, enhancedTokenData?.markPrice]);

  // Debug when enhanced token data changes leading to UI updates
  useEffect(() => {
    if (!enhancedTokenData) return;
    console.log('[Dispatch] 🔁 [UI][TokenHeader] enhancedTokenData updated', {
      symbol: enhancedTokenData.symbol,
      markPrice: enhancedTokenData.markPrice,
      status: enhancedTokenData.marketStatus
    });
  }, [enhancedTokenData?.symbol, enhancedTokenData?.markPrice, enhancedTokenData?.marketStatus]);

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
            {marketError ? marketError.toString() : 'Unknown error'}
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
  
  // Check for valid real-time price for UI indicators (simplified since hooks removed)
  const showLiveIndicator = enhancedTokenData?.isDeployed && 
    enhancedTokenData?.markPrice > 0;
  const isPriceLoading = isLoadingMarket || !enhancedTokenData || enhancedTokenData.markPrice === 0;

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
              <Image 
                src={enhancedTokenData.logo || 'https://media4.giphy.com/media/v1.Y2lkPTc5MGI3NjExazZ5azl4dnJvdXIxb2tzdzRjdm1udHVtN25rcHFpcmxpdzdmNHBzeCZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/c3OZsDoaz7kD6/giphy.gif'} 
                alt={enhancedTokenData.name || 'Market Icon'}
                width={34}
                height={34}
                className="w-7 h-7 rounded border border-[#333333] object-cover flex-shrink-0"
              />
              <div className="min-w-0 flex-1">
                <h1 className="text-xs font-medium text-white mb-0.5 truncate">
                  {enhancedTokenData.name}
                </h1>
                <div className="flex items-center gap-1 flex-wrap">
                  {['Margin Used', 'Reserved', 'Available', 'Haircut'].map((tab, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveTab(index)}
                      className={`text-[10px] ${
                        activeTab === index 
                          ? 'text-white bg-[#2A2A2A]' 
                          : 'text-[#606060] bg-[#1A1A1A] hover:bg-[#222222]'
                      } px-2 py-0.5 rounded transition-colors duration-200`}
                    >
                      {tab}
                    </button>
                  ))}
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
                    {isPriceLoading ? (
                      <DecryptedText
                        text="$0.00"
                        style={{
                          fontSize: '13px',
                          color: 'white',
                          fontWeight: 'bold'
                        }}
                        characters="0123456789$."
                        speed={100}
                        maxIterations={12}
                        animateOnMount={true}
                        animateOnChange={true}
                      />
                    ) : (
                      <span className="text-[13px] font-bold text-white">
                        ${formatNumberWithCommas(enhancedTokenData.markPrice)}
                      </span>
                    )}
                    <span className={`text-[10px] font-medium ${isPositive ? 'text-green-400' : 'text-red-400'}`}>
                      {isPositive ? '↑' : '↓'} {Math.abs(enhancedTokenData.priceChangePercent24h).toFixed(2)}%
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1">
                    {showLiveIndicator && (
                      <span className="text-[7px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">LIVE</span>
                    )}
                    <div className={`w-1 h-1 rounded-full ${showLiveIndicator ? 'bg-green-400 animate-pulse' : 'bg-blue-400'}`}></div>
                  </div>
                </div>
                {/* Display Unrealized PNL when contracted */}
                {isLimitTabActive && (
                  <div className="mt-1 text-[10px] flex justify-between">
                    <span className="text-[#606060]">
                      {activeTab === 0 && 'Margin Used:'}
                      {activeTab === 1 && 'Reserved Margin:'}
                      {activeTab === 2 && 'Available Margin:'}
                      {activeTab === 3 && 'Socialized Loss:'}
                    </span>
                    <span className="text-white font-mono">
                      {activeTab === 0 && (vaultData?.marginUsed || '0')}
                      {activeTab === 1 && (vaultData?.marginReserved || '0')}
                      {activeTab === 2 && (vaultData?.availableBalance || '0')}
                      {activeTab === 3 && (vaultData?.socializedLoss || '0')}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div ref={scrollContainerRef} className={`flex-1 overflow-y-auto token-header-scroll space-y-1.5 p-1 transition-all duration-300 ease-in-out ${isLimitTabActive ? 'max-h-0 opacity-0' : 'max-h-full opacity-100'}`}>

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
              {isPriceLoading ? (
                <DecryptedText
                  text="$0.00"
                  style={{
                    fontSize: '16px',
                    color: 'white',
                    fontWeight: 'bold'
                  }}
                  characters="0123456789$."
                  speed={100}
                  maxIterations={12}
                  animateOnMount={true}
                  animateOnChange={true}
                />
              ) : (
                <span className="text-base font-bold text-white font-mono">
                  {enhancedTokenData.markPrice.toFixed(2)}
                </span>
              )}
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
              <span className="text-[#606060]">
                {activeTab === 0 && 'Margin Used:'}
                {activeTab === 1 && 'Reserved Margin:'}
                {activeTab === 2 && 'Available Margin:'}
                {activeTab === 3 && 'Socialized Loss:'}
              </span>
              <div className="flex items-center gap-1">
                <span className={`font-mono ${activeTab === 3 && parseFloat(vaultData?.socializedLoss||'0') > 0 ? 'text-red-400' : 'text-white'}`}>{
                  activeTab === 0 && formatNumberWithCommas(parseFloat(vaultData?.marginUsed || '0'))
                }{
                  activeTab === 1 && formatNumberWithCommas(parseFloat(vaultData?.marginReserved || '0'))
                }{
                  activeTab === 2 && formatNumberWithCommas(parseFloat(vaultData?.availableBalance || '0'))
                }{
                  activeTab === 3 && formatNumberWithCommas(parseFloat(vaultData?.socializedLoss || '0'))
                }</span>
                {vaultData?.isLoading && <span className="text-blue-400 animate-spin">⟳</span>}
                {!vaultData?.isLoading && isConnected && (
                  <span className="text-green-400" title="Real-time vault data">●</span>
                )}
                {vaultData?.error && (
                  <span className="text-red-400" title="Error fetching vault data">⚠</span>
                )}
              </div>
            </div>
            
            {/* <div className="flex justify-between">
              <span className="text-[#606060]">Total Trades:</span>
              <span className="text-white font-mono">{enhancedTokenData.totalTrades}</span>
            </div> */}
            
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