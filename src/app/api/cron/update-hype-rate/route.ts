import { NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const maxDuration = 30;

const FeeRegistryABI = [
  'function admin() external view returns (address)',
  'function hypeUsdcRate6() external view returns (uint256)',
  'function maxGasFee6() external view returns (uint256)',
  'function gasEstimate() external view returns (uint256)',
  'function getGasFeeConfig() external view returns (uint256, uint256, uint256)',
  'function updateGasFeeConfig(uint256 _hypeUsdcRate6, uint256 _maxGasFee6, uint256 _gasEstimate) external',
];

async function fetchHypePrice(): Promise<{ price: number; source: string } | null> {
  // Use the existing token-prices API which has HYPE mapped to CoinGecko
  const appUrl = process.env.APP_URL || process.env.VERCEL_URL || 'http://localhost:3000';
  const baseUrl = appUrl.startsWith('http') ? appUrl : `https://${appUrl}`;
  
  try {
    const res = await fetch(`${baseUrl}/api/token-prices?tokens=HYPE`, {
      headers: { 'Accept': 'application/json' },
      next: { revalidate: 0 },
    });
    
    if (!res.ok) {
      console.warn(`[update-hype-rate] token-prices API returned ${res.status}`);
      return null;
    }
    
    const data = await res.json();
    if (data?.HYPE?.price && data.HYPE.price > 0) {
      return { price: data.HYPE.price, source: 'token-prices-api' };
    }
  } catch (e) {
    console.warn('[update-hype-rate] Failed to fetch from token-prices API:', e);
  }
  
  return null;
}

function usdToRate6(usd: number): bigint {
  return BigInt(Math.round(usd * 1_000_000));
}

function rate6ToUsd(rate6: bigint): number {
  return Number(rate6) / 1_000_000;
}

/**
 * POST /api/cron/update-hype-rate
 * 
 * Updates the HYPE/USDC conversion rate in the FeeRegistry.
 * Triggered by Upstash cron or manually.
 * 
 * Body (optional):
 *   { "rate": 25.50 }           - Set specific rate instead of fetching
 *   { "maxFee": 1.50 }          - Also update max gas fee cap
 *   { "dryRun": true }          - Preview without sending tx
 * 
 * Headers:
 *   Authorization: Bearer <CRON_SECRET>  - Required for security
 */
export async function POST(request: Request) {
  try {
    // Verify cron secret
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const dryRun = body.dryRun === true;
    const manualRate = typeof body.rate === 'number' ? body.rate : null;
    const manualMaxFee = typeof body.maxFee === 'number' ? body.maxFee : null;

    // Config
    const rpcUrl = process.env.RPC_URL;
    const privateKey = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY_DEPLOYER;
    const feeRegistryAddress = process.env.FEE_REGISTRY_ADDRESS;

    if (!rpcUrl || !privateKey || !feeRegistryAddress) {
      return NextResponse.json({
        ok: false,
        error: 'Missing config: RPC_URL, ADMIN_PRIVATE_KEY, or FEE_REGISTRY_ADDRESS',
      }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);
    const feeRegistry = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, wallet);

    // Verify admin
    const admin = await feeRegistry.admin();
    if (admin.toLowerCase() !== wallet.address.toLowerCase()) {
      return NextResponse.json({
        ok: false,
        error: `Signer ${wallet.address} is not FeeRegistry admin (${admin})`,
      }, { status: 403 });
    }

    // Get current config
    const [currentRate6, currentMax6, currentGasEstimate] = await feeRegistry.getGasFeeConfig();
    const currentRateUsd = rate6ToUsd(currentRate6);
    const currentMaxUsd = rate6ToUsd(currentMax6);

    // Determine new rate
    let newRateUsd: number;
    let priceSource: string;

    if (manualRate !== null) {
      newRateUsd = manualRate;
      priceSource = 'manual';
    } else {
      const fetched = await fetchHypePrice();
      if (!fetched) {
        return NextResponse.json({
          ok: false,
          error: 'Failed to fetch HYPE price from any source',
          current: { rate: currentRateUsd, maxFee: currentMaxUsd },
        }, { status: 502 });
      }
      newRateUsd = fetched.price;
      priceSource = fetched.source;
    }

    // Skip if change is less than 1%
    const changePercent = Math.abs(newRateUsd - currentRateUsd) / currentRateUsd * 100;
    if (currentRateUsd > 0 && changePercent < 1 && manualRate === null) {
      return NextResponse.json({
        ok: true,
        action: 'skipped',
        reason: `Price change (${changePercent.toFixed(2)}%) below 1% threshold`,
        current: { rate: currentRateUsd, maxFee: currentMaxUsd },
        fetched: { rate: newRateUsd, source: priceSource },
      });
    }

    const newRate6 = usdToRate6(newRateUsd);
    const newMax6 = manualMaxFee !== null ? usdToRate6(manualMaxFee) : currentMax6;
    const newMaxUsd = rate6ToUsd(newMax6);

    if (dryRun) {
      return NextResponse.json({
        ok: true,
        action: 'dry_run',
        current: { rate: currentRateUsd, maxFee: currentMaxUsd },
        proposed: { rate: newRateUsd, maxFee: newMaxUsd, source: priceSource },
      });
    }

    // Send transaction (preserve existing gasEstimate)
    const tx = await feeRegistry.updateGasFeeConfig(newRate6, newMax6, currentGasEstimate);
    const receipt = await tx.wait();

    console.log(`[update-hype-rate] Updated: $${currentRateUsd.toFixed(4)} → $${newRateUsd.toFixed(4)} (${priceSource}), tx: ${tx.hash}`);

    return NextResponse.json({
      ok: true,
      action: 'updated',
      previous: { rate: currentRateUsd, maxFee: currentMaxUsd },
      new: { rate: newRateUsd, maxFee: newMaxUsd, source: priceSource },
      tx: tx.hash,
      block: receipt.blockNumber,
    });

  } catch (err: any) {
    console.error('[update-hype-rate] Error:', err?.message || err);
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal error' },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/update-hype-rate
 * 
 * Returns current gas fee config without updating.
 */
export async function GET() {
  try {
    const rpcUrl = process.env.RPC_URL;
    const feeRegistryAddress = process.env.FEE_REGISTRY_ADDRESS;

    if (!rpcUrl || !feeRegistryAddress) {
      return NextResponse.json({
        ok: false,
        error: 'Missing config: RPC_URL or FEE_REGISTRY_ADDRESS',
      }, { status: 500 });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const feeRegistry = new ethers.Contract(feeRegistryAddress, FeeRegistryABI, provider);

    const [rate6, max6, gasEstimate] = await feeRegistry.getGasFeeConfig();

    return NextResponse.json({
      ok: true,
      config: {
        hypeUsdcRate: rate6ToUsd(rate6),
        maxGasFee: rate6ToUsd(max6),
        gasEstimate: gasEstimate.toString(),
        raw: {
          hypeUsdcRate6: rate6.toString(),
          maxGasFee6: max6.toString(),
          gasEstimate: gasEstimate.toString(),
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
