'use client';

import { useState, useEffect, useCallback } from 'react';
import { ethers } from 'ethers';
import { getCoreContractAddress } from '@/lib/contracts';

interface TradingRouterMarketData {
  bestBid: number;
  bestAsk: number;
  midPrice: number;
  spread: number;
  lastUpdateTime: number;
}

interface UseTradingRouterMarketDataOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

interface UseTradingRouterMarketDataReturn {
  marketData: TradingRouterMarketData | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  dataSource: 'trading-router' | 'fallback' | 'none';
}

// Market info interface for defensive type checking (OrderBookFactoryMinimal)
interface MarketInfo {
  orderBookAddress: string;
  symbol: string;
  isActive: boolean;
  creator: string;
}

// TradingRouter ABI for multi-market price access
const TRADING_ROUTER_ABI = [
  'function getMultiMarketPrices(bytes32[] marketIds) external view returns (uint256[] bestBids, uint256[] bestAsks)',
  'function isPaused() external view returns (bool)',
  'function factory() external view returns (address)'
];

// OrderBookFactoryMinimal ABI for market ID resolution  
const FACTORY_ABI = [
  'function getMarketBySymbol(string symbol) external view returns (bytes32)',
  'function getMarket(bytes32 marketId) external view returns (tuple(address orderBookAddress, string symbol, bool isActive, address creator))'
];

