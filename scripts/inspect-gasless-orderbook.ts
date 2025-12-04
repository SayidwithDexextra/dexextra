#!/usr/bin/env tsx
/**
 * Inspect an OrderBook (diamond) for GAS (gasless session) readiness.
 *
 * Reads configuration from .env.local:
 *   - RPC_URL (or RPC_URL_HYPEREVM)
 *   - SESSION_REGISTRY_ADDRESS
 *   - CORE_VAULT_ADDRESS (optional: role checks skipped if absent)
 *
 * Usage:
 *   tsx scripts/inspect-gasless-orderbook.ts --orderbook 0xOrderBook
 *
 * Checklist:
 *  - sessionRegistry() exists on MetaTradeFacet and is non-zero
 *  - sessionRegistry equals SESSION_REGISTRY_ADDRESS
 *  - Registry.allowedOrderbook(orderBook) == true
 *  - Diamond has required session* selectors (loupe facetAddress(bytes4) != 0)
 *  - setSessionRegistry(address) selector present
 *  - CoreVault roles granted (ORDERBOOK_ROLE, SETTLEMENT_ROLE) [if CORE_VAULT_ADDRESS provided]
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

type CheckResult = { name: string; pass: boolean; details?: Record<string, any> | string };

function loadEnv() {
  const root = process.cwd();
  const local = path.join(root, '.env.local');
  if (fs.existsSync(local)) {
    dotenv.config({ path: local });
  } else {
    dotenv.config();
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getFlag(argv: string[], long: string, short?: string): string | undefined {
  const iLong = argv.indexOf(long);
  if (iLong >= 0) return argv[iLong + 1];
  if (short) {
    const iShort = argv.indexOf(short);
    if (iShort >= 0) return argv[iShort + 1];
  }
  return undefined;
}

function selector(signature: string): string {
  return ethers.id(signature).slice(0, 10);
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const orderBookInput = getFlag(argv, '--orderbook', '-o');
  if (!orderBookInput || !ethers.isAddress(orderBookInput)) {
    console.error('Usage: tsx scripts/inspect-gasless-orderbook.ts --orderbook 0xOrderBook');
    process.exit(1);
  }
  const orderBook = ethers.getAddress(orderBookInput);

  const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!rpcUrl) throw new Error('RPC_URL (or RPC_URL_HYPEREVM) is required');
  const registryAddress = requireEnv('SESSION_REGISTRY_ADDRESS');
  if (!ethers.isAddress(registryAddress)) throw new Error('SESSION_REGISTRY_ADDRESS is not a valid address');
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    const net = await provider.getNetwork();
    console.log('[inspect] network', { chainId: String(net.chainId) });
  } catch {}

  const checks: CheckResult[] = [];
  const result: Record<string, any> = { orderBook, registryAddress, coreVaultAddress: coreVaultAddress || null };

  // Diamond loupe
  const loupe = new ethers.Contract(orderBook, ['function facetAddress(bytes4) view returns (address)'], provider);

  // Check for MetaTradeFacet.sessionRegistry()
  let sessionRegistryOnDiamond = '0x0000000000000000000000000000000000000000';
  try {
    // Verify that selector exists
    const selView = selector('sessionRegistry()');
    const hasViewFacet = await loupe.facetAddress(selView);
    const hasView = !!hasViewFacet && hasViewFacet !== ethers.ZeroAddress;
    checks.push({
      name: 'diamond.hasSelector.sessionRegistry',
      pass: hasView,
      details: { selector: selView, facet: hasViewFacet },
    });
    if (hasView) {
      const meta = new ethers.Contract(orderBook, ['function sessionRegistry() view returns (address)'], provider);
      sessionRegistryOnDiamond = await meta.sessionRegistry();
      checks.push({
        name: 'meta.sessionRegistry.nonzero',
        pass: !!sessionRegistryOnDiamond && sessionRegistryOnDiamond !== ethers.ZeroAddress,
        details: { sessionRegistryOnDiamond },
      });
      checks.push({
        name: 'meta.sessionRegistry.matches_env',
        pass:
          !!sessionRegistryOnDiamond &&
          sessionRegistryOnDiamond.toLowerCase() === registryAddress.toLowerCase(),
        details: { sessionRegistryOnDiamond, expected: registryAddress },
      });
    }
  } catch (e: any) {
    checks.push({
      name: 'meta.sessionRegistry.readable',
      pass: false,
      details: e?.message || String(e),
    });
  }

  // Registry allowlist
  try {
    const reg = new ethers.Contract(
      registryAddress,
      ['function allowedOrderbook(address) view returns (bool)'],
      provider
    );
    const allowed: boolean = await reg.allowedOrderbook(orderBook);
    checks.push({
      name: 'registry.allowedOrderbook',
      pass: allowed === true,
      details: { allowed },
    });
  } catch (e: any) {
    checks.push({
      name: 'registry.allowedOrderbook.readable',
      pass: false,
      details: e?.message || String(e),
    });
  }

  // Required session selectors on diamond
  const requiredSessionSigs = [
    'sessionPlaceLimit(bytes32,address,uint256,uint256,bool)',
    'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool)',
    'sessionPlaceMarket(bytes32,address,uint256,bool)',
    'sessionPlaceMarginMarket(bytes32,address,uint256,bool)',
    'sessionModifyOrder(bytes32,address,uint256,uint256,uint256)',
    'sessionCancelOrder(bytes32,address,uint256)',
    'setSessionRegistry(address)',
  ];
  for (const sig of requiredSessionSigs) {
    try {
      const sel = selector(sig);
      const facet = await loupe.facetAddress(sel);
      const ok = facet && facet !== ethers.ZeroAddress;
      checks.push({
        name: `diamond.hasSelector.${sig}`,
        pass: ok === true,
        details: { selector: sel, facet },
      });
    } catch (e: any) {
      checks.push({
        name: `diamond.hasSelector.${sig}.readable`,
        pass: false,
        details: e?.message || String(e),
      });
    }
  }

  // CoreVault role checks (optional)
  if (coreVaultAddress && ethers.isAddress(coreVaultAddress)) {
    try {
      const vault = new ethers.Contract(
        coreVaultAddress,
        ['function hasRole(bytes32,address) view returns (bool)'],
        provider
      );
      const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
      const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
      const hasOB = await vault.hasRole(ORDERBOOK_ROLE, orderBook);
      const hasSET = await vault.hasRole(SETTLEMENT_ROLE, orderBook);
      checks.push({ name: 'coreVault.hasRole.ORDERBOOK_ROLE', pass: hasOB === true });
      checks.push({ name: 'coreVault.hasRole.SETTLEMENT_ROLE', pass: hasSET === true });
    } catch (e: any) {
      checks.push({
        name: 'coreVault.roles.readable',
        pass: false,
        details: e?.message || String(e),
      });
    }
  } else {
    checks.push({
      name: 'coreVault.address.provided',
      pass: false,
      details: 'CORE_VAULT_ADDRESS not set; role checks skipped',
    });
  }

  // Summarize
  const passCount = checks.filter((c) => c.pass).length;
  const total = checks.length;
  result.checks = checks;
  result.summary = { pass: passCount, total };

  // Human readable
  console.log('--- GASless OrderBook Inspection ---');
  console.log('OrderBook:', orderBook);
  console.log('Registry:', registryAddress);
  if (coreVaultAddress) console.log('CoreVault:', coreVaultAddress);
  console.log('------------------------------------');
  for (const c of checks) {
    console.log(`${c.pass ? '✅' : '❌'} ${c.name}${c.details ? ` — ${typeof c.details === 'string' ? c.details : JSON.stringify(c.details)}` : ''}`);
  }
  console.log('------------------------------------');
  console.log(`Passed ${passCount}/${total} checks`);
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error('inspect-gasless-orderbook failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});





