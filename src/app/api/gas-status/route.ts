import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

/**
 * GET /api/gas-status
 *
 * Reports live HyperEVM base-fee state for the small and big block lanes and
 * a `recommend: 'small' | 'big'` field that BOTH `/api/gasless/trade` and the
 * trading-panel banner mirror, so server routing and visible UI state can
 * never disagree.
 *
 * Why two lanes?
 *   HyperEVM ships two independent execution lanes with INDEPENDENT EIP-1559
 *   base fees:
 *     - small blocks (gas limit ≤ ~3M, one every ~1s)  → fast confirmation
 *     - big   blocks (gas limit ~30M, one every ~60s) → high throughput
 *   During congestion the small-block lane can rise from 0.1 → 10+ gwei while
 *   big-block base fee stays pinned at the 0.10 gwei floor because almost
 *   nobody competes for big-block space. Verified empirically:
 *   2026-05-14 16:59 UTC, small=6.7 gwei vs big=0.10 gwei (60× cheaper).
 *
 * Tunable (single env var):
 *   HYPEREVM_BIG_BLOCK_THRESHOLD_GWEI — small-block base fee above which we
 *     declare "congested" and route orders through big blocks. Defaults to
 *     2.0 gwei. Set to a very large value (e.g. 9999) to effectively disable
 *     congestion routing.
 *
 * Everything else (cache TTL, reference gas, base-fee floor, HYPE/USD source)
 * is intentionally hard-coded so there's only one knob to think about.
 */

// ─── The one tunable ────────────────────────────────────────────────────────
const BIG_BLOCK_THRESHOLD_GWEI = (() => {
  const raw = String(process.env.HYPEREVM_BIG_BLOCK_THRESHOLD_GWEI || '').trim();
  if (!raw) return 2.0;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 2.0;
})();

// ─── Internal constants (do not surface as env vars) ────────────────────────
const CACHE_TTL_MS = 5_000;
// 1.5M gas is the upper end of a place + match + execute + rest tx on HyperEVM.
// Used only for the "estimated cost" hint shown in the congestion banner.
const REFERENCE_GAS = 1_500_000;
// HyperEVM's protocol-enforced minimum base fee.
const BASE_FEE_FLOOR_GWEI = 0.1;

// ─── HYPE/USD: read from the existing FeeRegistry contract on-chain ─────────
// FeeRegistry.hypeUsdcRate6() returns the current HYPE→USDC rate scaled by 1e6
// and is kept in sync by /api/cron/update-hype-rate. Using the on-chain value
// removes a config knob and guarantees the banner shows the same USD figure
// that the protocol uses for gas fee accounting.
const FEE_REGISTRY_ABI = ['function hypeUsdcRate6() view returns (uint256)'];

type GasStatusBody = {
  ok: true;
  timestamp: number;
  blockNumber: number;
  smallBaseFeeGwei: number;
  bigBaseFeeGwei: number;
  baseFeeFloorGwei: number;
  thresholdGwei: number;
  /** 'normal' = no banner, 'severe' = banner + big-block routing. */
  level: 'normal' | 'severe';
  /** Mirrors `level`. Trade route reads the same threshold server-side. */
  recommend: 'small' | 'big';
  costEstimate: {
    referenceGas: number;
    hypeUsd: number | null;
    smallHype: number;
    smallUsd: number | null;
    bigHype: number;
    bigUsd: number | null;
  };
  /** Cache age in ms (0 means served fresh from RPC). */
  cacheAgeMs: number;
};

type CachedResult = { value: GasStatusBody; fetchedAt: number };
let cache: CachedResult | null = null;
let inFlight: Promise<GasStatusBody> | null = null;

function classify(smallBaseFeeGwei: number): {
  level: 'normal' | 'severe';
  recommend: 'small' | 'big';
} {
  if (smallBaseFeeGwei > BIG_BLOCK_THRESHOLD_GWEI) {
    return { level: 'severe', recommend: 'big' };
  }
  return { level: 'normal', recommend: 'small' };
}

