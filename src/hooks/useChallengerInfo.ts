'use client';

import { useState, useEffect, useCallback } from 'react';
import { publicClient } from '@/lib/viemClient';

/**
 * On-chain challenge info from the HyperLiquid market contract.
 * 
 * NOTE: Currently testing on ETH testnet (Sepolia). When migrating to HyperLiquid mainnet:
 * - The contract address format and RPC will change
 * - The ABI and function signatures should remain the same (MarketLifecycleFacet)
 * - Update `publicClient` in `@/lib/viemClient` to point to HyperLiquid RPC
 */
export interface ChallengerInfo {
  /** Whether there's an active challenge on this market */
  hasActiveChallenge: boolean;
  /** The address of the user who submitted the challenge */
  challengerAddress: string | null;
  /** The alternative price proposed by the challenger (human-readable, e.g., "123.45") */
  challengedPrice: number;
  /** The bond amount escrowed by the challenger in USDC (human-readable) */
  bondEscrowed: number;
  /** Whether the challenge has been resolved */
  resolved: boolean;
  /** Whether the challenger won (only meaningful if resolved === true) */
  challengerWon: boolean;
}

interface UseChallengerInfoOptions {
  /** Polling interval in milliseconds. Set to 0 to disable polling. Default: 15000 (15s) */
  pollInterval?: number;
  /** Whether to start fetching immediately. Default: true */
  enabled?: boolean;
}

const ACTIVE_CHALLENGE_ABI = [
  {
    type: 'function' as const,
    name: 'getActiveChallengeInfo' as const,
    stateMutability: 'view' as const,
    inputs: [],
    outputs: [
      { type: 'bool', name: 'active' },
      { type: 'address', name: 'challengerAddr' },
      { type: 'uint256', name: 'challengedPriceVal' },
      { type: 'uint256', name: 'bondEscrowed' },
      { type: 'bool', name: 'resolved' },
      { type: 'bool', name: 'won' },
    ],
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

/**
 * Hook to read challenger information from a HyperLiquid market contract.
 * 
 * Returns the challenger's address, their proposed price, and bond amount.
 * 
 * @example
 * ```tsx
 * const { data, isLoading, error, refetch } = useChallengerInfo(marketAddress);
 * 
 * if (data?.hasActiveChallenge) {
 *   console.log(`Challenged by ${data.challengerAddress}`);
 *   console.log(`Bond: $${data.bondEscrowed} USDC`);
 * }
 * ```
 * 
 * NOTE: Currently using ETH testnet. The contract interface (MarketLifecycleFacet)
 * will remain consistent when migrating to HyperLiquid mainnet.
 */
export function useChallengerInfo(
  marketAddress: string | null | undefined,
  options: UseChallengerInfoOptions = {}
) {
  const { pollInterval = 15_000, enabled = true } = options;

  const [data, setData] = useState<ChallengerInfo | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const fetchChallengerInfo = useCallback(async () => {
    if (!marketAddress || typeof marketAddress !== 'string') {
      setData(null);
      return;
    }

    if (!marketAddress.startsWith('0x') || marketAddress.length !== 42) {
      setData(null);
      return;
    }

    try {
      setIsLoading(true);
      setError(null);

      const result = await publicClient.readContract({
        address: marketAddress as `0x${string}`,
        abi: ACTIVE_CHALLENGE_ABI,
        functionName: 'getActiveChallengeInfo',
        args: [],
      });

      const [active, challengerAddr, challengedPriceVal, bondEscrowed, resolved, won] = result;

      setData({
        hasActiveChallenge: Boolean(active),
        challengerAddress: challengerAddr && challengerAddr !== ZERO_ADDRESS ? challengerAddr : null,
        challengedPrice: Number(challengedPriceVal) / 1e6,
        bondEscrowed: Number(bondEscrowed) / 1e6,
        resolved: Boolean(resolved),
        challengerWon: Boolean(won),
      });
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [marketAddress]);

  useEffect(() => {
    if (!enabled || !marketAddress) {
      setData(null);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (cancelled) return;
      await fetchChallengerInfo();
      if (!cancelled && pollInterval > 0) {
        timeoutId = setTimeout(poll, pollInterval);
      }
    };

    void poll();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [marketAddress, enabled, pollInterval, fetchChallengerInfo]);

  return {
    data,
    isLoading,
    error,
    refetch: fetchChallengerInfo,
  };
}

/**
 * Standalone function to fetch challenger info (for server-side or one-off reads).
 * 
 * NOTE: Currently using ETH testnet. When migrating to HyperLiquid:
 * - Pass a HyperLiquid-compatible viem client
 * - The ABI remains the same
 */
export async function fetchChallengerInfo(
  marketAddress: string
): Promise<ChallengerInfo | null> {
  if (!marketAddress?.startsWith('0x') || marketAddress.length !== 42) {
    return null;
  }

  try {
    const result = await publicClient.readContract({
      address: marketAddress as `0x${string}`,
      abi: ACTIVE_CHALLENGE_ABI,
      functionName: 'getActiveChallengeInfo',
      args: [],
    });

    const [active, challengerAddr, challengedPriceVal, bondEscrowed, resolved, won] = result;

    return {
      hasActiveChallenge: Boolean(active),
      challengerAddress: challengerAddr && challengerAddr !== ZERO_ADDRESS ? challengerAddr : null,
      challengedPrice: Number(challengedPriceVal) / 1e6,
      bondEscrowed: Number(bondEscrowed) / 1e6,
      resolved: Boolean(resolved),
      challengerWon: Boolean(won),
    };
  } catch {
    return null;
  }
}

export default useChallengerInfo;
