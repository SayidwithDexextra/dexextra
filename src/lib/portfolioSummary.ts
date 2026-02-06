import type { Address, PublicClient } from 'viem';
import { formatUnits } from 'viem';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

export type PortfolioSummary = {
  /** Available margin/cash in USDC 6-decimals (raw) */
  availableCash6: bigint;
  /** Available margin/cash as a JS number (USDC) */
  availableCash: number;
  /** Total unrealized P&L across all positions (18 decimals raw) */
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
  {
    type: 'function',
    name: 'getUserPositions',
    stateMutability: 'view',
    inputs: [{ name: 'user', type: 'address' }],
    outputs: [
      {
        name: 'positions',
        type: 'tuple[]',
        components: [
          { name: 'marketId', type: 'bytes32' },
          { name: 'size', type: 'int256' },
          { name: 'entryPrice', type: 'uint256' },
          { name: 'marginLocked', type: 'uint256' },
          { name: 'socializedLossAccrued6', type: 'uint256' },
          { name: 'haircutUnits18', type: 'uint256' },
          { name: 'liquidationPrice', type: 'uint256' },
        ],
      },
    ],
  },
  {
    type: 'function',
    name: 'marketToOrderBook',
    stateMutability: 'view',
    inputs: [{ name: 'marketId', type: 'bytes32' }],
    outputs: [{ name: 'orderBook', type: 'address' }],
  },
] as const;

const OB_PRICING_ABI_MIN = [
  {
    type: 'function',
    name: 'calculateMarkPrice',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getMarketPriceData',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'uint256' },
      { type: 'bool' },
    ],
  },
] as const;

const OB_VIEW_ABI_MIN = [
  {
    type: 'function',
    name: 'bestBid',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'bestAsk',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const;

type RawPositionLike = any;

type NormalizedPosition = {
  marketId: `0x${string}`;
  size: bigint;
  entryPrice: bigint;
};

function normalizePositionStruct(p: RawPositionLike): NormalizedPosition | null {
  if (!p) return null;

  // viem tuple[] decoding can be array-like or object-like
  const marketId = (p.marketId ?? p[0]) as `0x${string}` | undefined;
  const size = (p.size ?? p[1]) as bigint | undefined;
  const entryPrice = (p.entryPrice ?? p[2]) as bigint | undefined;

  if (!marketId || typeof marketId !== 'string' || !marketId.startsWith('0x'))
    return null;
  if (size === undefined || entryPrice === undefined) return null;

  return { marketId, size: BigInt(size), entryPrice: BigInt(entryPrice) };
}

async function readMarkPrice6ForMarket(args: {
  client: PublicClient;
  coreVaultAddress: Address;
  marketId: `0x${string}`;
}): Promise<bigint> {
  const { client, coreVaultAddress, marketId } = args;

  let orderBook: Address | null = null;
  try {
    orderBook = (await client.readContract({
      address: coreVaultAddress,
      abi: CORE_VAULT_ABI_MIN,
      functionName: 'marketToOrderBook',
      args: [marketId],
    })) as Address;
  } catch {
    orderBook = null;
  }

  if (!orderBook || orderBook === '0x0000000000000000000000000000000000000000') {
    return 0n;
  }

  // Primary: calculateMarkPrice()
  try {
    const mark = (await client.readContract({
      address: orderBook,
      abi: OB_PRICING_ABI_MIN,
      functionName: 'calculateMarkPrice',
      args: [],
    })) as bigint;
    if (mark > 0n) return mark;
  } catch {
    // continue
  }

  // Secondary: getMarketPriceData() – mark price is commonly index 4
  try {
    const mp = (await client.readContract({
      address: orderBook,
      abi: OB_PRICING_ABI_MIN,
      functionName: 'getMarketPriceData',
      args: [],
    })) as readonly unknown[];
    const candidate = (Array.isArray(mp) ? (mp[4] as any) : 0n) as bigint;
    if (candidate && BigInt(candidate) > 0n) return BigInt(candidate);
  } catch {
    // continue
  }

  // Fallback: (bestBid + bestAsk) / 2 when available
  try {
    const [bestBid, bestAsk] = await Promise.all([
      client.readContract({
        address: orderBook,
        abi: OB_VIEW_ABI_MIN,
        functionName: 'bestBid',
        args: [],
      }) as Promise<bigint>,
      client.readContract({
        address: orderBook,
        abi: OB_VIEW_ABI_MIN,
        functionName: 'bestAsk',
        args: [],
      }) as Promise<bigint>,
    ]);
    if (bestBid > 0n && bestAsk > 0n && bestAsk < 2n ** 255n) {
      return (bestBid + bestAsk) / 2n;
    }
  } catch {
    // ignore
  }

  return 0n;
}

// Small concurrency limiter to avoid hammering RPC when user has many positions.
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = new Array(Math.max(1, limit)).fill(null).map(async () => {
    while (true) {
      const idx = i++;
      if (idx >= items.length) break;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchPortfolioSummary(args: {
  client: PublicClient;
  userAddress: Address;
  coreVaultAddress?: Address;
}): Promise<PortfolioSummary> {
  const { client, userAddress } = args;
  const coreVaultAddress =
    args.coreVaultAddress || (CONTRACT_ADDRESSES.CORE_VAULT as Address);

  const updatedAt = Date.now();

  // 1) Available cash from unified summary (6 decimals)
  const marginSummary = (await client.readContract({
    address: coreVaultAddress,
    abi: CORE_VAULT_ABI_MIN,
    functionName: 'getUnifiedMarginSummary',
    args: [userAddress],
  })) as readonly unknown[];
  const availableCash6 = BigInt((marginSummary as any)?.[3] ?? 0n);
  const availableCash = Number(formatUnits(availableCash6, 6));

  // 2) Real-time unrealized P&L (18 decimals) from positions + onchain mark price per market
  const rawPositions = (await client.readContract({
    address: coreVaultAddress,
    abi: CORE_VAULT_ABI_MIN,
    functionName: 'getUserPositions',
    args: [userAddress],
  })) as readonly RawPositionLike[];

  const positions = (rawPositions || [])
    .map(normalizePositionStruct)
    .filter(Boolean) as NormalizedPosition[];

  const pnl18ByPos = await mapLimit(positions, 4, async (p) => {
    const markPrice6 = await readMarkPrice6ForMarket({
      client,
      coreVaultAddress,
      marketId: p.marketId,
    });
    if (markPrice6 <= 0n) return 0n;

    // Same formula as interactive trader / contracts:
    // pnl18 = (markPrice6 - entryPrice6) * size18 / 1e6
    const priceDiff6 = markPrice6 - p.entryPrice; // 6 decimals
    return (priceDiff6 * p.size) / 1_000_000n;
  });

  const unrealizedPnl18 = pnl18ByPos.reduce((acc, v) => acc + v, 0n);
  const unrealizedPnl = Number(formatUnits(unrealizedPnl18, 18));

  return {
    availableCash6,
    availableCash,
    unrealizedPnl18,
    unrealizedPnl,
    updatedAt,
  };
}

