/**
 * Complete configuration fix for market 0xA49f178dF3747691C2568E04f457Dc35919E7cC4
 * 
 * This script completes all missing on-chain configuration:
 * 1. Grant CoreVault roles (ORDERBOOK_ROLE, SETTLEMENT_ROLE)
 * 2. Configure session registry (allow + attach)
 * 3. Configure fees
 * 4. Initialize lifecycle
 * 5. Configure challenge bond
 * 6. Register lifecycle operators + bond exemptions
 * 
 * Usage: npx tsx scripts/fix-market-config-0xA49f.ts
 */

import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const MARKET_ADDRESS = '0xA49f178dF3747691C2568E04f457Dc35919E7cC4';
const SETTLEMENT_TS = 1808802319;
const ROLLOVER_LEAD = 2592000;
const CHALLENGE_WINDOW = 86400;

async function main() {
  console.log('='.repeat(70));
  console.log('COMPLETE MARKET CONFIGURATION');
  console.log('='.repeat(70));
  console.log(`Market: ${MARKET_ADDRESS}`);
  console.log();

  const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL;
  const adminPk = process.env.ADMIN_PRIVATE_KEY;
  const vaultAdminPk = process.env.ROLE_GRANTER_PRIVATE_KEY || process.env.RELAYER_PRIVATE_KEY || adminPk;
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  const sessionRegistryAddress = process.env.SESSION_REGISTRY_ADDRESS;
  const feeRegistryAddress = process.env.FEE_REGISTRY_ADDRESS;

  if (!rpcUrl) throw new Error('RPC_URL not configured');
  if (!adminPk) throw new Error('ADMIN_PRIVATE_KEY not configured');
  if (!coreVaultAddress) throw new Error('CORE_VAULT_ADDRESS not configured');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const adminWallet = new ethers.Wallet(adminPk, provider);
  const vaultWallet = new ethers.Wallet(vaultAdminPk!, provider);
  
  console.log(`Admin: ${await adminWallet.getAddress()}`);
  console.log(`Vault Admin: ${await vaultWallet.getAddress()}`);
  console.log();

  const results: { step: string; status: 'success' | 'error' | 'skipped'; details?: string }[] = [];

  // ══════════════════════════════════════════════════════════════════════
  // 1. Grant CoreVault roles
  // ══════════════════════════════════════════════════════════════════════
  console.log('1. Granting CoreVault roles...');
  
  // Try admin wallet first (may have DEFAULT_ADMIN_ROLE)
  const coreVault = new ethers.Contract(coreVaultAddress, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  ], adminWallet);
  
  // Check who has admin role
  const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
  const adminHasAdminRole = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, await adminWallet.getAddress());
  const vaultAdminHasAdminRole = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, await vaultWallet.getAddress());
  console.log(`   Admin has DEFAULT_ADMIN_ROLE: ${adminHasAdminRole}`);
  console.log(`   VaultAdmin has DEFAULT_ADMIN_ROLE: ${vaultAdminHasAdminRole}`);
  
  // Use whichever wallet has admin role
  const roleGranter = adminHasAdminRole ? adminWallet : (vaultAdminHasAdminRole ? vaultWallet : adminWallet);
  const coreVaultWithGranter = new ethers.Contract(coreVaultAddress, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
  ], roleGranter);
  console.log(`   Using ${await roleGranter.getAddress()} for role grants`);
  
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

  // ORDERBOOK_ROLE
  const hasOBRole = await coreVaultWithGranter.hasRole(ORDERBOOK_ROLE, MARKET_ADDRESS);
  if (!hasOBRole) {
    try {
      const tx = await coreVaultWithGranter.grantRole(ORDERBOOK_ROLE, MARKET_ADDRESS);
      console.log(`   ORDERBOOK_ROLE tx: ${tx.hash}`);
      await tx.wait();
      console.log('   ✓ ORDERBOOK_ROLE granted');
      results.push({ step: 'ORDERBOOK_ROLE', status: 'success', details: tx.hash });
    } catch (e: any) {
      console.log(`   ✗ ORDERBOOK_ROLE failed: ${e?.message}`);
      results.push({ step: 'ORDERBOOK_ROLE', status: 'error', details: e?.message });
    }
  } else {
    console.log('   ✓ ORDERBOOK_ROLE already granted');
    results.push({ step: 'ORDERBOOK_ROLE', status: 'skipped' });
  }

  // SETTLEMENT_ROLE
  const hasSRole = await coreVaultWithGranter.hasRole(SETTLEMENT_ROLE, MARKET_ADDRESS);
  if (!hasSRole) {
    try {
      const tx = await coreVaultWithGranter.grantRole(SETTLEMENT_ROLE, MARKET_ADDRESS);
      console.log(`   SETTLEMENT_ROLE tx: ${tx.hash}`);
      await tx.wait();
      console.log('   ✓ SETTLEMENT_ROLE granted');
      results.push({ step: 'SETTLEMENT_ROLE', status: 'success', details: tx.hash });
    } catch (e: any) {
      console.log(`   ✗ SETTLEMENT_ROLE failed: ${e?.message}`);
      results.push({ step: 'SETTLEMENT_ROLE', status: 'error', details: e?.message });
    }
  } else {
    console.log('   ✓ SETTLEMENT_ROLE already granted');
    results.push({ step: 'SETTLEMENT_ROLE', status: 'skipped' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 2. Configure session registry
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n2. Configuring session registry...');
  
  if (sessionRegistryAddress && ethers.isAddress(sessionRegistryAddress)) {
    const registry = new ethers.Contract(sessionRegistryAddress, [
      'function allowedOrderbook(address) view returns (bool)',
      'function setAllowedOrderbook(address,bool) external',
    ], adminWallet);

    const isAllowed = await registry.allowedOrderbook(MARKET_ADDRESS).catch(() => false);
    if (!isAllowed) {
      try {
        const tx = await registry.setAllowedOrderbook(MARKET_ADDRESS, true);
        console.log(`   Allow orderbook tx: ${tx.hash}`);
        await tx.wait();
        console.log('   ✓ Orderbook allowed on registry');
        results.push({ step: 'AllowOrderbook', status: 'success', details: tx.hash });
      } catch (e: any) {
        console.log(`   ✗ Allow orderbook failed: ${e?.message}`);
        results.push({ step: 'AllowOrderbook', status: 'error', details: e?.message });
      }
    } else {
      console.log('   ✓ Orderbook already allowed');
      results.push({ step: 'AllowOrderbook', status: 'skipped' });
    }

    // Attach session registry to market
    const market = new ethers.Contract(MARKET_ADDRESS, [
      'function sessionRegistry() view returns (address)',
      'function setSessionRegistry(address) external',
    ], adminWallet);

    const currentRegistry = await market.sessionRegistry().catch(() => ethers.ZeroAddress);
    if (currentRegistry.toLowerCase() !== sessionRegistryAddress.toLowerCase()) {
      try {
        const tx = await market.setSessionRegistry(sessionRegistryAddress);
        console.log(`   Set session registry tx: ${tx.hash}`);
        await tx.wait();
        console.log('   ✓ Session registry attached');
        results.push({ step: 'SetSessionRegistry', status: 'success', details: tx.hash });
      } catch (e: any) {
        console.log(`   ✗ Set session registry failed: ${e?.message}`);
        results.push({ step: 'SetSessionRegistry', status: 'error', details: e?.message });
      }
    } else {
      console.log('   ✓ Session registry already attached');
      results.push({ step: 'SetSessionRegistry', status: 'skipped' });
    }
  } else {
    console.log('   ⚠ SESSION_REGISTRY_ADDRESS not configured');
    results.push({ step: 'SessionRegistry', status: 'skipped', details: 'not configured' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 3. Configure fees
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n3. Configuring fees...');

  let takerFeeBps = 7;
  let makerFeeBps = 3;
  let protocolFeeRecipient = await adminWallet.getAddress();
  let protocolFeeShareBps = 8000;

  // Read from FeeRegistry if available
  if (feeRegistryAddress && ethers.isAddress(feeRegistryAddress)) {
    try {
      const feeRegistry = new ethers.Contract(feeRegistryAddress, [
        'function getFeeStructure() view returns (uint256,uint256,address,uint256)',
      ], provider);
      const [t, m, r, s] = await feeRegistry.getFeeStructure();
      takerFeeBps = Number(t);
      makerFeeBps = Number(m);
      protocolFeeRecipient = r;
      protocolFeeShareBps = Number(s);
      console.log(`   Read from FeeRegistry: taker=${takerFeeBps} maker=${makerFeeBps}`);
    } catch (e: any) {
      console.log(`   ⚠ FeeRegistry read failed, using defaults: ${e?.message}`);
    }
  }

  const feeContract = new ethers.Contract(MARKET_ADDRESS, [
    'function getFeeStructure() view returns (uint256,uint256,address,uint256)',
    'function updateFeeStructure(uint256,uint256,address,uint256) external',
  ], adminWallet);

  try {
    const [currentTaker] = await feeContract.getFeeStructure().catch(() => [0n]);
    if (Number(currentTaker) === 0) {
      const tx = await feeContract.updateFeeStructure(takerFeeBps, makerFeeBps, protocolFeeRecipient, protocolFeeShareBps);
      console.log(`   Update fee structure tx: ${tx.hash}`);
      await tx.wait();
      console.log('   ✓ Fee structure configured');
      results.push({ step: 'FeeStructure', status: 'success', details: tx.hash });
    } else {
      console.log('   ✓ Fee structure already configured');
      results.push({ step: 'FeeStructure', status: 'skipped' });
    }
  } catch (e: any) {
    console.log(`   ✗ Fee structure failed: ${e?.message}`);
    results.push({ step: 'FeeStructure', status: 'error', details: e?.message });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 4. Initialize lifecycle
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n4. Initializing lifecycle...');

  const lifecycleContract = new ethers.Contract(MARKET_ADDRESS, [
    'function getLifecycleConfig() view returns (uint256,address,bool,uint256,uint256)',
    'function initializeLifecycleWithTiming(uint256,address,bool,uint256,uint256) external',
  ], adminWallet);

  try {
    const [currentSettlement] = await lifecycleContract.getLifecycleConfig();
    if (Number(currentSettlement) === 0) {
      const tx = await lifecycleContract.initializeLifecycleWithTiming(
        SETTLEMENT_TS, ethers.ZeroAddress, false, ROLLOVER_LEAD, CHALLENGE_WINDOW
      );
      console.log(`   Initialize lifecycle tx: ${tx.hash}`);
      await tx.wait();
      console.log('   ✓ Lifecycle initialized');
      results.push({ step: 'InitializeLifecycle', status: 'success', details: tx.hash });
    } else {
      console.log('   ✓ Lifecycle already initialized');
      results.push({ step: 'InitializeLifecycle', status: 'skipped' });
    }
  } catch (e: any) {
    // May fail with FunctionDoesNotExist if selector not in registry - try anyway
    if (e?.message?.includes('FunctionDoesNotExist') || e?.data === '0xa9ad62f8') {
      console.log('   ⚠ getLifecycleConfig not found - attempting initialize anyway...');
      try {
        const tx = await lifecycleContract.initializeLifecycleWithTiming(
          SETTLEMENT_TS, ethers.ZeroAddress, false, ROLLOVER_LEAD, CHALLENGE_WINDOW
        );
        console.log(`   Initialize lifecycle tx: ${tx.hash}`);
        await tx.wait();
        console.log('   ✓ Lifecycle initialized');
        results.push({ step: 'InitializeLifecycle', status: 'success', details: tx.hash });
      } catch (e2: any) {
        if (e2?.message?.includes('already init')) {
          console.log('   ✓ Lifecycle already initialized');
          results.push({ step: 'InitializeLifecycle', status: 'skipped', details: 'already initialized' });
        } else {
          console.log(`   ✗ Initialize lifecycle failed: ${e2?.message}`);
          results.push({ step: 'InitializeLifecycle', status: 'error', details: e2?.message });
        }
      }
    } else {
      console.log(`   ✗ Lifecycle check failed: ${e?.message}`);
      results.push({ step: 'InitializeLifecycle', status: 'error', details: e?.message });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // 5. Configure challenge bond
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n5. Configuring challenge bond...');

  const CHALLENGE_BOND_USDC = 500_000_000; // 500 USDC
  const SLASH_RECIPIENT = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';

  const bondContract = new ethers.Contract(MARKET_ADDRESS, [
    'function getChallengeBondConfig() view returns (uint256,address)',
    'function setChallengeBondConfig(uint256,address) external',
  ], adminWallet);

  try {
    const [currentBond] = await bondContract.getChallengeBondConfig().catch(() => [0n]);
    if (BigInt(currentBond) === 0n) {
      const tx = await bondContract.setChallengeBondConfig(CHALLENGE_BOND_USDC, SLASH_RECIPIENT);
      console.log(`   Set challenge bond tx: ${tx.hash}`);
      await tx.wait();
      console.log('   ✓ Challenge bond configured');
      results.push({ step: 'ChallengeBond', status: 'success', details: tx.hash });
    } else {
      console.log('   ✓ Challenge bond already configured');
      results.push({ step: 'ChallengeBond', status: 'skipped' });
    }
  } catch (e: any) {
    console.log(`   ✗ Challenge bond failed: ${e?.message}`);
    results.push({ step: 'ChallengeBond', status: 'error', details: e?.message });
  }

  // ══════════════════════════════════════════════════════════════════════
  // 6. Register lifecycle operators + bond exemptions
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n6. Registering lifecycle operators...');

  const { loadRelayerPoolFromEnv } = await import('../src/lib/relayerKeys');
  let relayerKeys = loadRelayerPoolFromEnv({ pool: 'challenge', jsonEnv: 'RELAYER_PRIVATE_KEYS_CHALLENGE_JSON', allowFallbackSingleKey: false });
  if (!relayerKeys.length) {
    relayerKeys = loadRelayerPoolFromEnv({ pool: 'global_for_ops', globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON', allowFallbackSingleKey: true, excludeJsonEnvs: ['RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON'] });
  }

  if (relayerKeys.length > 0) {
    const addrs = relayerKeys.map(k => k.address);
    console.log(`   Found ${addrs.length} relayer addresses`);

    const opsContract = new ethers.Contract(MARKET_ADDRESS, [
      'function isLifecycleOperator(address) view returns (bool)',
      'function setLifecycleOperatorBatch(address[],bool) external',
      'function isProposalBondExempt(address) view returns (bool)',
      'function setProposalBondExemptBatch(address[],bool) external',
    ], adminWallet);

    // Operators
    const isOp = await opsContract.isLifecycleOperator(addrs[0]).catch(() => false);
    if (!isOp) {
      try {
        const tx = await opsContract.setLifecycleOperatorBatch(addrs, true);
        console.log(`   Set operators tx: ${tx.hash}`);
        await tx.wait();
        console.log('   ✓ Lifecycle operators registered');
        results.push({ step: 'LifecycleOperators', status: 'success', details: tx.hash });
      } catch (e: any) {
        console.log(`   ✗ Set operators failed: ${e?.message}`);
        results.push({ step: 'LifecycleOperators', status: 'error', details: e?.message });
      }
    } else {
      console.log('   ✓ Lifecycle operators already registered');
      results.push({ step: 'LifecycleOperators', status: 'skipped' });
    }

    // Bond exemptions
    const isExempt = await opsContract.isProposalBondExempt(addrs[0]).catch(() => false);
    if (!isExempt) {
      try {
        const tx = await opsContract.setProposalBondExemptBatch(addrs, true);
        console.log(`   Set bond exemptions tx: ${tx.hash}`);
        await tx.wait();
        console.log('   ✓ Bond exemptions granted');
        results.push({ step: 'BondExemptions', status: 'success', details: tx.hash });
      } catch (e: any) {
        console.log(`   ✗ Set bond exemptions failed: ${e?.message}`);
        results.push({ step: 'BondExemptions', status: 'error', details: e?.message });
      }
    } else {
      console.log('   ✓ Bond exemptions already granted');
      results.push({ step: 'BondExemptions', status: 'skipped' });
    }
  } else {
    console.log('   ⚠ No relayer keys found');
    results.push({ step: 'LifecycleOperators', status: 'skipped', details: 'no relayer keys' });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Summary
  // ══════════════════════════════════════════════════════════════════════
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));

  const successful = results.filter(r => r.status === 'success').length;
  const failed = results.filter(r => r.status === 'error').length;
  const skipped = results.filter(r => r.status === 'skipped').length;

  console.log(`✓ Successful: ${successful}`);
  console.log(`✗ Failed: ${failed}`);
  console.log(`○ Skipped: ${skipped}`);
  console.log();

  for (const r of results) {
    const icon = r.status === 'success' ? '✓' : r.status === 'error' ? '✗' : '○';
    console.log(`${icon} ${r.step}: ${r.details || r.status}`);
  }

  if (failed > 0) {
    console.log('\n\x1b[31mSome steps failed - market may not be fully configured\x1b[0m');
    process.exit(1);
  } else {
    console.log('\n\x1b[32mAll configuration complete!\x1b[0m');
  }
}

main().catch((e) => {
  console.error('Configuration failed:', e);
  process.exit(1);
});
