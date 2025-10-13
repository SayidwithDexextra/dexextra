"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import type { Address } from 'viem';
import { publicClient } from '@/lib/viemClient';

// VaultRouter ABI for position functions
const VAULT_ROUTER_ABI = [
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getUserPositions',
    outputs: [
      {
        components: [
          { internalType: 'bytes32', name: 'marketId', type: 'bytes32' },
          { internalType: 'int256', name: 'size', type: 'int256' },
          { internalType: 'uint256', name: 'entryPrice', type: 'uint256' },
          { internalType: 'uint256', name: 'marginLocked', type: 'uint256' },
          { internalType: 'uint256', name: 'timestamp', type: 'uint256' },
        ],
        internalType: 'struct VaultRouter.Position[]',
        name: '',
        type: 'tuple[]',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'user', type: 'address' }],
    name: 'getMarginSummary',
    outputs: [
      {
        components: [
          { internalType: 'uint256', name: 'totalCollateral', type: 'uint256' },
          { internalType: 'uint256', name: 'marginUsed', type: 'uint256' },
          { internalType: 'uint256', name: 'marginReserved', type: 'uint256' },
          { internalType: 'uint256', name: 'availableCollateral', type: 'uint256' },
          { internalType: 'int256', name: 'realizedPnL', type: 'int256' },
          { internalType: 'int256', name: 'unrealizedPnL', type: 'int256' },
          { internalType: 'int256', name: 'portfolioValue', type: 'int256' },
        ],
        internalType: 'struct VaultRouter.MarginSummary',
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

interface VaultPosition {
  marketId: string;
  size: number; // Positive for long, negative for short
  entryPrice: number;
  marginLocked: number;
  timestamp: number;
  isLong: boolean;
  sizeAbs: number; // Absolute value of size
}

interface MarginSummary {
  totalCollateral: number;
  marginUsed: number;
  marginReserved: number;
  availableCollateral: number;
  realizedPnL: number;
  unrealizedPnL: number;
  portfolioValue: number;
}

interface UseVaultRouterPositionsReturn {
  positions: VaultPosition[];
  marginSummary: MarginSummary | null;
  isLoading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
  lastUpdated: string | null;
}

interface UseVaultRouterPositionsOptions {
  autoRefresh?: boolean;
  refreshInterval?: number;
}

const DEFAULT_OPTIONS: UseVaultRouterPositionsOptions = {
  autoRefresh: true,
  refreshInterval: 30000, // 30 seconds
};

// Price precision (6 decimals for USDC compatibility)
const PRICE_PRECISION = 1e6;

export function useVaultRouterPositions(
  userAddress?: string,
  options: UseVaultRouterPositionsOptions = {}
): UseVaultRouterPositionsReturn {
  const { autoRefresh, refreshInterval } = { ...DEFAULT_OPTIONS, ...options };
  
  const [positions, setPositions] = useState<VaultPosition[]>([]);
  const [marginSummary, setMarginSummary] = useState<MarginSummary | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);
  
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchPositions = useCallback(async (): Promise<void> => {
    if (!userAddress) {
      setError('No user address provided');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      console.log('📊 Fetching positions from VaultRouter for user:', userAddress);

      // Fetch positions and margin summary in parallel
      const [positionsResult, marginResult] = await Promise.all([
        publicClient.readContract({
          address: CONTRACT_ADDRESSES.vaultRouter,
          abi: VAULT_ROUTER_ABI,
          functionName: 'getUserPositions',
          args: [userAddress as Address],
        }),
        publicClient.readContract({
          address: CONTRACT_ADDRESSES.vaultRouter,
          abi: VAULT_ROUTER_ABI,
          functionName: 'getMarginSummary',
          args: [userAddress as Address],
        }),
      ]);

      // Parse positions
      const rawPositions = positionsResult as any[];
      const parsedPositions: VaultPosition[] = rawPositions.map((pos) => {
        const size = Number(pos.size) / PRICE_PRECISION;
        const isLong = size > 0;
        const sizeAbs = Math.abs(size);
        
        return {
          marketId: pos.marketId as string,
          size,
          entryPrice: Number(pos.entryPrice) / PRICE_PRECISION,
          marginLocked: Number(pos.marginLocked) / PRICE_PRECISION,
          timestamp: Number(pos.timestamp),
          isLong,
          sizeAbs,
        };
      });

      // Parse margin summary
      const marginData = marginResult as any;
      const parsedMarginSummary: MarginSummary = {
        totalCollateral: Number(marginData.totalCollateral) / PRICE_PRECISION,
        marginUsed: Number(marginData.marginUsed) / PRICE_PRECISION,
        marginReserved: Number(marginData.marginReserved) / PRICE_PRECISION,
        availableCollateral: Number(marginData.availableCollateral) / PRICE_PRECISION,
        realizedPnL: Number(marginData.realizedPnL) / PRICE_PRECISION,
        unrealizedPnL: Number(marginData.unrealizedPnL) / PRICE_PRECISION,
        portfolioValue: Number(marginData.portfolioValue) / PRICE_PRECISION,
      };

      console.log('✅ VaultRouter positions fetched successfully:', {
        userAddress,
        positionCount: parsedPositions.length,
        positions: parsedPositions,
        marginSummary: parsedMarginSummary,
      });

      setPositions(parsedPositions);
      setMarginSummary(parsedMarginSummary);
      setLastUpdated(new Date().toISOString());

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      console.error('❌ Failed to fetch VaultRouter positions:', {
        userAddress,
        error: errorMessage,
        errorType: err instanceof Error ? err.constructor.name : typeof err,
        errorDetails: err,
      });
      
      // Set a more user-friendly error message
      const friendlyError = errorMessage.includes('ETIMEDOUT') 
        ? 'Network timeout - please check your connection'
        : errorMessage.includes('execution reverted')
        ? 'Smart contract call failed - please try again'
        : errorMessage.includes('network')
        ? 'Network connection error'
        : errorMessage;
        
      setError(friendlyError);
    } finally {
      setIsLoading(false);
    }
  }, [userAddress]);

  // Setup auto-refresh
  useEffect(() => {
    if (!userAddress) {
      setPositions([]);
      setMarginSummary(null);
      return;
    }

    // Initial fetch
    fetchPositions();

    // Setup auto-refresh if enabled
    if (autoRefresh && refreshInterval > 0) {
      intervalRef.current = setInterval(fetchPositions, refreshInterval);
    }

    // Cleanup
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [userAddress, autoRefresh, refreshInterval, fetchPositions]);

  // Manual refetch function
  const refetch = useCallback(async () => {
    await fetchPositions();
  }, [fetchPositions]);

  return {
    positions,
    marginSummary,
    isLoading,
    error,
    refetch,
    lastUpdated,
  };
}
