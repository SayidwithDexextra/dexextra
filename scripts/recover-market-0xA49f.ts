/**
 * Recovery script for market 0xA49f178dF3747691C2568E04f457Dc35919E7cC4
 * 
 * This script:
 * 1. Checks on-chain state of the partially configured market
 * 2. Completes any missing configuration (bond exemptions failed due to nonce error)
 * 3. Saves the market to Supabase via the finalize endpoint
 * 
 * Usage: npx tsx scripts/recover-market-0xA49f.ts
 */

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local
config({ path: resolve(process.cwd(), '.env.local') });

const MARKET_ADDRESS = '0xA49f178dF3747691C2568E04f457Dc35919E7cC4';

// Market metadata from the failed creation logs
const MARKET_METADATA = {
  symbol: 'XPD-1D', // Update if different
  metricUrl: '', // Will need to be provided or fetched from draft
  settlementTs: 1808802319, // From logs: settlement=1808802319
  startPrice: '1000000', // 6 decimals, adjust as needed
  dataSource: 'User Provided',
  tags: [] as string[],
  speedRunConfig: {
    rolloverLeadSeconds: 2592000, // From logs: rollover=2592000s
    challengeWindowSeconds: 86400, // From logs: challenge=86400s
  },
};

async function main() {
  console.log('='.repeat(70));
  console.log('MARKET RECOVERY SCRIPT');
  console.log('='.repeat(70));
  console.log(`Market: ${MARKET_ADDRESS}`);
  console.log();

  const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL;
  const pk = process.env.ADMIN_PRIVATE_KEY;
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  const sessionRegistryAddress = process.env.SESSION_REGISTRY_ADDRESS;

  if (!rpcUrl) throw new Error('RPC_URL not configured');
  if (!pk) throw new Error('ADMIN_PRIVATE_KEY not configured');
  if (!coreVaultAddress) throw new Error('CORE_VAULT_ADDRESS not configured');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const ownerAddress = await wallet.getAddress();

  console.log(`Owner: ${ownerAddress}`);
  console.log(`CoreVault: ${coreVaultAddress}`);
  console.log();

  // ══════════════════════════════════════════════════════════════════════
  // STEP 1: Check on-chain state
  // ══════════════════════════════════════════════════════════════════════
  console.log('STEP 1: Checking on-chain state...');
  console.log('-'.repeat(70));

  const checks: { name: string; pass: boolean; value?: any }[] = [];

  // Check CoreVault roles
  const coreVault = new ethers.Contract(coreVaultAddress, [
    'function hasRole(bytes32,address) view returns (bool)',
  ], provider);
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

  const hasOrderbookRole = await coreVault.hasRole(ORDERBOOK_ROLE, MARKET_ADDRESS);
  const hasSettlementRole = await coreVault.hasRole(SETTLEMENT_ROLE, MARKET_ADDRESS);
  checks.push({ name: 'CoreVault.ORDERBOOK_ROLE', pass: hasOrderbookRole, value: hasOrderbookRole });
  checks.push({ name: 'CoreVault.SETTLEMENT_ROLE', pass: hasSettlementRole, value: hasSettlementRole });

  // Check session registry
  if (sessionRegistryAddress) {
    const registry = new ethers.Contract(sessionRegistryAddress, [
      'function allowedOrderbook(address) view returns (bool)',
    ], provider);
    const isAllowed = await registry.allowedOrderbook(MARKET_ADDRESS).catch(() => false);
    checks.push({ name: 'SessionRegistry.allowedOrderbook', pass: isAllowed, value: isAllowed });

    const market = new ethers.Contract(MARKET_ADDRESS, [
      'function sessionRegistry() view returns (address)',
    ], provider);
    const registryOnMarket = await market.sessionRegistry().catch(() => ethers.ZeroAddress);
    const registryMatches = registryOnMarket.toLowerCase() === sessionRegistryAddress.toLowerCase();
    checks.push({ name: 'Market.sessionRegistry', pass: registryMatches, value: registryOnMarket });
  }

  // Check fee configuration
  const feeContract = new ethers.Contract(MARKET_ADDRESS, [
    'function getTradingParameters() view returns (uint256,uint256,address)',
    'function getFeeStructure() view returns (uint256,uint256,address,uint256)',
  ], provider);
  
  try {
    const [marginBps, tradingFee, feeRecipient] = await feeContract.getTradingParameters();
    checks.push({ name: 'TradingParameters.feeRecipient', pass: feeRecipient !== ethers.ZeroAddress, value: feeRecipient });
  } catch (e: any) {
    checks.push({ name: 'TradingParameters', pass: false, value: e?.message });
  }

  try {
    const [takerBps, makerBps, protocolRecipient, shareBps] = await feeContract.getFeeStructure();
    checks.push({ name: 'FeeStructure.configured', pass: Number(takerBps) > 0 || Number(makerBps) > 0, value: { takerBps: Number(takerBps), makerBps: Number(makerBps) } });
  } catch (e: any) {
    checks.push({ name: 'FeeStructure', pass: false, value: e?.message });
  }

  // Check lifecycle
  const lifecycleContract = new ethers.Contract(MARKET_ADDRESS, [
    'function getLifecycleConfig() view returns (uint256 settlementTimestamp, address parentMarket, bool devMode, uint256 rolloverLeadSeconds, uint256 challengeWindowSeconds)',
    'function getChallengeBondConfig() view returns (uint256 bondAmount, address slashRecipient)',
    'function isLifecycleOperator(address) view returns (bool)',
  ], provider);

  try {
    const [settlementTs, parent, devMode, rollover, challenge] = await lifecycleContract.getLifecycleConfig();
    checks.push({ name: 'Lifecycle.initialized', pass: Number(settlementTs) > 0, value: { settlementTs: Number(settlementTs), rollover: Number(rollover), challenge: Number(challenge) } });
  } catch (e: any) {
    checks.push({ name: 'Lifecycle', pass: false, value: e?.message });
  }

  try {
    const [bondAmount, slashRecipient] = await lifecycleContract.getChallengeBondConfig();
    checks.push({ name: 'ChallengeBond.configured', pass: BigInt(bondAmount) > 0n, value: { bondUsdc: Number(bondAmount) / 1e6, slashRecipient } });
  } catch (e: any) {
    checks.push({ name: 'ChallengeBond', pass: false, value: e?.message });
  }

  // Check lifecycle operators
  const { loadRelayerPoolFromEnv } = await import('../src/lib/relayerKeys');
  let relayerKeys = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
  if (!relayerKeys.length) {
    relayerKeys = loadRelayerPoolFromEnv({ pool: 'global_for_ops', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
  }

  if (relayerKeys.length > 0) {
    const sampleAddr = relayerKeys[0].address;
    const isOperator = await lifecycleContract.isLifecycleOperator(sampleAddr).catch(() => false);
    checks.push({ name: 'LifecycleOperators.registered', pass: isOperator, value: { sample: sampleAddr, isOperator } });
  }

  // Print results
  console.log();
  for (const check of checks) {
    const status = check.pass ? '✓' : '✗';
    const color = check.pass ? '\x1b[32m' : '\x1b[31m';
    console.log(`${color}${status}\x1b[0m ${check.name}: ${JSON.stringify(check.value)}`);
  }
  console.log();

  const failedChecks = checks.filter(c => !c.pass);
  if (failedChecks.length === 0) {
    console.log('\x1b[32mAll on-chain configuration is complete!\x1b[0m');
  } else {
    console.log(`\x1b[33m${failedChecks.length} checks failed - may need fixing\x1b[0m`);
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 2: Fix missing configuration (if needed)
  // ══════════════════════════════════════════════════════════════════════
  console.log();
  console.log('STEP 2: Fixing missing configuration...');
  console.log('-'.repeat(70));

  const fixes: { name: string; tx?: string; error?: string }[] = [];

  // Fix bond exemptions if operators are registered but not exempt
  if (relayerKeys.length > 0) {
    const bondExemptContract = new ethers.Contract(MARKET_ADDRESS, [
      'function isProposalBondExempt(address) view returns (bool)',
      'function setProposalBondExemptBatch(address[],bool) external',
    ], wallet);

    const sampleExempt = await bondExemptContract.isProposalBondExempt(relayerKeys[0].address).catch(() => false);
    if (!sampleExempt) {
      console.log('Bond exemptions missing - fixing...');
      try {
        const addrs = relayerKeys.map(k => k.address);
        const tx = await bondExemptContract.setProposalBondExemptBatch(addrs, true);
        console.log(`  TX sent: ${tx.hash}`);
        await tx.wait();
        console.log('  \x1b[32m✓ Bond exemptions granted\x1b[0m');
        fixes.push({ name: 'Bond exemptions', tx: tx.hash });
      } catch (e: any) {
        console.log(`  \x1b[31m✗ Failed: ${e?.message}\x1b[0m`);
        fixes.push({ name: 'Bond exemptions', error: e?.message });
      }
    } else {
      console.log('\x1b[32m✓ Bond exemptions already configured\x1b[0m');
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // STEP 3: Save to Supabase
  // ══════════════════════════════════════════════════════════════════════
  console.log();
  console.log('STEP 3: Saving to Supabase...');
  console.log('-'.repeat(70));

  // Check if market already exists
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.log('\x1b[33mSupabase not configured - skipping database save\x1b[0m');
    console.log('To save manually, call the finalize API endpoint.');
    return;
  }

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Check if already saved
  const { data: existingMarket } = await supabase
    .from('markets')
    .select('id, symbol, market_status')
    .eq('market_address', MARKET_ADDRESS)
    .maybeSingle();

  if (existingMarket) {
    console.log(`\x1b[32mMarket already exists in Supabase:\x1b[0m`);
    console.log(`  ID: ${existingMarket.id}`);
    console.log(`  Symbol: ${existingMarket.symbol}`);
    console.log(`  Status: ${existingMarket.market_status}`);
    return;
  }

  // Need to fetch draft data or use defaults
  console.log('Market not found in Supabase - checking for draft...');

  const { data: draft } = await supabase
    .from('market_drafts')
    .select('*')
    .or(`pipeline_state->deploy->orderBook.eq.${MARKET_ADDRESS},form_data->orderBook.eq.${MARKET_ADDRESS}`)
    .maybeSingle();

  let finalizePayload: any;

  if (draft) {
    console.log(`Found draft: ${draft.id}`);
    const formData = draft.form_data || {};
    const deployState = draft.pipeline_state?.deploy || {};
    
    finalizePayload = {
      draftId: draft.id,
      orderBook: MARKET_ADDRESS,
      marketId: deployState.marketIdBytes32 || '',
      transactionHash: deployState.transactionHash || '',
      blockNumber: deployState.blockNumber || null,
      chainId: deployState.chainId || Number(process.env.CHAIN_ID || 999),
      symbol: formData.symbol || draft.symbol || MARKET_METADATA.symbol,
      metricUrl: formData.metricUrl || formData.metric_url || '',
      startPrice: formData.startPrice || '1',
      dataSource: formData.dataSource || 'User Provided',
      tags: formData.tags || [],
      settlementDate: MARKET_METADATA.settlementTs,
      name: formData.name || `${MARKET_METADATA.symbol} Futures`,
      description: formData.description || '',
      creatorWalletAddress: formData.creatorWalletAddress || draft.creator_wallet_address,
      speedRunConfig: MARKET_METADATA.speedRunConfig,
    };
  } else {
    console.log('\x1b[33mNo draft found - using default metadata\x1b[0m');
    console.log('Please update MARKET_METADATA in this script with correct values.');
    
    finalizePayload = {
      orderBook: MARKET_ADDRESS,
      symbol: MARKET_METADATA.symbol,
      metricUrl: MARKET_METADATA.metricUrl,
      startPrice: MARKET_METADATA.startPrice,
      dataSource: MARKET_METADATA.dataSource,
      tags: MARKET_METADATA.tags,
      settlementDate: MARKET_METADATA.settlementTs,
      name: `${MARKET_METADATA.symbol} Futures`,
      description: '',
      chainId: Number(process.env.CHAIN_ID || 999),
      speedRunConfig: MARKET_METADATA.speedRunConfig,
    };
  }

  console.log();
  console.log('Finalize payload:');
  console.log(JSON.stringify(finalizePayload, null, 2));
  console.log();

  // Call finalize endpoint
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  console.log(`Calling ${appUrl}/api/markets/finalize...`);

  const response = await fetch(`${appUrl}/api/markets/finalize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(finalizePayload),
  });

  const result = await response.json();

  if (response.ok && result.ok) {
    console.log('\x1b[32m✓ Market saved to Supabase!\x1b[0m');
    console.log(`  Market ID: ${result.marketId}`);
    console.log(`  Symbol: ${result.symbol}`);
  } else {
    console.log('\x1b[31m✗ Failed to save market\x1b[0m');
    console.log(JSON.stringify(result, null, 2));
  }

  console.log();
  console.log('='.repeat(70));
  console.log('RECOVERY COMPLETE');
  console.log('='.repeat(70));
}

main().catch((e) => {
  console.error('Recovery failed:', e);
  process.exit(1);
});
