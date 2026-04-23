import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const maxDuration = 300;

const OBBatchSettlementFacetABI = [
  "function initBatchSettlement(uint256 finalPrice) external",
  "function batchCancelBuyOrders(uint256 maxOrders) external returns (bool complete, uint256 cancelledCount)",
  "function batchCancelSellOrders(uint256 maxOrders) external returns (bool complete, uint256 cancelledCount)",
  "function runVaultBatchCalculation(uint256 batchSize) external returns (bool complete)",
  "function runVaultBatchApplication(uint256 batchSize) external returns (bool complete)",
  "function finalizeVaultHaircut() external",
  "function completeSettlement() external",
  "function getSettlementProgress() external view returns (uint256 buyOrdersRemaining, uint256 sellOrdersRemaining, uint8 currentPhase, uint256 cursor, uint256 total)",
];

const OBSettlementFacetABI = [
  "function isSettled() external view returns (bool)",
  "function settleMarket(uint256 finalPrice) external",
];

const MarketLifecycleFacetABI = [
  "function getProposedSettlementPrice() external view returns (uint256 price, address proposer, bool proposed)",
  "function isLifecycleDevMode() external view returns (bool)",
  "function setLifecycleDevMode(bool enabled) external",
];

interface BatchSettleRequest {
  marketAddress: string;
  finalPrice?: string;
  orderBatchSize?: number;
  calcBatchSize?: number;
  applyBatchSize?: number;
  tryRegularFirst?: boolean;
}

