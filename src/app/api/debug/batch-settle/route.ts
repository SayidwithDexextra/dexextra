import { NextRequest, NextResponse } from 'next/server';
import { ethers } from 'ethers';

export const runtime = 'nodejs';
export const maxDuration = 300;

// ANSI color codes for terminal logging
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

const log = {
  header: (msg: string) => console.log(`\n${colors.bgBlue}${colors.white}${colors.bright} BATCH-SETTLE ${colors.reset} ${colors.blue}${msg}${colors.reset}`),
  phase: (phase: string, msg: string) => console.log(`${colors.bgMagenta}${colors.white} ${phase.toUpperCase()} ${colors.reset} ${colors.magenta}${msg}${colors.reset}`),
  tx: (hash: string, gas?: string) => console.log(`  ${colors.green}✓${colors.reset} ${colors.cyan}tx:${colors.reset} ${colors.bright}${hash}${colors.reset}${gas ? ` ${colors.dim}(${gas} gas)${colors.reset}` : ''}`),
  batch: (num: number, hash: string) => console.log(`  ${colors.yellow}⚡${colors.reset} ${colors.dim}batch ${num}:${colors.reset} ${colors.bright}${hash.substring(0, 18)}...${colors.reset}`),
  info: (msg: string) => console.log(`  ${colors.blue}ℹ${colors.reset} ${colors.dim}${msg}${colors.reset}`),
  success: (msg: string) => console.log(`${colors.bgGreen}${colors.black} SUCCESS ${colors.reset} ${colors.green}${msg}${colors.reset}`),
  error: (msg: string) => console.log(`${colors.bgRed}${colors.white} ERROR ${colors.reset} ${colors.red}${msg}${colors.reset}`),
  warn: (msg: string) => console.log(`${colors.bgYellow}${colors.black} WARN ${colors.reset} ${colors.yellow}${msg}${colors.reset}`),
  wallet: (label: string, address: string) => console.log(`  ${colors.cyan}${label}:${colors.reset} ${colors.bright}${address}${colors.reset}`),
  progress: (current: number, total: number, label: string) => {
    const pct = total > 0 ? Math.round((current / total) * 100) : 0;
    const bar = '█'.repeat(Math.floor(pct / 5)) + '░'.repeat(20 - Math.floor(pct / 5));
    console.log(`  ${colors.dim}${label}${colors.reset} [${colors.green}${bar}${colors.reset}] ${pct}%`);
  },
};

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
  resumeFromPhase?: boolean; // If true, detect and resume from current batch phase
}

interface PhaseResult {
  phase: string;
  success: boolean;
  batches?: number;
  gasUsed?: string;
  error?: string;
  txHash?: string;
  txHashes?: string[];
}

interface StreamEvent {
  type: 'phase_start' | 'tx' | 'batch_tx' | 'phase_complete' | 'error' | 'complete' | 'info';
  phase?: string;
  txHash?: string;
  batchNum?: number;
  totalBatches?: number;
  gasUsed?: string;
  message?: string;
  data?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const body: BatchSettleRequest = await req.json().catch(() => ({}));
  const { 
    marketAddress, 
    finalPrice,
    orderBatchSize = 10,
    calcBatchSize = 10,
    applyBatchSize = 10,
    tryRegularFirst = false,
    resumeFromPhase = false,
  } = body;

  if (!marketAddress || !ethers.isAddress(marketAddress)) {
    return NextResponse.json({ error: 'Valid marketAddress required' }, { status: 400 });
  }

  const rpcUrl = process.env.HYPERLIQUID_RPC_URL || process.env.RPC_URL;
  const adminPrivateKey = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY_DEPLOYER;
  
  let relayerPrivateKey: string | undefined;
  const smallRelayersJson = process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON;
  
  if (smallRelayersJson) {
    try {
      const relayerKeys = JSON.parse(smallRelayersJson) as string[];
      if (relayerKeys.length > 0) {
        const randomIndex = Math.floor(Math.random() * relayerKeys.length);
        relayerPrivateKey = relayerKeys[randomIndex];
        log.info(`Using small relayer ${randomIndex + 1}/${relayerKeys.length} for batch ops`);
      }
    } catch (parseErr: any) {
      log.warn(`Failed to parse small relayer keys: ${parseErr.message}`);
      log.info(`Raw value (first 100 chars): ${smallRelayersJson.substring(0, 100)}...`);
    }
  }
  
