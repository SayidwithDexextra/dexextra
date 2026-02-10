"use client";
import React, { useMemo, useState, useEffect, useRef } from 'react';
import Image from 'next/image';
import { TokenData } from '@/types/token';
import { useWallet } from '@/hooks/useWallet';
import { useMarketData } from '@/contexts/MarketDataContext';
import { useCoreVault } from '@/hooks/useCoreVault';
import { publicClient } from '@/lib/viemClient';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import type { Address } from 'viem';
// Legacy hooks removed
// Removed hardcoded ALUMINUM_V1_MARKET import - now using dynamic market data

// Helper: format numbers with commas for readability
const formatNumberWithCommas = (value: number): string => {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
  });
};

// Helper: format price with commas and 2 decimals for display
const formatPriceWithCommas = (value: number): string => {
  if (!Number.isFinite(value)) return '0.00';
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
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
  
  // Scroll detection state
  const [isPriceSectionVisible, setIsPriceSectionVisible] = useState(true);
  const [isLimitTabActive, setIsLimitTabActive] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const priceSectionRef = useRef<HTMLDivElement>(null);
  
  // Helper to conditionally apply 2-decimal formatting in Market mode when header is expanded
  const displayVaultValue = (value: string | number | undefined | null) => {
    const num = Number(value ?? 0);
    const isMarketMode = !isLimitTabActive;
    return formatNumberWithCommas(isMarketMode ? Number(num.toFixed(2)) : num);
  };
  
  // Build dynamic tab items; hide Haircut/Socialized Loss when value is zero (or not positive)
  const socializedLossNum = Number(vaultData?.socializedLoss ?? 0);
  const tabItems = useMemo(() => {
    return [
      {
        id: 'marginUsed',
        label: 'Margin Used',
        labelShort: 'Margin Used:',
        value: displayVaultValue(vaultData?.marginUsed),
        emphasis: false
      },
      {
        id: 'reserved',
        label: 'Reserved',
        labelShort: 'Reserved Margin:',
        value: displayVaultValue(vaultData?.marginReserved),
        emphasis: false
      },
      {
        id: 'available',
        label: 'Available',
        labelShort: 'Available Margin:',
        value: displayVaultValue(vaultData?.availableBalance),
        emphasis: false
      },
      ...(socializedLossNum > 0
        ? [{
            id: 'haircut',
            label: 'Haircut',
            labelShort: 'Socialized Loss:',
            value: displayVaultValue(vaultData?.socializedLoss),
            emphasis: true
          }] as const
        : [])
    ];
  }, [vaultData?.marginUsed, vaultData?.marginReserved, vaultData?.availableBalance, vaultData?.socializedLoss]);
  
  // Clamp active tab when the list changes (e.g., when Haircut is hidden)
  useEffect(() => {
    if (activeTab >= tabItems.length) {
      setActiveTab(Math.max(0, tabItems.length - 1));
    }
  }, [tabItems.length, activeTab]);
  
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
  
  // Use consolidated market data provider
  const md = useMarketData();
  const marketData = md.market as any;
  const isLoadingMarket = md.isLoading;
  const marketError = md.error as any;
  
  // Prevent flicker: once header has initial data, do not re-enter loading on background refreshes
  const [hasLoadedHeaderOnce, setHasLoadedHeaderOnce] = useState(false);
  useEffect(() => {
    if (!hasLoadedHeaderOnce && !isLoadingMarket && marketData) {
      setHasLoadedHeaderOnce(true);
    }
  }, [hasLoadedHeaderOnce, isLoadingMarket, marketData]);
  
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

  // Position/contract stats legacy hooks remain removed elsewhere
  
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

  // Mark price rule (single requirement):
  // - Read OrderBook.calculateMarkPrice()
  // - Read CoreVault.getMarkPrice(marketId)
  // - If OB mark == 1.000000, render vault mark; else render OB mark.
  const [effectiveMarkPrice, setEffectiveMarkPrice] = useState<number>(0);
  const [orderBookMarkPrice, setOrderBookMarkPrice] = useState<number>(0);
  const [coreVaultMarkPrice, setCoreVaultMarkPrice] = useState<number>(0);
  const [markPricesLoading, setMarkPricesLoading] = useState<boolean>(true);
  const markPriceLoadKeyRef = useRef<string>('');
  const markPriceRetryTimerRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;

    const orderBookAddressCandidate =
      ((md as any)?.orderBookAddress as string | null | undefined) ||
      ((marketData as any)?.market_address as string | null | undefined) ||
      null;
    const orderBookAddress =
      orderBookAddressCandidate &&
      typeof orderBookAddressCandidate === 'string' &&
      orderBookAddressCandidate.startsWith('0x') &&
      orderBookAddressCandidate.length === 42
        ? (orderBookAddressCandidate as Address)
        : null;

    const marketIdBytes32FromDb = (marketData as any)?.market_id_bytes32 as string | undefined;
    const marketIdOkFromDb =
      !!(marketIdBytes32FromDb && typeof marketIdBytes32FromDb === 'string' && /^0x[0-9a-fA-F]{64}$/.test(marketIdBytes32FromDb));

    const vaultAddrFromConfig = (CONTRACT_ADDRESSES as any)?.CORE_VAULT as string | undefined;
    const vaultAddrOkFromConfig =
      !!(vaultAddrFromConfig && typeof vaultAddrFromConfig === 'string' && vaultAddrFromConfig.startsWith('0x') && vaultAddrFromConfig.length === 42);

    const loadKey = `${String(symbol || '').toUpperCase()}|${String(orderBookAddress || '')}|${String(marketIdBytes32FromDb || '')}|${String(vaultAddrFromConfig || '')}`;
    const keyChanged = loadKey !== markPriceLoadKeyRef.current;
    if (keyChanged) {
      markPriceLoadKeyRef.current = loadKey;
      // Hard reset for a new market identity to prevent "show one then swap".
      setMarkPricesLoading(true);
      setEffectiveMarkPrice(0);
      setOrderBookMarkPrice(0);
      setCoreVaultMarkPrice(0);
    }

    // Reset when switching markets / losing inputs
    if (!orderBookAddress) setOrderBookMarkPrice(0);
    if (!marketIdOkFromDb || !vaultAddrOkFromConfig) setCoreVaultMarkPrice(0);
    if (!orderBookAddress) {
      setEffectiveMarkPrice(0);
      setMarkPricesLoading(true);
      return () => {
        cancelled = true;
        try { if (markPriceRetryTimerRef.current) clearTimeout(markPriceRetryTimerRef.current); } catch {}
      };
    }

    const ORDERBOOK_ABI_MIN = [
      { type: 'function', name: 'calculateMarkPrice', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
      { type: 'function', name: 'marketStatic', stateMutability: 'view', inputs: [], outputs: [
        { type: 'address', name: 'vault' },
        { type: 'bytes32', name: 'marketId' },
        { type: 'bool', name: 'useVWAP' },
        { type: 'uint256', name: 'vwapWindow' },
      ] },
    ] as const as any[];
    const CORE_VAULT_ABI_MIN = [
      { type: 'function', name: 'getMarkPrice', stateMutability: 'view', inputs: [{ name: 'marketId', type: 'bytes32' }], outputs: [{ type: 'uint256' }] },
    ] as const as any[];

    const readBoth = async () => {
      try {
        // Always clear any pending retries when we actively attempt a read.
        try { if (markPriceRetryTimerRef.current) clearTimeout(markPriceRetryTimerRef.current); } catch {}

        const [obRaw, marketStatic] = await Promise.all([
          publicClient.readContract({
            address: orderBookAddress,
            abi: ORDERBOOK_ABI_MIN,
            functionName: 'calculateMarkPrice',
            args: [],
          }) as Promise<bigint>,
          publicClient
            .readContract({
              address: orderBookAddress,
              abi: ORDERBOOK_ABI_MIN,
              functionName: 'marketStatic',
              args: [],
            })
            .catch(() => null) as Promise<any>,
        ]);

        const onchainVaultAddr = (marketStatic?.[0] ?? marketStatic?.vault ?? null) as string | null;
        const onchainMarketId = (marketStatic?.[1] ?? marketStatic?.marketId ?? null) as string | null;
        const vaultAddr =
          (onchainVaultAddr && typeof onchainVaultAddr === 'string' && onchainVaultAddr.startsWith('0x') && onchainVaultAddr.length === 42
            ? onchainVaultAddr
            : null) ||
          (vaultAddrOkFromConfig ? vaultAddrFromConfig! : null);
        const marketIdBytes32 =
          (onchainMarketId && typeof onchainMarketId === 'string' && /^0x[0-9a-fA-F]{64}$/.test(onchainMarketId) ? onchainMarketId : null) ||
          (marketIdOkFromDb ? marketIdBytes32FromDb! : null);

        let vaultRaw: bigint | null = null;
        if (vaultAddr && marketIdBytes32) {
          try {
            vaultRaw = (await publicClient.readContract({
              address: vaultAddr as Address,
              abi: CORE_VAULT_ABI_MIN,
              functionName: 'getMarkPrice',
              args: [marketIdBytes32 as `0x${string}`],
            })) as bigint;
          } catch {
            vaultRaw = null;
          }
        }

        // Require BOTH values to be loaded before rendering any mark price.
        // This prevents a visual "swap" between OB and vault on late/failed reads.
        if (vaultRaw === null) {
          throw new Error('CoreVault.getMarkPrice not loaded yet');
        }

        const ob = Number(obRaw) / 1e6;
        const vault = Number(vaultRaw) / 1e6;
        if (cancelled) return;

        setOrderBookMarkPrice(Number.isFinite(ob) ? ob : 0);
        setCoreVaultMarkPrice(Number.isFinite(vault) ? vault : 0);

        const OB_DEFAULT_RAW = 1_000_000n; // 1.000000 with 6 decimals
        const chosen =
          obRaw === OB_DEFAULT_RAW
            ? (Number.isFinite(vault) ? vault : 0)
            : (Number.isFinite(ob) ? ob : 0);
        setEffectiveMarkPrice(Number.isFinite(chosen) ? chosen : 0);
        setMarkPricesLoading(false);
      } catch {
        if (cancelled) return;
        // If we haven't loaded both values yet, keep showing the loading state and retry.
        if (markPricesLoading || keyChanged) {
          setMarkPricesLoading(true);
          try { if (markPriceRetryTimerRef.current) clearTimeout(markPriceRetryTimerRef.current); } catch {}
          markPriceRetryTimerRef.current = setTimeout(() => {
            if (!cancelled) void readBoth();
          }, 1250);
          return;
        }
        // After initial load, avoid flicker: keep last known good prices on transient errors.
      }
    };

    void readBoth();
    return () => {
      cancelled = true;
      try { if (markPriceRetryTimerRef.current) clearTimeout(markPriceRetryTimerRef.current); } catch {}
    };
    // Refresh reads when OrderBook updates or market identity changes.
  }, [
    symbol,
    (md as any)?.lastUpdated,
    (md as any)?.orderBookAddress,
    (marketData as any)?.market_address,
    (marketData as any)?.market_id_bytes32,
    (CONTRACT_ADDRESSES as any)?.CORE_VAULT,
    markPricesLoading,
  ]);

  // Calculate enhanced token data from unified markets table and contract mark price
  const enhancedTokenData = useMemo((): EnhancedTokenData | null => {
    if (!marketData) return null;

    const market = marketData;
    
    const currentMarkPrice = Number(effectiveMarkPrice > 0 ? effectiveMarkPrice : 0);
    
    // Funding and historical change not tracked in DB yet
    const currentFundingRate = 0;
    const priceChangeValue = 0; 
    const priceChangePercentValue = 0;
    
    // Deployment status based on DB
    const isDeployed = (market as any).deployment_status === 'DEPLOYED' || !!market.market_address || market.market_status === 'ACTIVE';
    
    // Basic metrics from DB (total_volume is lifetime; placeholder for 24h)
    const estimatedSupply = 1000000; // Placeholder until supply metric exists
    const marketCap = currentMarkPrice * estimatedSupply;
    const volume24h = Number((market as any).total_volume ?? 0);
    
    // Derive time-based changes from funding rate and price movement
    const timeBasedChanges = deriveTimeBasedChanges(
      currentFundingRate.toString(), 
      priceChangePercentValue
    );
    
    return {
      symbol: market.symbol || market.market_identifier,
      name: market.name || market.market_identifier.replace(/_/g, ' '),
      description: market.description || '',
      category: market.category || 'General',
      chain: market.network || 'Unknown',
      logo: (market as any).icon_image_url || undefined,
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
      isDeployed,
      created_at: market.created_at,
      marketStatus: market.market_status,
      settlementDate: (market as any).settlement_date || '',
      totalTrades: (market as any).total_trades ?? 0,
      openInterestLong: (market as any).open_interest_long ?? 0,
      openInterestShort: (market as any).open_interest_short ?? 0
    };
  }, [
    marketData,
    effectiveMarkPrice,
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

  // Market price event dispatch is handled by MarketDataProvider

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
  
  // Settlement compact row state (moved above early returns to keep Hooks order stable)
  const proposedSettlementValue = Number((marketData as any)?.proposed_settlement_value ?? 0);
  const settlementExpiresAtStr = (marketData as any)?.settlement_window_expires_at ? String((marketData as any).settlement_window_expires_at) : '';
  const settlementExpiresMs = settlementExpiresAtStr ? new Date(settlementExpiresAtStr).getTime() : 0;
  const [nowTs, setNowTs] = useState<number>(Date.now());
  const settlementActiveCompact = enhancedTokenData?.marketStatus === 'SETTLEMENT_REQUESTED' && proposedSettlementValue > 0 && settlementExpiresMs > nowTs;
  
  useEffect(() => {
    if (!settlementActiveCompact) return;
    const id = setInterval(() => setNowTs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [settlementActiveCompact]);
  
  // Loading state - only show loading if market data is loading
  const shouldShowHeaderLoading = !hasLoadedHeaderOnce && (isLoadingMarket || !marketData);
  const shouldShowMarkPriceLoading = Boolean(markPricesLoading);

  if (shouldShowHeaderLoading) {
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

  // Handle case where market exists but contracts aren't deployed yet.
  // Allow normal header rendering during settlement window (SETTLEMENT_REQUESTED).
  if (!enhancedTokenData.isDeployed || (enhancedTokenData.marketStatus !== 'ACTIVE' && enhancedTokenData.marketStatus !== 'SETTLEMENT_REQUESTED')) {
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
          {enhancedTokenData.marketStatus === 'SETTLEMENT_REQUESTED' && (
            <div className="text-xs text-gray-300 mt-1">
              Proposed: <span className="text-white font-mono">
                ${Number((marketData as any)?.proposed_settlement_value ?? 0).toFixed(4)}
              </span>
              {(marketData as any)?.settlement_window_expires_at ? (
                <> • Expires {new Date(String((marketData as any).settlement_window_expires_at)).toLocaleString()}</>
              ) : null}
              
            </div>
          )}
        </div>
      </div>
    );
  }

  const isPositive = enhancedTokenData.priceChangePercent24h >= 0;
  const { change5m, change1h, change6h } = enhancedTokenData.timeBasedChanges;

  const formatCompactMoney = (value: number): string => {
    if (!Number.isFinite(value)) return '—';
    const abs = Math.abs(value);
    const decimals = abs >= 100 ? 2 : abs >= 1 ? 3 : 6;
    let s = value.toFixed(decimals);
    if (s.includes('.')) s = s.replace(/\.?0+$/, '');
    return `$${s}`;
  };

  const formatTimeRemaining = (ms: number) => {
    if (ms <= 0) return '';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };
  const remainingText = settlementExpiresMs > 0 ? formatTimeRemaining(settlementExpiresMs - nowTs) : '';
  
  // Check for valid real-time price for UI indicators (simplified since hooks removed)
  const showLiveIndicator = enhancedTokenData?.isDeployed && 
    enhancedTokenData?.markPrice > 0;
  // Only show skeleton before the first render; afterwards, display numeric value even during background refreshes
  const isPriceLoading = !hasLoadedHeaderOnce && (!enhancedTokenData || isLoadingMarket);

  return (
    <div className="group bg-[#0F0F0F] hover:bg-[#1A1A1A] rounded-md border border-[#222222] hover:border-[#333333] transition-all duration-200 h-full max-h-full flex flex-col">
      {/* Sticky Token Identity Section - Always Visible */}
      <div className="sticky top-0 z-10 flex-shrink-0">
        <div>
          <div className="p-2">
            <div className="flex items-center justify-between mb-1.5">
              <div className="flex items-center gap-2">
                <div className={`w-1 h-1 rounded-full flex-shrink-0 ${enhancedTokenData.isDeployed ? 'bg-green-400' : 'bg-yellow-400'}`} />
                <span className="text-[10px] font-medium text-[#E5E7EB]">Token Information</span>
              </div>
              <span className="text-[9px] text-[#CBD5E1]">{enhancedTokenData.marketStatus}</span>
            </div>
            
            <div className="flex items-center gap-2">
              <Image 
                src={enhancedTokenData.logo || 'https://media3.giphy.com/media/v1.Y2lkPTc5MGI3NjExaW4xdGtpeWFtaHpqdXpwN25udnNpNmRpaHp4ZjQ3Z2h1YzdmdnQzbSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/l41YbRMqR9jrrCodq/giphy.gif'} 
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
                  {tabItems.map((tab, index) => (
                    <button
                      key={index}
                      onClick={() => setActiveTab(index)}
                      className={`text-[10px] ${
                        activeTab === index 
                          ? 'text-white bg-[#2A2A2A]' 
                          : 'text-[#CBD5E1] bg-[#1A1A1A] hover:bg-[#222222]'
                      } px-2 py-0.5 rounded transition-colors duration-200`}
                    >
                      {tab.label}
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
                      shouldShowMarkPriceLoading ? (
                        <span className="inline-block w-[92px] h-[14px] bg-[#1A1A1A] rounded animate-pulse" />
                      ) : (
                        <span className="text-[13px] font-bold text-white">
                          ${formatPriceWithCommas(enhancedTokenData.markPrice)}
                        </span>
                      )
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
                {isLimitTabActive && tabItems[activeTab] && (
                  <div className="mt-1 text-[10px] flex justify-between">
                    <span className="text-[#CBD5E1]">{tabItems[activeTab].labelShort}</span>
                    <span className={`${tabItems[activeTab].id === 'haircut' && socializedLossNum > 0 ? 'text-red-400' : 'text-white'} font-mono`}>
                      {tabItems[activeTab].value}
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
              <span className="text-[10px] font-medium text-[#E5E7EB]">Current Price</span>
            </div>
            <div className="flex items-center gap-1">
              {showLiveIndicator && (
                <span className="text-[7px] text-green-400 bg-[#1A2A1A] px-1 py-0.5 rounded">LIVE</span>
              )}
              <span className="text-[9px] text-[#CBD5E1]">USDC</span>
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
                shouldShowMarkPriceLoading ? (
                  <span className="inline-block w-[112px] h-[18px] bg-[#1A1A1A] rounded animate-pulse" />
                ) : (
                  <span className="text-base font-bold text-white font-mono">
                    ${formatPriceWithCommas(enhancedTokenData.markPrice)}
                  </span>
                )
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
                    : 'bg-[#1A1A1A] hover:bg-[#2A2A2A] text-[#CBD5E1] hover:text-white'
                }`}
                title="Refresh direct OrderBook price data"
              >
                <span className={`text-[10px] ${isLoadingDirectPrice || isLoadingTrading ? 'animate-spin' : ''}`}>
                  ⟳
                </span>
              </button>
            )}
          </div>
          
          {/* Settlement inline info below current price */}
          {settlementActiveCompact && (
            <div className="mt-1 flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <div className="w-1 h-1 rounded-full bg-yellow-400" />
                <span className="text-[10px] text-[#E5E7EB]">Settlement</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-white font-mono">
                  {formatCompactMoney(proposedSettlementValue)}
                </span>
                {remainingText && (
                  <span className="text-[10px] text-[#CBD5E1]">
                    {remainingText} left
                  </span>
                )}
              </div>
            </div>
          )}
          
          {/* Price Details */}
          <div className="mt-1.5 space-y-1 text-[9px]">
            <div className="flex justify-between">
              {tabItems[activeTab] && (
                <span className="text-[#CBD5E1]">{tabItems[activeTab].labelShort}</span>
              )}
              <div className="flex items-center gap-1">
                {tabItems[activeTab] && (
                  <span className={`font-mono ${tabItems[activeTab].id === 'haircut' && socializedLossNum > 0 ? 'text-red-400' : 'text-white'}`}>
                    {tabItems[activeTab].value}
                  </span>
                )}
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
                <span className="text-[#CBD5E1]">Funding Rate:</span>
                <span className={`font-mono ${enhancedTokenData.fundingRate >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {enhancedTokenData.fundingRate > 0 ? '+' : ''}{(enhancedTokenData.fundingRate * 100).toFixed(4)}%
                </span>
              </div>
            )}
            
            {/* Status Messages */}
            {!enhancedTokenData.isDeployed && (
              <div className="flex justify-between">
                <span className="text-[#CBD5E1]">Status:</span>
                <span className="text-yellow-400">Deployment Pending</span>
              </div>
            )}

            {directPriceError && (
              <div className="flex justify-between">
                <span className="text-[#CBD5E1]">Error:</span>
                <span className="text-red-400">OrderBook Connection</span>
              </div>
            )}
            {tradingError && (
              <div className="flex justify-between">
                <span className="text-[#CBD5E1]">Trading Data:</span>
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