interface PhaseResult {
  phase: string;
  success: boolean;
  batches?: number;
  gasUsed?: string;
  error?: string;
}

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const clientSecret = req.headers.get('x-admin-secret') || '';
  if (clientSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const body: BatchSettleRequest = await req.json().catch(() => ({}));
  const { 
    marketAddress, 
    finalPrice,
    orderBatchSize = 10,
    calcBatchSize = 10,
    applyBatchSize = 10,
    tryRegularFirst = false,
  } = body;

  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    return NextResponse.json({ error: 'Valid marketAddress required' }, { status: 400 });
  }

  const rpcUrl = process.env.HYPERLIQUID_RPC_URL || process.env.RPC_URL;
  // Use ADMIN_PRIVATE_KEY (Diamond owner) for settlement operations
  const privateKey = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY_DEPLOYER;

  if (!rpcUrl || !privateKey) {
    return NextResponse.json({ error: 'RPC_URL or PRIVATE_KEY not configured' }, { status: 500 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(privateKey, provider);

    const obSettlement = new ethers.Contract(marketAddress, OBSettlementFacetABI, wallet);
    const obBatchSettlement = new ethers.Contract(marketAddress, OBBatchSettlementFacetABI, wallet);
    const lifecycle = new ethers.Contract(marketAddress, MarketLifecycleFacetABI, wallet);

    // Check if already settled
    const isSettled = await obSettlement.isSettled();
    if (isSettled) {
      return NextResponse.json({ 
        success: true, 
        message: 'Market is already settled',
        alreadySettled: true 
      });
    }

    // Enable dev mode if not already enabled (allows bypassing timestamp checks)
    let devModeEnabled = false;
    try {
      devModeEnabled = await lifecycle.isLifecycleDevMode();
      console.log('[batch-settle] Current dev mode status:', devModeEnabled);
      if (!devModeEnabled) {
        console.log('[batch-settle] Enabling dev mode for settlement...');
        const devTx = await lifecycle.setLifecycleDevMode(true);
        const devReceipt = await devTx.wait();
        console.log('[batch-settle] Dev mode enabled, tx:', devReceipt.hash);
        devModeEnabled = true;
        
        // Verify it was enabled
        const verifyDevMode = await lifecycle.isLifecycleDevMode();
        console.log('[batch-settle] Verified dev mode:', verifyDevMode);
      }
    } catch (e: any) {
      console.error('[batch-settle] Dev mode error:', e.reason || e.shortMessage || e.message?.substring(0, 200));
      // Don't continue if we can't enable dev mode - it will fail anyway
      return NextResponse.json({ 
        error: 'Failed to enable dev mode: ' + (e.reason || e.shortMessage || e.message?.substring(0, 100)),
        hint: 'Make sure the wallet is the market owner'
      }, { status: 500 });
    }

    // Determine final price
    let settlementPrice: bigint;
    if (finalPrice) {
      settlementPrice = ethers.parseUnits(finalPrice, 6);
    } else {
      const [proposedPrice, , proposed] = await lifecycle.getProposedSettlementPrice();
      if (!proposed || proposedPrice === 0n) {
        return NextResponse.json({ 
          error: 'No finalPrice provided and no proposed settlement price found' 
        }, { status: 400 });
      }
      settlementPrice = proposedPrice;
    }

    const results: PhaseResult[] = [];
    let totalGas = 0n;
    let totalTxs = 0;

    // Try regular settlement first if requested
    if (tryRegularFirst) {
      try {
        const gasEstimate = await obSettlement.settleMarket.estimateGas(settlementPrice);
        
        if (gasEstimate < 15_000_000n) {
          const tx = await obSettlement.settleMarket(settlementPrice, { gasLimit: 20_000_000n });
          const receipt = await tx.wait();
          
          return NextResponse.json({
            success: true,
            method: 'regular',
            message: 'Regular settlement succeeded',
            gasUsed: receipt.gasUsed.toString(),
            txHash: receipt.hash,
          });
        }
        
        results.push({
          phase: 'regular_estimate',
          success: false,
          error: `Gas estimate ${gasEstimate.toString()} exceeds limit, falling back to batch`,
        });
      } catch (e: any) {
        results.push({
          phase: 'regular_attempt',
          success: false,
          error: e.reason || e.message?.substring(0, 100),
        });
      }
    }

    // Phase 0: Initialize batch settlement
    console.log('[batch-settle] Initializing batch settlement with price:', ethers.formatUnits(settlementPrice, 6));
    console.log('[batch-settle] Market address:', marketAddress);
    console.log('[batch-settle] Wallet address:', wallet.address);
    
    // Pre-flight check: verify the function exists and estimate gas
    try {
      const gasEstimate = await obBatchSettlement.initBatchSettlement.estimateGas(settlementPrice);
      console.log('[batch-settle] Gas estimate for initBatchSettlement:', gasEstimate.toString());
    } catch (estErr: any) {
      console.error('[batch-settle] Pre-flight gas estimate failed:', estErr.reason || estErr.shortMessage || estErr.message?.substring(0, 200));
      return NextResponse.json({
        error: 'initBatchSettlement pre-flight failed: ' + (estErr.reason || estErr.shortMessage || 'unknown'),
        details: estErr.message?.substring(0, 300),
      }, { status: 500 });
    }
    
    let tx = await obBatchSettlement.initBatchSettlement(settlementPrice);
    let receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    totalTxs++;
    results.push({ phase: 'init', success: true, gasUsed: receipt.gasUsed.toString() });

    // Phase 1a: Cancel buy orders
    let complete = false;
    let batchNum = 0;
    while (!complete) {
      const result = await obBatchSettlement.batchCancelBuyOrders.staticCall(orderBatchSize);
      tx = await obBatchSettlement.batchCancelBuyOrders(orderBatchSize);
      receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      totalTxs++;
      complete = result[0];
      batchNum++;
    }
    results.push({ phase: 'cancel_buy_orders', success: true, batches: batchNum });

    // Phase 1b: Cancel sell orders
    complete = false;
    batchNum = 0;
    while (!complete) {
      const result = await obBatchSettlement.batchCancelSellOrders.staticCall(orderBatchSize);
      tx = await obBatchSettlement.batchCancelSellOrders(orderBatchSize);
      receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      totalTxs++;
      complete = result[0];
      batchNum++;
    }
    results.push({ phase: 'cancel_sell_orders', success: true, batches: batchNum });

    // Phase 2: Calculate totals
    complete = false;
    batchNum = 0;
    while (!complete) {
      complete = await obBatchSettlement.runVaultBatchCalculation.staticCall(calcBatchSize);
      tx = await obBatchSettlement.runVaultBatchCalculation(calcBatchSize);
      receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      totalTxs++;
      batchNum++;
    }
    results.push({ phase: 'calculate_totals', success: true, batches: batchNum });

    // Phase 3: Finalize haircut
    tx = await obBatchSettlement.finalizeVaultHaircut();
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    totalTxs++;
    results.push({ phase: 'finalize_haircut', success: true, gasUsed: receipt.gasUsed.toString() });

    // Phase 4: Apply settlements
    complete = false;
    batchNum = 0;
    while (!complete) {
      complete = await obBatchSettlement.runVaultBatchApplication.staticCall(applyBatchSize);
      tx = await obBatchSettlement.runVaultBatchApplication(applyBatchSize);
      receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      totalTxs++;
      batchNum++;
    }
    results.push({ phase: 'apply_settlements', success: true, batches: batchNum });

    // Phase 5: Complete
    tx = await obBatchSettlement.completeSettlement();
    receipt = await tx.wait();
    totalGas += receipt.gasUsed;
    totalTxs++;
    results.push({ phase: 'complete', success: true, gasUsed: receipt.gasUsed.toString() });

    // Verify
    const finalSettled = await obSettlement.isSettled();

    return NextResponse.json({
      success: finalSettled,
      method: 'batch',
      message: finalSettled ? 'Batch settlement completed' : 'Settlement may have failed',
      totalTransactions: totalTxs,
      totalGasUsed: totalGas.toString(),
      phases: results,
      settlementPrice: ethers.formatUnits(settlementPrice, 6),
    });

  } catch (e: any) {
    console.error('[batch-settle] Error:', e);
    return NextResponse.json({ 
      error: e.reason || e.message?.substring(0, 200) || 'Unknown error',
      code: e.code,
    }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const clientSecret = req.headers.get('x-admin-secret') || '';
  if (clientSecret !== cronSecret) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 });
  }

  const marketAddress = req.nextUrl.searchParams.get('marketAddress');
  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    return NextResponse.json({ error: 'Valid marketAddress required' }, { status: 400 });
  }

  const rpcUrl = process.env.HYPERLIQUID_RPC_URL || process.env.RPC_URL;
  if (!rpcUrl) {
    return NextResponse.json({ error: 'RPC_URL not configured' }, { status: 500 });
  }

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const obSettlement = new ethers.Contract(marketAddress, OBSettlementFacetABI, provider);
    const obBatchSettlement = new ethers.Contract(marketAddress, OBBatchSettlementFacetABI, provider);
    const lifecycle = new ethers.Contract(marketAddress, MarketLifecycleFacetABI, provider);

    const isSettled = await obSettlement.isSettled();
    
    let progress = null;
    try {
      const [buyRemaining, sellRemaining, phase, cursor, total] = await obBatchSettlement.getSettlementProgress();
      progress = {
        buyOrdersRemaining: buyRemaining.toString(),
        sellOrdersRemaining: sellRemaining.toString(),
        currentPhase: Number(phase),
        cursor: cursor.toString(),
        total: total.toString(),
      };
    } catch {
      // Batch settlement not initialized
    }

    let proposedPrice = null;
    try {
      const [price, proposer, proposed] = await lifecycle.getProposedSettlementPrice();
      if (proposed) {
        proposedPrice = {
          price: ethers.formatUnits(price, 6),
          proposer,
        };
      }
    } catch {
      // No proposed price
    }

    let devModeEnabled = false;
    try {
      devModeEnabled = await lifecycle.isLifecycleDevMode();
    } catch {
      // Lifecycle not configured
    }

    return NextResponse.json({
      marketAddress,
      isSettled,
      batchProgress: progress,
      proposedPrice,
      devModeEnabled,
    });

  } catch (e: any) {
    return NextResponse.json({ 
      error: e.reason || e.message?.substring(0, 200) || 'Unknown error',
    }, { status: 500 });
  }
}
