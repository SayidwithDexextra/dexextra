import type { Address, PublicClient } from 'viem';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

export type PortfolioSummary = {
  /** Total collateral in USDC 6-decimals (raw) */
  totalCollateral6: bigint;
  /** Total collateral as a JS number (USDC) */
  totalCollateral: number;
  /** Available margin/cash in USDC 6-decimals (raw) */
  availableCash6: bigint;
  /** Available margin/cash as a JS number (USDC) */
  availableCash: number;
  /** Realized P&L from CoreVault unified summary (18 decimals raw) */
  realizedPnl18: bigint;
  /** Realized P&L as a JS number (USDC) */
  realizedPnl: number;
  /** Unrealized P&L from CoreVault unified summary (18 decimals raw) */
  unrealizedPnl18: bigint;
  /** Total unrealized P&L as a JS number (USDC) */
  unrealizedPnl: number;
  /** Timestamp (ms) when computed */
  updatedAt: number;
};

const CORE_VAULT_ABI_MIN = [
  {
    type: 'function',
    name: 'getUnifiedMarginSummary',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      { name: 'totalCollateral', type: 'uint256' },
      { name: 'marginUsed', type: 'uint256' },
      { name: 'marginReserved', type: 'uint256' },
      { name: 'availableCollateral', type: 'uint256' },
      { name: 'realizedPnL', type: 'int256' },
      { name: 'unrealizedPnL', type: 'int256' },
      { name: 'totalCommitted', type: 'uint256' },
      { name: 'isHealthy', type: 'bool' },
    ],
  },
] as const;

export async function fetchPortfolioSummary(args: {
  client: PublicClient;
  userAddress: Address;
  coreVaultAddress?: Address;
}): Promise<PortfolioSummary> {
  const { client, userAddress } = args;
  const coreVaultAddress =
    args.coreVaultAddress || (CONTRACT_ADDRESSES.CORE_VAULT as Address);

  const updatedAt = Date.now();

  // Single read: unified summary provides both available cash (6d) and unrealized P&L (18d).
  const marginSummary = (await client.readContract({
    address: coreVaultAddress,
    abi: CORE_VAULT_ABI_MIN,
    functionName: 'getUnifiedMarginSummary',
    args: [userAddress],
  })) as readonly unknown[];

  const totalCollateral6 = BigInt((marginSummary as any)?.[0] ?? 0n);
  const totalCollateral = Number(formatUnits(totalCollateral6, 6));
  const availableCash6 = BigInt((marginSummary as any)?.[3] ?? 0n);
  const availableCash = Number(formatUnits(availableCash6, 6));
  const realizedPnl18 = BigInt((marginSummary as any)?.[4] ?? 0n);
  const realizedPnl = Number(formatUnits(realizedPnl18, 18));
  const unrealizedPnl18 = BigInt((marginSummary as any)?.[5] ?? 0n);
  const unrealizedPnl = Number(formatUnits(unrealizedPnl18, 18));

  return {
    totalCollateral6,
    totalCollateral,
    availableCash6,
    availableCash,
    realizedPnl18,
    realizedPnl,
    unrealizedPnl18,
    unrealizedPnl,
    updatedAt,
  };
}