export function useTradingRouterMarketData(
  marketSymbol: string | undefined, // Changed from marketId to marketSymbol
  chainId: number = 137,
  options: UseTradingRouterMarketDataOptions = {}
): UseTradingRouterMarketDataReturn {
  const {
    autoRefresh = true,
    refreshInterval = 30000 // 30 seconds for TradingRouter
  } = options;

  const [marketData, setMarketData] = useState<TradingRouterMarketData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dataSource, setDataSource] = useState<'trading-router' | 'fallback' | 'none'>('none');

  // Helper function to resolve market symbol to market ID via OrderBookFactory
  const resolveMarketId = useCallback(async (symbol: string, provider: ethers.Provider): Promise<string> => {
    try {
      const tradingRouter = new ethers.Contract(CONTRACT_ADDRESSES.tradingRouter, TRADING_ROUTER_ABI, provider);
      
      // Get factory address with error handling
      let factoryAddress: string;
      try {
        factoryAddress = await tradingRouter.factory();
      } catch (factoryErr) {
        const factoryMessage = factoryErr instanceof Error ? factoryErr.message : String(factoryErr);
        console.error('❌ Failed to get factory address:', factoryMessage);
        throw new Error(`Cannot get factory address: ${factoryMessage}`);
      }

      if (!factoryAddress || factoryAddress === '0x0000000000000000000000000000000000000000') {
        throw new Error('Invalid factory address returned from TradingRouter');
      }

      const factory = new ethers.Contract(factoryAddress, FACTORY_ABI, provider);
      
      // Get market ID from symbol with defensive handling
      let marketId: string;
      try {
        marketId = await factory.getMarketBySymbol(symbol);
      } catch (symbolErr) {
        const symbolMessage = symbolErr instanceof Error ? symbolErr.message : String(symbolErr);
        console.error('❌ Failed to get market by symbol:', symbolMessage);
        
        if (symbolMessage.includes('deferred error during ABI decoding') || symbolMessage.includes('accessing index')) {
          console.warn('⚠️ ABI decoding error in getMarketBySymbol, symbol may not exist');
          throw new Error(`Symbol lookup failed due to contract response issues: ${symbol}`);
        }
        throw new Error(`Symbol lookup failed: ${symbolMessage}`);
      }
      
      if (!marketId || marketId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
        throw new Error(`Market not found for symbol: ${symbol}`);
      }
      
      // Verify market is active with comprehensive defensive handling
      try {
        const rawMarketInfo = await factory.getMarket(marketId);
        
        // Defensive validation of market info structure
        if (!rawMarketInfo) {
          console.warn('⚠️ Market info is null or undefined for marketId:', marketId);
          console.warn('⚠️ Proceeding with market ID anyway, assuming market exists');
          return marketId;
        }

        // Create safe market info object with defensive field access
        const marketInfo: Partial<MarketInfo> = {};
        
        try {
          // Safely extract each field with defensive checks (OrderBookFactoryMinimal structure)
          marketInfo.orderBookAddress = rawMarketInfo.orderBookAddress || rawMarketInfo[0] || '';
          marketInfo.symbol = rawMarketInfo.symbol || rawMarketInfo[1] || '';
          marketInfo.isActive = rawMarketInfo.isActive !== undefined ? rawMarketInfo.isActive : (rawMarketInfo[2] !== undefined ? rawMarketInfo[2] : true);
          marketInfo.creator = rawMarketInfo.creator || rawMarketInfo[3] || '';
        } catch (extractErr) {
          console.warn('⚠️ Error extracting market info fields:', extractErr instanceof Error ? extractErr.message : String(extractErr));
          console.warn('⚠️ Using default values and proceeding with market ID');
          return marketId;
        }

        // Log market info for debugging
        console.log('📊 Market info retrieved:', {
          orderBookAddress: marketInfo.orderBookAddress,
          symbol: marketInfo.symbol,
          isActive: marketInfo.isActive,
          creator: marketInfo.creator
        });

        // Check if market is active with defensive handling
        if (marketInfo.isActive === false) {
          console.warn(`⚠️ Market is not active for symbol: ${symbol}`);
          throw new Error(`Market is not active for symbol: ${symbol}`);
        }

        // Validate essential market info fields
        if (!marketInfo.orderBookAddress || marketInfo.orderBookAddress === '0x0000000000000000000000000000000000000000') {
          console.warn('⚠️ Market has invalid OrderBook address:', marketInfo.orderBookAddress);
          console.warn('⚠️ Proceeding anyway, as market ID may still be valid');
        }

      } catch (marketInfoErr) {
        const marketInfoMessage = marketInfoErr instanceof Error ? marketInfoErr.message : String(marketInfoErr);
        console.error('❌ Failed to get market info:', marketInfoMessage);
        
        // Handle specific ABI decoding errors with graceful fallback
        if (marketInfoMessage.includes('deferred error during ABI decoding') || marketInfoMessage.includes('accessing index')) {
          console.warn('⚠️ ABI decoding error in getMarket, contract returned malformed data');
          console.warn('⚠️ This may indicate the market exists but has incomplete data');
          console.warn(`⚠️ Proceeding with market ID ${marketId} for symbol ${symbol}`);
          
          // Return the market ID anyway, as the symbol lookup succeeded
          return marketId;
        } 
        
        // Handle market not active errors
        if (marketInfoMessage.includes('Market is not active')) {
          console.error(`❌ Market is explicitly marked as inactive for symbol: ${symbol}`);
          throw marketInfoErr;
        }
        
        // Handle contract revert errors
        if (marketInfoMessage.includes('revert') || marketInfoMessage.includes('reverted')) {
          console.warn('⚠️ Contract reverted when getting market info, market may not exist properly');
          console.warn(`⚠️ Proceeding with market ID anyway for symbol: ${symbol}`);
          return marketId;
        }
        
        // Handle network/connectivity errors
        if (marketInfoMessage.includes('network') || marketInfoMessage.includes('timeout') || marketInfoMessage.includes('connection')) {
          console.warn('⚠️ Network error when getting market info, proceeding with market ID');
          return marketId;
        }
        
        // For any other error, log and re-throw with more context
        console.error(`❌ Unexpected error during market verification for ${symbol}:`, marketInfoMessage);
        throw new Error(`Market verification failed unexpectedly: ${marketInfoMessage}`);
      }
      
      return marketId;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Market ID resolution failed:', errorMessage);
      throw err;
    }
  }, []);

  const fetchMarketData = useCallback(async () => {
    try {
      setError(null);
      
      if (!marketSymbol) {
        throw new Error('Market symbol is required');
      }

      console.log(`🔍 Fetching market data from TradingRouter for symbol: ${marketSymbol}`);

      // Create provider for the specified chain
      let provider: ethers.Provider;
      
      if (chainId === 137) { // Polygon
        provider = new ethers.JsonRpcProvider('https://polygon-rpc.com');
      } else if (chainId === 1) { // Ethereum
        provider = new ethers.JsonRpcProvider('https://cloudflare-eth.com');
      } else {
        // Try to use wallet provider as fallback
        if (typeof globalThis !== 'undefined' && (globalThis as any).window && (globalThis as any).window.ethereum) {
          provider = new ethers.BrowserProvider((globalThis as any).window.ethereum);
        } else {
          throw new Error(`Unsupported chain ID: ${chainId}`);
        }
      }

      const tradingRouter = new ethers.Contract(CONTRACT_ADDRESSES.tradingRouter, TRADING_ROUTER_ABI, provider);

      // Check if TradingRouter is paused with defensive error handling
      let isPaused = false;
      try {
        isPaused = await tradingRouter.isPaused();
      } catch (pauseErr) {
        console.warn('⚠️ Could not check pause status, assuming unpaused:', pauseErr instanceof Error ? pauseErr.message : String(pauseErr));
      }

      if (isPaused) {
        throw new Error('TradingRouter is currently paused');
      }

      // Resolve market symbol to actual market ID with defensive handling
      let marketId: string;
      try {
        marketId = await resolveMarketId(marketSymbol, provider);
        console.log(`   Resolved ${marketSymbol} to market ID: ${marketId}`);
      } catch (resolveErr) {
        const resolveMessage = resolveErr instanceof Error ? resolveErr.message : String(resolveErr);
        console.error('❌ Failed to resolve market ID:', resolveMessage);
        throw new Error(`Market resolution failed: ${resolveMessage}`);
      }

      // Get market prices from TradingRouter with comprehensive error protection
      let rawData: any;
      try {
        rawData = await tradingRouter.getMultiMarketPrices([marketId]);
      } catch (abiErr) {
        const abiMessage = abiErr instanceof Error ? abiErr.message : String(abiErr);
        console.error('❌ Error calling getMultiMarketPrices:', abiMessage);
        
        // Handle specific contract call failures
        if (abiMessage.includes('missing revert data') || 
            abiMessage.includes('CALL_EXCEPTION') ||
            abiMessage.includes('data=null') ||
            abiMessage.includes('reason=null')) {
          console.warn('⚠️ Contract call failed with missing revert data - market may not exist or be properly initialized');
          console.warn('⚠️ This could indicate:');
          console.warn('   - Market ID does not exist in the contract');
          console.warn('   - OrderBook contract is not properly deployed');
          console.warn('   - Network connectivity issues');
          console.warn(`   - Market ID: ${marketId}`);
          console.warn(`   - Symbol: ${marketSymbol}`);
          
          setMarketData(null);
          setDataSource('none');
          setError(`Market data unavailable: ${marketSymbol} market may not be properly initialized`);
          setIsLoading(false);
          return;
        }
        
        // Handle ABI decoding specific errors
        if (abiMessage.includes('deferred error during ABI decoding') || 
            abiMessage.includes('accessing index') ||
            abiMessage.includes('ABI decoding')) {
          console.warn('⚠️ ABI decoding error - contract returned malformed data');
          console.warn('⚠️ Using fallback empty state to prevent app crash');
          
          setMarketData(null);
          setDataSource('none');
          setError('Market data temporarily unavailable due to contract response issues');
          setIsLoading(false);
          return;
        }
        
        // Handle network and timeout errors
        if (abiMessage.includes('network') || 
            abiMessage.includes('timeout') || 
            abiMessage.includes('connection') ||
            abiMessage.includes('NETWORK_ERROR') ||
            abiMessage.includes('TIMEOUT')) {
          console.warn('⚠️ Network error when calling getMultiMarketPrices');
          console.warn('⚠️ Will retry on next refresh cycle');
          
          setMarketData(null);
          setDataSource('none');
          setError('Market data temporarily unavailable due to network issues');
          setIsLoading(false);
          return;
        }
        
        // Handle contract not found errors
        if (abiMessage.includes('contract not deployed') ||
            abiMessage.includes('no code at address') ||
            abiMessage.includes('invalid contract')) {
          console.error('❌ TradingRouter contract not found or not deployed properly');
          
          setMarketData(null);
          setDataSource('none');
          setError('TradingRouter contract not available');
          setIsLoading(false);
          return;
        }
        
        // For any other error, log detailed information and gracefully fail
        console.error('❌ Unexpected error calling getMultiMarketPrices:', {
          error: abiMessage,
          marketId,
          marketSymbol,
          contractAddress: CONTRACT_ADDRESSES.tradingRouter,
          chainId
        });
        
        // Still gracefully handle to prevent app crash
        setMarketData(null);
        setDataSource('none');
        setError(`Failed to fetch market data: ${abiMessage.substring(0, 100)}...`);
        setIsLoading(false);
        return;
      }

      // Validate the returned data structure
      if (!rawData || !Array.isArray(rawData) || rawData.length !== 2) {
        console.warn('⚠️ Invalid data structure returned from TradingRouter:', rawData);
        throw new Error('Invalid market data structure returned from contract');
      }

      const [bestBids, bestAsks] = rawData;

      // Validate that both arrays exist and are proper arrays
      if (!Array.isArray(bestBids) || !Array.isArray(bestAsks)) {
        console.warn('⚠️ Market data arrays are not valid arrays:', { bestBids, bestAsks });
        throw new Error('Market data returned invalid array format');
      }

      if (bestBids.length === 0 || bestAsks.length === 0) {
        console.warn('⚠️ Market data arrays are empty for marketId:', marketId);
        throw new Error('No market data returned from TradingRouter');
      }

      // Safely access array elements with validation
      const firstBid = bestBids[0];
      const firstAsk = bestAsks[0];

      if (firstBid === undefined || firstAsk === undefined) {
        console.warn('⚠️ Market data elements are undefined at index 0:', { firstBid, firstAsk });
        throw new Error('Market data elements are undefined');
      }

      // Convert from contract units to display prices with proper scaling
      // SCALING FIX: TradingRouter returns scaled-down contract prices that need to be converted to display prices
      // Contract stores prices in 6-decimal precision (1e6)
      // Contract price 5000000 → Display price $5.00 (divide by 1000000)
      let bestBid: number;
      let bestAsk: number;

      try {
        const PRICE_PRECISION = 1e6;
        bestBid = parseFloat(firstBid.toString()) / PRICE_PRECISION;
        bestAsk = parseFloat(firstAsk.toString()) / PRICE_PRECISION;
      } catch (formatErr) {
        console.error('❌ Error converting contract prices:', formatErr instanceof Error ? formatErr.message : String(formatErr));
        throw new Error('Failed to convert market data from contract');
      }

      // Validate numeric results
      if (isNaN(bestBid) || isNaN(bestAsk)) {
        console.warn('⚠️ Converted prices are NaN:', { bestBid, bestAsk });
        throw new Error('Market data conversion resulted in invalid numbers');
      }

      // Ensure prices are non-negative
      if (bestBid < 0 || bestAsk < 0) {
        console.warn('⚠️ Negative prices detected:', { bestBid, bestAsk });
        bestBid = Math.abs(bestBid);
        bestAsk = Math.abs(bestAsk);
      }

      // Calculate mid-price and spread with additional safety checks
      const midPrice = bestBid > 0 && bestAsk > 0 ? (bestBid + bestAsk) / 2 : 0;
      const spread = bestAsk > 0 && bestBid > 0 ? bestAsk - bestBid : 0;

      console.log(`✅ Successfully fetched TradingRouter data for ${marketSymbol} (${marketId}):`, {
        bestBid,
        bestAsk,
        midPrice,
        spread
      });

      setMarketData({
        bestBid,
        bestAsk,
        midPrice,
        spread,
        lastUpdateTime: Date.now()
      });
      setDataSource('trading-router');
      setIsLoading(false);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.error('❌ Error fetching TradingRouter market data:', errorMessage);
      setError(errorMessage);
      setDataSource('none');
      setIsLoading(false);
    }
  }, [marketSymbol, chainId, resolveMarketId]);

  // Auto-refresh effect
  useEffect(() => {
    if (!marketSymbol) {
      setIsLoading(false);
      return;
    }

    // Initial fetch
    fetchMarketData();

    if (!autoRefresh) return;

    // Set up interval for auto-refresh
    const interval = setInterval(fetchMarketData, refreshInterval);
    return () => clearInterval(interval);
  }, [fetchMarketData, autoRefresh, refreshInterval, marketSymbol]);

  return {
    marketData,
    isLoading,
    error,
    refetch: fetchMarketData,
    dataSource
  };
}