  if (!relayerPrivateKey) {
    relayerPrivateKey = adminPrivateKey;
    log.info('No small relayers configured, using admin key for all');
  }

  if (!rpcUrl || !adminPrivateKey) {
    return NextResponse.json({ error: 'RPC_URL or ADMIN_PRIVATE_KEY not configured' }, { status: 500 });
  }

  // Create streaming response using ReadableStream
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let streamClosed = false;

  const sendEvent = (event: StreamEvent) => {
    if (streamClosed || !controller) return;
    try {
      controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
    } catch {
      streamClosed = true;
    }
  };

  const closeStream = () => {
    if (streamClosed || !controller) return;
    streamClosed = true;
    try {
      controller.close();
    } catch {
      // Already closed
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;
    },
    cancel() {
      streamClosed = true;
    },
  });

  // Start the settlement process in the background
  (async () => {
    try {
      log.header(`Starting batch settlement for ${marketAddress.substring(0, 10)}...`);
      
      const provider = new ethers.JsonRpcProvider(rpcUrl);
      const adminWallet = new ethers.Wallet(adminPrivateKey, provider);
      const relayerWallet = new ethers.Wallet(relayerPrivateKey, provider);
      
      log.wallet('Admin', adminWallet.address);
      log.wallet('Relayer', relayerWallet.address);

      const obSettlement = new ethers.Contract(marketAddress, OBSettlementFacetABI, relayerWallet);
      const obBatchSettlement = new ethers.Contract(marketAddress, OBBatchSettlementFacetABI, relayerWallet);
      const lifecycle = new ethers.Contract(marketAddress, MarketLifecycleFacetABI, adminWallet);

      // Check if already settled
      const isSettled = await obSettlement.isSettled();
      if (isSettled) {
        log.success('Market is already settled');
        sendEvent({ type: 'complete', message: 'Market is already settled', data: { alreadySettled: true } });
        closeStream();
        return;
      }

      // Check for existing batch in progress
      let existingPhase = 0;
      let existingBuyRemaining = 0n;
      let existingSellRemaining = 0n;
      try {
        const [buyRemaining, sellRemaining, phase] = await obBatchSettlement.getSettlementProgress();
        existingPhase = Number(phase);
        existingBuyRemaining = buyRemaining;
        existingSellRemaining = sellRemaining;
        if (existingPhase > 0) {
          log.warn(`Existing batch in progress at phase ${existingPhase} (buy orders: ${buyRemaining}, sell orders: ${sellRemaining})`);
          sendEvent({ type: 'info', message: `Existing batch detected at phase ${existingPhase}` });
        }
      } catch {
        // No batch in progress, getSettlementProgress might not exist or return default
      }

      // Enable dev mode if not already enabled
      log.phase('dev_mode', 'Checking dev mode status...');
      let devModeEnabled = false;
      try {
        devModeEnabled = await lifecycle.isLifecycleDevMode();
        log.info(`Current dev mode: ${devModeEnabled ? 'ENABLED' : 'DISABLED'}`);
        
        if (!devModeEnabled) {
          log.phase('dev_mode', 'Enabling dev mode for settlement...');
          sendEvent({ type: 'phase_start', phase: 'dev_mode', message: 'Enabling dev mode...' });
          
          const devTx = await lifecycle.setLifecycleDevMode(true);
          const devReceipt = await devTx.wait();
          log.tx(devReceipt.hash, devReceipt.gasUsed.toString());
          sendEvent({ type: 'tx', phase: 'dev_mode', txHash: devReceipt.hash, gasUsed: devReceipt.gasUsed.toString() });
          devModeEnabled = true;
          
          const verifyDevMode = await lifecycle.isLifecycleDevMode();
          log.success(`Dev mode verified: ${verifyDevMode}`);
        }
      } catch (e: any) {
        log.error(`Dev mode error: ${e.reason || e.shortMessage || e.message?.substring(0, 200)}`);
        sendEvent({ type: 'error', message: 'Failed to enable dev mode: ' + (e.reason || e.shortMessage || e.message?.substring(0, 100)) });
        closeStream();
        return;
      }

      // Determine final price
      let settlementPrice: bigint;
      if (finalPrice) {
        settlementPrice = ethers.parseUnits(finalPrice, 6);
      } else {
        const [proposedPrice, , proposed] = await lifecycle.getProposedSettlementPrice();
        if (!proposed || proposedPrice === 0n) {
          log.error('No finalPrice provided and no proposed settlement price found');
          sendEvent({ type: 'error', message: 'No finalPrice provided and no proposed settlement price found' });
          closeStream();
          return;
        }
        settlementPrice = proposedPrice;
      }

      const results: PhaseResult[] = [];
      let totalGas = 0n;
      let totalTxs = 0;

      sendEvent({ type: 'info', message: `Settlement price: $${ethers.formatUnits(settlementPrice, 6)}` });
      log.info(`Settlement price: $${ethers.formatUnits(settlementPrice, 6)}`);

      // Try regular settlement first if requested (only if no batch in progress)
      if (tryRegularFirst && existingPhase === 0) {
        log.phase('regular', 'Attempting regular settlement first...');
        sendEvent({ type: 'phase_start', phase: 'regular', message: 'Attempting regular settlement...' });
        
        try {
          const gasEstimate = await obSettlement.settleMarket.estimateGas(settlementPrice);
          log.info(`Regular settlement gas estimate: ${gasEstimate.toString()}`);
          
          if (gasEstimate < 15_000_000n) {
            const tx = await obSettlement.settleMarket(settlementPrice, { gasLimit: 20_000_000n });
            const receipt = await tx.wait();
            log.tx(receipt.hash, receipt.gasUsed.toString());
            log.success('Regular settlement succeeded!');
            
            sendEvent({ type: 'tx', phase: 'regular', txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
            sendEvent({ 
              type: 'complete', 
              message: 'Regular settlement succeeded', 
              data: { method: 'regular', gasUsed: receipt.gasUsed.toString(), txHash: receipt.hash }
            });
            closeStream();
            return;
          }
          
          log.warn(`Gas estimate ${gasEstimate.toString()} exceeds limit, falling back to batch`);
          results.push({ phase: 'regular_estimate', success: false, error: `Gas estimate ${gasEstimate.toString()} exceeds limit` });
        } catch (e: any) {
          log.warn(`Regular settlement failed: ${e.reason || e.message?.substring(0, 100)}`);
          results.push({ phase: 'regular_attempt', success: false, error: e.reason || e.message?.substring(0, 100) });
        }
        sendEvent({ type: 'info', message: 'Regular settlement failed, proceeding with batch settlement' });
      }

      let tx;
      let receipt;

      // Phase 0: Initialize batch settlement (skip if resuming)
      // Phase mapping: 0=not started, 1=cancelling orders, 2=calculating, 3=finalizing haircut, 4=applying, 5=complete
      const shouldResume = resumeFromPhase && existingPhase > 0;
      
      if (shouldResume) {
        log.info(`Resuming from existing batch at phase ${existingPhase}`);
        sendEvent({ type: 'info', message: `Resuming batch from phase ${existingPhase}` });
      } else if (existingPhase > 0) {
        log.error(`Batch already in progress at phase ${existingPhase}. Use resumeFromPhase=true to continue, or wait for it to complete/abort.`);
        sendEvent({ type: 'error', message: `Batch already in progress at phase ${existingPhase}. Enable "Resume from phase" to continue.` });
        closeStream();
        return;
      } else {
        log.phase('init', `Initializing batch settlement @ $${ethers.formatUnits(settlementPrice, 6)}`);
        sendEvent({ type: 'phase_start', phase: 'init', message: 'Initializing batch settlement...' });
        
        try {
          const gasEstimate = await obBatchSettlement.initBatchSettlement.estimateGas(settlementPrice);
          log.info(`Gas estimate for init: ${gasEstimate.toString()}`);
        } catch (estErr: any) {
          log.error(`Pre-flight gas estimate failed: ${estErr.reason || estErr.shortMessage || estErr.message?.substring(0, 200)}`);
          sendEvent({ type: 'error', message: 'initBatchSettlement pre-flight failed: ' + (estErr.reason || estErr.shortMessage || 'unknown') });
          closeStream();
          return;
        }
        
        tx = await obBatchSettlement.initBatchSettlement(settlementPrice);
        receipt = await tx.wait();
        totalGas += receipt.gasUsed;
        totalTxs++;
        log.tx(receipt.hash, receipt.gasUsed.toString());
        sendEvent({ type: 'tx', phase: 'init', txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
        results.push({ phase: 'init', success: true, gasUsed: receipt.gasUsed.toString(), txHash: receipt.hash });
        sendEvent({ type: 'phase_complete', phase: 'init', message: 'Initialization complete' });
      }

      // Phase 1a: Cancel buy orders (phase 1 in contract)
      // Skip if we're resuming and already past this phase, or if no buy orders remain
      let complete = false;
      let batchNum = 0;
      let batchTxHashes: string[] = [];
      
      if (shouldResume && existingPhase > 1) {
        log.info('Skipping cancel_buy_orders (already complete)');
        sendEvent({ type: 'info', message: 'Skipping cancel buy orders (already complete)' });
      } else {
        log.phase('cancel_buy', 'Cancelling buy orders...');
        sendEvent({ type: 'phase_start', phase: 'cancel_buy_orders', message: 'Cancelling buy orders...' });
        
        while (!complete) {
          const result = await obBatchSettlement.batchCancelBuyOrders.staticCall(orderBatchSize);
          tx = await obBatchSettlement.batchCancelBuyOrders(orderBatchSize);
          receipt = await tx.wait();
          totalGas += receipt.gasUsed;
          totalTxs++;
          batchNum++;
          batchTxHashes.push(receipt.hash);
          complete = result[0];
          
          log.batch(batchNum, receipt.hash);
          sendEvent({ type: 'batch_tx', phase: 'cancel_buy_orders', txHash: receipt.hash, batchNum, gasUsed: receipt.gasUsed.toString() });
        }
        log.success(`Cancel buy orders complete (${batchNum} batches)`);
        results.push({ phase: 'cancel_buy_orders', success: true, batches: batchNum, txHashes: batchTxHashes });
        sendEvent({ type: 'phase_complete', phase: 'cancel_buy_orders', totalBatches: batchNum });
      }

      // Phase 1b: Cancel sell orders
      if (shouldResume && existingPhase > 1) {
        log.info('Skipping cancel_sell_orders (already complete)');
        sendEvent({ type: 'info', message: 'Skipping cancel sell orders (already complete)' });
      } else {
        log.phase('cancel_sell', 'Cancelling sell orders...');
        sendEvent({ type: 'phase_start', phase: 'cancel_sell_orders', message: 'Cancelling sell orders...' });
        
        complete = false;
        batchNum = 0;
        batchTxHashes = [];
        while (!complete) {
          const result = await obBatchSettlement.batchCancelSellOrders.staticCall(orderBatchSize);
          tx = await obBatchSettlement.batchCancelSellOrders(orderBatchSize);
          receipt = await tx.wait();
          totalGas += receipt.gasUsed;
          totalTxs++;
          batchNum++;
          batchTxHashes.push(receipt.hash);
          complete = result[0];
          
          log.batch(batchNum, receipt.hash);
          sendEvent({ type: 'batch_tx', phase: 'cancel_sell_orders', txHash: receipt.hash, batchNum, gasUsed: receipt.gasUsed.toString() });
        }
        log.success(`Cancel sell orders complete (${batchNum} batches)`);
        results.push({ phase: 'cancel_sell_orders', success: true, batches: batchNum, txHashes: batchTxHashes });
        sendEvent({ type: 'phase_complete', phase: 'cancel_sell_orders', totalBatches: batchNum });
      }

      // Phase 2: Calculate totals
      if (shouldResume && existingPhase > 2) {
        log.info('Skipping calculate_totals (already complete)');
        sendEvent({ type: 'info', message: 'Skipping calculate totals (already complete)' });
      } else {
        log.phase('calculate', 'Running vault batch calculation...');
        sendEvent({ type: 'phase_start', phase: 'calculate_totals', message: 'Calculating totals...' });
        
        complete = false;
        batchNum = 0;
        batchTxHashes = [];
        while (!complete) {
          complete = await obBatchSettlement.runVaultBatchCalculation.staticCall(calcBatchSize);
          tx = await obBatchSettlement.runVaultBatchCalculation(calcBatchSize);
          receipt = await tx.wait();
          totalGas += receipt.gasUsed;
          totalTxs++;
          batchNum++;
          batchTxHashes.push(receipt.hash);
          
          log.batch(batchNum, receipt.hash);
          sendEvent({ type: 'batch_tx', phase: 'calculate_totals', txHash: receipt.hash, batchNum, gasUsed: receipt.gasUsed.toString() });
        }
        log.success(`Calculate totals complete (${batchNum} batches)`);
        results.push({ phase: 'calculate_totals', success: true, batches: batchNum, txHashes: batchTxHashes });
        sendEvent({ type: 'phase_complete', phase: 'calculate_totals', totalBatches: batchNum });
      }

      // Phase 3: Finalize haircut
      if (shouldResume && existingPhase > 3) {
        log.info('Skipping finalize_haircut (already complete)');
        sendEvent({ type: 'info', message: 'Skipping finalize haircut (already complete)' });
      } else {
        log.phase('haircut', 'Finalizing vault haircut...');
        sendEvent({ type: 'phase_start', phase: 'finalize_haircut', message: 'Finalizing haircut...' });
        
        tx = await obBatchSettlement.finalizeVaultHaircut();
        receipt = await tx.wait();
        totalGas += receipt.gasUsed;
        totalTxs++;
        log.tx(receipt.hash, receipt.gasUsed.toString());
        sendEvent({ type: 'tx', phase: 'finalize_haircut', txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
        results.push({ phase: 'finalize_haircut', success: true, gasUsed: receipt.gasUsed.toString(), txHash: receipt.hash });
        sendEvent({ type: 'phase_complete', phase: 'finalize_haircut' });
      }

      // Phase 4: Apply settlements
      if (shouldResume && existingPhase > 4) {
        log.info('Skipping apply_settlements (already complete)');
        sendEvent({ type: 'info', message: 'Skipping apply settlements (already complete)' });
      } else {
        log.phase('apply', 'Applying settlements to vaults...');
        sendEvent({ type: 'phase_start', phase: 'apply_settlements', message: 'Applying settlements...' });
        
        complete = false;
        batchNum = 0;
        batchTxHashes = [];
        while (!complete) {
          complete = await obBatchSettlement.runVaultBatchApplication.staticCall(applyBatchSize);
          tx = await obBatchSettlement.runVaultBatchApplication(applyBatchSize);
          receipt = await tx.wait();
          totalGas += receipt.gasUsed;
          totalTxs++;
          batchNum++;
          batchTxHashes.push(receipt.hash);
          
          log.batch(batchNum, receipt.hash);
          sendEvent({ type: 'batch_tx', phase: 'apply_settlements', txHash: receipt.hash, batchNum, gasUsed: receipt.gasUsed.toString() });
        }
        log.success(`Apply settlements complete (${batchNum} batches)`);
        results.push({ phase: 'apply_settlements', success: true, batches: batchNum, txHashes: batchTxHashes });
        sendEvent({ type: 'phase_complete', phase: 'apply_settlements', totalBatches: batchNum });
      }

      // Phase 5: Complete
      log.phase('complete', 'Completing settlement...');
      sendEvent({ type: 'phase_start', phase: 'complete', message: 'Completing settlement...' });
      
      tx = await obBatchSettlement.completeSettlement();
      receipt = await tx.wait();
      totalGas += receipt.gasUsed;
      totalTxs++;
      log.tx(receipt.hash, receipt.gasUsed.toString());
      sendEvent({ type: 'tx', phase: 'complete', txHash: receipt.hash, gasUsed: receipt.gasUsed.toString() });
      results.push({ phase: 'complete', success: true, gasUsed: receipt.gasUsed.toString(), txHash: receipt.hash });

      // Verify
      const finalSettled = await obSettlement.isSettled();

      if (finalSettled) {
        log.success(`🎉 Batch settlement completed successfully!`);
        log.info(`Total transactions: ${totalTxs}`);
        log.info(`Total gas used: ${totalGas.toString()}`);
      } else {
        log.error('Settlement verification failed - market may not be fully settled');
      }

      sendEvent({ 
        type: 'complete', 
        message: finalSettled ? 'Batch settlement completed' : 'Settlement may have failed',
        data: {
          success: finalSettled,
          method: 'batch',
          resumed: shouldResume,
          totalTransactions: totalTxs,
          totalGasUsed: totalGas.toString(),
          phases: results,
          settlementPrice: ethers.formatUnits(settlementPrice, 6),
        }
      });
      
    } catch (e: any) {
      log.error(`Unexpected error: ${e.reason || e.message || 'Unknown'}`);
      console.error(e);
      sendEvent({ type: 'error', message: e.reason || e.message?.substring(0, 200) || 'Unknown error' });
    } finally {
      closeStream();
    }
  })();

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}

export async function GET(req: NextRequest) {
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
