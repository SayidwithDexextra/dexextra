#!/usr/bin/env tsx
/**
 * Inspect an OrderBook (diamond) for GAS (gasless session) readiness + canonical facets/roles.
 *
 * Reads configuration from .env.local:
 *   - RPC_URL (or RPC_URL_HYPEREVM)
 *   - SESSION_REGISTRY_ADDRESS
 *   - CORE_VAULT_ADDRESS (optional: role checks skipped if absent)
 *   - APP_URL (optional, defaults http://localhost:3000) for canonical cut fetch
 *
 * Usage:
 *   tsx scripts/inspect-gasless-orderbook.ts --orderbook 0xOrderBook
 *
 * Checklist:
 *  - sessionRegistry() exists on MetaTradeFacet and is non-zero
 *  - sessionRegistry equals SESSION_REGISTRY_ADDRESS
 *  - Registry.allowedOrderbook(orderBook) == true
 *  - Diamond has required session* selectors (loupe facetAddress(bytes4) != 0)
 *  - Registry supports Merkle relayer set auth (isRelayerAllowed view exists)
 *  - Relayer set root matches server (/api/gasless/session/relayer-set) and env (RELAYER_PRIVATE_KEYS_JSON)
 *  - Relayer keys have native gas on hub chain (prevents session init / trade relays from failing)
 *  - setSessionRegistry(address) selector present
 *  - CoreVault roles granted (ORDERBOOK_ROLE, SETTLEMENT_ROLE) [if CORE_VAULT_ADDRESS provided]
 *  - Canonical OrderBook cut (from /api/orderbook/cut) matches diamond selectors/facets
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';
import { loadRelayerPoolFromEnv } from '../src/lib/relayerKeys';
import { computeRelayerSetRoot } from '../src/lib/relayerMerkle';

type CheckResult = { name: string; pass: boolean; details?: Record<string, any> | string };
type FacetCut = { facetAddress: string; action: number; functionSelectors: string[] };

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

function parseNumEnv(name: string, fallback: number): number {
  const v = String(process.env[name] || '').trim();
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
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
  const appUrl = process.env.APP_URL || 'http://localhost:3000';
  const minRelayerBalanceEth =
    Number(getFlag(argv, '--min-relayer-balance-eth')) ||
    parseNumEnv('MIN_RELAYER_BALANCE_ETH', 0.0003); // default ~0.0003 native (matches recent failure magnitude)

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  try {
    const net = await provider.getNetwork();
    console.log('[inspect] network', { chainId: String(net.chainId) });
  } catch {}

  const checks: CheckResult[] = [];
  const result: Record<string, any> = { orderBook, registryAddress, coreVaultAddress: coreVaultAddress || null };

  // Diamond loupe
  const loupe = new ethers.Contract(orderBook, ['function facetAddress(bytes4) view returns (address)'], provider);
  const loupeSelectors = new ethers.Contract(
    orderBook,
    ['function facetFunctionSelectors(address) view returns (bytes4[])'],
    provider
  );

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

  // Registry Merkle support: isRelayerAllowed(sessionId, relayer, proof) view should exist.
  try {
    const reg = new ethers.Contract(
      registryAddress,
      ['function isRelayerAllowed(bytes32,address,bytes32[]) view returns (bool)'],
      provider
    );
    // Dummy sessionId; function should return false (or revert only if missing)
    const dummySession = ethers.keccak256(ethers.toUtf8Bytes('inspect-dummy-session'));
    const dummyRelayer = ethers.getAddress('0x000000000000000000000000000000000000dEaD');
    const ok: boolean = await reg.isRelayerAllowed(dummySession, dummyRelayer, []);
    checks.push({
      name: 'registry.hasMerkleRelayerSet.isRelayerAllowed',
      pass: ok === false,
      details: { returned: ok },
    });
  } catch (e: any) {
    checks.push({
      name: 'registry.hasMerkleRelayerSet.isRelayerAllowed',
      pass: false,
      details: e?.message || String(e),
    });
  }

  // Relayer set root checks: compare server endpoint vs env keys
  try {
    const keys = loadRelayerPoolFromEnv({
      pool: 'global',
      globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
      allowFallbackSingleKey: true,
    });
    const relayerAddrsEnv = keys.map((k) => ethers.getAddress(k.address));
    const rootEnv = computeRelayerSetRoot(relayerAddrsEnv);
    checks.push({
      name: 'env.relayerKeys.count>0',
      pass: relayerAddrsEnv.length > 0,
      details: { count: relayerAddrsEnv.length, rootEnv },
    });

    // Server root from API
    const resp = await fetch(`${appUrl}/api/gasless/session/relayer-set`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`relayer-set API ${resp.status}`);
    const data = await resp.json();
    const apiRoot = String(data?.relayerSetRoot || '');
    const apiAddrs: string[] = Array.isArray(data?.relayerAddresses) ? data.relayerAddresses : [];
    checks.push({
      name: 'api.relayerSet.fetch',
      pass: !!apiRoot && ethers.isHexString(apiRoot, 32),
      details: { url: `${appUrl}/api/gasless/session/relayer-set`, apiCount: apiAddrs.length, apiRoot },
    });
    checks.push({
      name: 'relayerSetRoot.matches(env_vs_api)',
      pass: apiRoot.toLowerCase() === rootEnv.toLowerCase(),
      details: { env: rootEnv, api: apiRoot },
    });
  } catch (e: any) {
    checks.push({
      name: 'relayerSetRoot.matches(env_vs_api)',
      pass: false,
      details: e?.message || String(e),
    });
  }

  // Relayer gas funding readiness: ensure all configured relayers have some native balance.
  try {
    const keys = loadRelayerPoolFromEnv({
      pool: 'global',
      globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
      allowFallbackSingleKey: true,
    });
    const relayerAddrs = keys.map((k) => ethers.getAddress(k.address));
    const minWei = ethers.parseEther(String(minRelayerBalanceEth));
    for (const a of relayerAddrs) {
      const bal = await provider.getBalance(a);
      checks.push({
        name: `relayer.nativeBalance>=${minRelayerBalanceEth} (${a.slice(0, 6)}...)`,
        pass: bal >= minWei,
        details: { relayer: a, balanceEth: ethers.formatEther(bal), minEth: String(minRelayerBalanceEth) },
      });
    }
  } catch (e: any) {
    checks.push({
      name: 'relayer.nativeBalance.check',
      pass: false,
      details: e?.message || String(e),
    });
  }

  // Required session selectors on diamond
  const requiredSessionSigs = [
    'sessionPlaceLimit(bytes32,address,uint256,uint256,bool,bytes32[])',
    'sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])',
    'sessionPlaceMarket(bytes32,address,uint256,bool,bytes32[])',
    'sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])',
    'sessionModifyOrder(bytes32,address,uint256,uint256,uint256,bytes32[])',
    'sessionCancelOrder(bytes32,address,uint256,bytes32[])',
    'setSessionRegistry(address)',
  ];
  const selectorFacets: Record<string, string> = {};
  for (const sig of requiredSessionSigs) {
    try {
      const sel = selector(sig);
      const facet = await loupe.facetAddress(sel);
      const ok = facet && facet !== ethers.ZeroAddress;
      selectorFacets[sig] = facet || ethers.ZeroAddress;
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

  // Ensure all session* selectors resolve to the same facet (detect partial upgrades).
  try {
    const sessionSigsOnly = requiredSessionSigs.filter((s) => s.startsWith('session'));
    const facets = sessionSigsOnly.map((s) => String(selectorFacets[s] || ethers.ZeroAddress).toLowerCase());
    const nonZero = facets.filter((f) => f && f !== ethers.ZeroAddress.toLowerCase());
    const unique = Array.from(new Set(nonZero));
    checks.push({
      name: 'diamond.sessionSelectors.singleFacet',
      pass: unique.length === 1,
      details: { uniqueFacets: unique, totalSessionSelectors: sessionSigsOnly.length },
    });
  } catch (e: any) {
    checks.push({
      name: 'diamond.sessionSelectors.singleFacet',
      pass: false,
      details: e?.message || String(e),
    });
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

  // Canonical OrderBook cut vs diamond
  try {
    const resp = await fetch(`${appUrl}/api/orderbook/cut`, { cache: 'no-store' });
    if (!resp.ok) throw new Error(`cut API ${resp.status}`);
    const data = await resp.json();
    const cutRaw: FacetCut[] = Array.isArray(data?.cut) ? data.cut : [];
    const cut: FacetCut[] = cutRaw.map((c) => ({
      facetAddress: ethers.getAddress(c.facetAddress),
      action: Number(c.action ?? 0),
      functionSelectors: Array.isArray(c.functionSelectors) ? c.functionSelectors : [],
    }));
    checks.push({
      name: 'canonicalCut.fetch',
      pass: cut.length > 0,
      details: { cutLen: cut.length, url: `${appUrl}/api/orderbook/cut` },
    });

    // For each selector ensure diamond facet matches canonical facet
    for (const entry of cut) {
      if (!entry.functionSelectors?.length) continue;
      // optional: compare selector list on diamond facetFunctionSelectors
      try {
        const onDiamondSelectors: string[] = await loupeSelectors.facetFunctionSelectors(entry.facetAddress);
        const missingSelectors = entry.functionSelectors.filter(
          (sel) => !onDiamondSelectors.map((s) => s.toLowerCase()).includes(sel.toLowerCase())
        );
        checks.push({
          name: `diamond.facetFunctionSelectors.matches.${entry.facetAddress}`,
          pass: missingSelectors.length === 0,
          details: { missingSelectors, totalExpected: entry.functionSelectors.length },
        });
      } catch (e: any) {
        checks.push({
          name: `diamond.facetFunctionSelectors.readable.${entry.facetAddress}`,
          pass: false,
          details: e?.message || String(e),
        });
      }

      for (const sel of entry.functionSelectors) {
        try {
          const facet = await loupe.facetAddress(sel);
          const ok = facet && facet !== ethers.ZeroAddress && facet.toLowerCase() === entry.facetAddress.toLowerCase();
          checks.push({
            name: `diamond.hasSelector.canonical.${sel}`,
            pass: ok === true,
            details: { expectedFacet: entry.facetAddress, actualFacet: facet },
          });
        } catch (e: any) {
          checks.push({
            name: `diamond.hasSelector.canonical.${sel}.readable`,
            pass: false,
            details: e?.message || String(e),
          });
        }
      }
    }
  } catch (e: any) {
    checks.push({
      name: 'canonicalCut.fetch',
      pass: false,
      details: e?.message || String(e),
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





