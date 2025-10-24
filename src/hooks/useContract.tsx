'use client';

import { useState, useEffect, useMemo } from 'react';
import { createPublicClient, http, Address, PublicClient, getContract } from 'viem';
import { useWallet } from './useWallet';
import { CHAIN_CONFIG, CONTRACT_ADDRESSES } from '@/lib/contractConfig';
import { CONTRACTS } from '@/lib/contracts';
import { getRpcUrl, getChainId } from '@/lib/network';

// Define contract types for better type safety
export type ContractType = 
  | 'mockUSDC' 
  | 'coreVault' 
  | 'futuresMarketFactory'
  | 'aluminumOrderBook'
  | 'orderBook'
  | 'tradingRouter';

interface ContractResult<T = any> {
  contract: T | null;
  isLoading: boolean;
  error: Error | null;
  address: Address | null;
}

/**
 * Hook to access Viem contract instances
 * 
 * This hook provides a consistent way to access contract instances
 * using the centralized Dexetrav5 configuration.
 */
export function useContract<T = any>(contractType: ContractType): ContractResult<T> {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const { walletData } = useWallet();

  // Get contract address from centralized config
  // Resolve address per type (unknown types return null)
  const address: Address | null = useMemo(() => {
    switch (contractType) {
      case 'mockUSDC':
        return (CONTRACT_ADDRESSES as any).mockUSDC as Address;
      case 'coreVault':
        return (CONTRACT_ADDRESSES as any).coreVault as Address;
      case 'futuresMarketFactory':
        return (CONTRACT_ADDRESSES as any).futuresMarketFactory as Address;
      // OrderBook addresses are market-specific and not global; return null here
      case 'aluminumOrderBook':
      case 'orderBook':
      case 'tradingRouter':
      default:
        return null;
    }
  }, [contractType]);

  // Get ABI for the contract
  const abi = useMemo(() => {
    // Map contract type to ABI
    switch (contractType) {
      case 'mockUSDC':
        return CONTRACTS.MockUSDC.abi as any;
      case 'coreVault':
        return CONTRACTS.CentralVault.abi as any;
      case 'futuresMarketFactory':
        // No full ABI available; return empty to avoid misuse
        return [] as any;
      case 'aluminumOrderBook':
      case 'orderBook':
        return [] as any;
      default:
        return [];
    }
  }, [contractType]);

  // Create public client for reading from contracts
  const publicClient = useMemo(() => {
    return createPublicClient({
      chain: { id: getChainId(), name: 'hyperliquid' } as any,
      transport: http(getRpcUrl()),
    });
  }, []);

  // Create contract instance
  const contract = useMemo(() => {
    if (!address || address === '0x0000000000000000000000000000000000000000') {
      setError(new Error(`Contract address not found for ${contractType}`));
      setIsLoading(false);
      return null;
    }

    if (!abi || abi.length === 0) {
      setError(new Error(`ABI not found for ${contractType}`));
      setIsLoading(false);
      return null;
    }

    try {
      const contractInstance = getContract({
        address,
        abi,
        client: publicClient as any,
      });
      
      setIsLoading(false);
      setError(null);
      return contractInstance as unknown as T;
    } catch (err) {
      console.error(`Error creating contract instance for ${contractType}:`, err);
      setError(err instanceof Error ? err : new Error('Unknown error creating contract'));
      setIsLoading(false);
      return null;
    }
  }, [address, abi, publicClient, contractType]);

  // Return contract instance and metadata
  return {
    contract,
    isLoading,
    error,
    address,
  };
}

/**
 * Hook to access the MockUSDC contract
 */
export function useMockUSDC() {
  return useContract('mockUSDC');
}

/**
 * Hook to access the CoreVault contract
 */
export function useCoreVault() {
  return useContract('coreVault');
}

/**
 * Hook to access the FuturesMarketFactory contract
 */
export function useFuturesMarketFactory() {
  return useContract('futuresMarketFactory');
}

/**
 * Hook to access the AluminumOrderBook contract
 */
export function useAluminumOrderBook() {
  return useContract('aluminumOrderBook');
}

/**
 * Hook to access the OrderBook contract
 */
export function useOrderBook() {
  return useContract('orderBook');
}

/**
 * Hook to access the TradingRouter contract
 */
export function useTradingRouter() {
  return useContract('tradingRouter');
}