async function fetchHypeUsd(provider: ethers.JsonRpcProvider): Promise<number | null> {
  const addr =
    process.env.FEE_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_FEE_REGISTRY_ADDRESS;
  if (!addr || !ethers.isAddress(addr)) return null;
  try {
    const reg = new ethers.Contract(addr, FEE_REGISTRY_ABI, provider);
    const raw: bigint = await reg.hypeUsdcRate6();
    if (raw <= 0n) return null;
    return Number(raw) / 1e6;
  } catch {
    return null;
  }
}

async function fetchLiveStatus(): Promise<GasStatusBody> {
  const rpcUrl =
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.HYPERLIQUID_RPC_URL ||
    process.env.RPC_URL ||
    process.env.RPC_URL_HYPEREVM;
  if (!rpcUrl) throw new Error('No HyperEVM RPC URL configured');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const latestNumber = await provider.getBlockNumber();
  const latest = await provider.getBlock(latestNumber);
  if (!latest) throw new Error('Failed to fetch latest block');

  const latestLimit = Number(latest.gasLimit);
  const latestIsBig = latestLimit > 5_000_000;
  const latestBaseGwei = latest.baseFeePerGas
    ? Number(latest.baseFeePerGas) / 1e9
    : BASE_FEE_FLOOR_GWEI;

  // Walk back up to ~120 blocks to find one of the opposite lane. Big blocks
  // land every ~60s while small blocks tick every ~1s, so scanning 120 small
  // blocks lands a recent big block almost always.
  let small = latestIsBig ? null : latestBaseGwei;
  let big = latestIsBig ? latestBaseGwei : null;
  let smallBlockNumber = latestIsBig ? null : latestNumber;
  let bigBlockNumber = latestIsBig ? latestNumber : null;

  for (let offset = 1; offset <= 120 && (small === null || big === null); offset++) {
    const b = await provider.getBlock(latestNumber - offset).catch(() => null);
    if (!b) continue;
    const isBig = Number(b.gasLimit) > 5_000_000;
    const gwei = b.baseFeePerGas ? Number(b.baseFeePerGas) / 1e9 : BASE_FEE_FLOOR_GWEI;
    if (isBig && big === null) {
      big = gwei;
      bigBlockNumber = b.number;
    } else if (!isBig && small === null) {
      small = gwei;
      smallBlockNumber = b.number;
    }
  }

  const smallBaseFeeGwei = small ?? BASE_FEE_FLOOR_GWEI;
  const bigBaseFeeGwei = big ?? BASE_FEE_FLOOR_GWEI;
  const { level, recommend } = classify(smallBaseFeeGwei);

  const hypeUsd = await fetchHypeUsd(provider);
  const smallHype = (REFERENCE_GAS * smallBaseFeeGwei) / 1e9;
  const bigHype = (REFERENCE_GAS * bigBaseFeeGwei) / 1e9;

  return {
    ok: true,
    timestamp: Date.now(),
    blockNumber: smallBlockNumber ?? bigBlockNumber ?? latestNumber,
    smallBaseFeeGwei,
    bigBaseFeeGwei,
    baseFeeFloorGwei: BASE_FEE_FLOOR_GWEI,
    thresholdGwei: BIG_BLOCK_THRESHOLD_GWEI,
    level,
    recommend,
    costEstimate: {
      referenceGas: REFERENCE_GAS,
      hypeUsd,
      smallHype,
      smallUsd: hypeUsd !== null ? smallHype * hypeUsd : null,
      bigHype,
      bigUsd: hypeUsd !== null ? bigHype * hypeUsd : null,
    },
    cacheAgeMs: 0,
  };
}

async function getStatus(): Promise<GasStatusBody> {
  const now = Date.now();
  if (cache && now - cache.fetchedAt < CACHE_TTL_MS) {
    return { ...cache.value, cacheAgeMs: now - cache.fetchedAt };
  }
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const value = await fetchLiveStatus();
      cache = { value, fetchedAt: Date.now() };
      return value;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

export async function GET() {
  try {
    const body = await getStatus();
    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, max-age=3, stale-while-revalidate=10',
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      {
        ok: false,
        error: e?.shortMessage || e?.message || String(e),
      },
      { status: 500 },
    );
  }
}

export const dynamic = 'force-dynamic';
