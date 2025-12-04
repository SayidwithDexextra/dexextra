#!/usr/bin/env tsx
/**
 * Set sessionRegistry on an OrderBook (diamond) to enable GAS session enforcement.
 *
 * Reads from .env.local:
 *   - RPC_URL (or RPC_URL_HYPEREVM)
 *   - ADMIN_PRIVATE_KEY (must be the diamond owner)
 *   - SESSION_REGISTRY_ADDRESS
 *
 * Usage:
 *   tsx scripts/set-session-registry.ts --orderbook 0xOrderBook
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

function loadEnv() {
  const root = process.cwd();
  const envLocal = path.join(root, '.env.local');
  if (fs.existsSync(envLocal)) {
    dotenv.config({ path: envLocal });
  } else {
    dotenv.config();
  }
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);
  const orderBookInput = getFlag(argv, '--orderbook', '-o');
  if (!orderBookInput || !ethers.isAddress(orderBookInput)) {
    console.error('Usage: tsx scripts/set-session-registry.ts --orderbook 0xOrderBook');
    process.exit(1);
  }
  const orderBook = ethers.getAddress(orderBookInput);

  const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!rpcUrl) throw new Error('RPC_URL (or RPC_URL_HYPEREVM) is required');
  const pk = requireEnv('ADMIN_PRIVATE_KEY');
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) throw new Error('ADMIN_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string');
  const registryAddress = requireEnv('SESSION_REGISTRY_ADDRESS');
  if (!ethers.isAddress(registryAddress)) throw new Error('SESSION_REGISTRY_ADDRESS is not a valid address');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const signer = await wallet.getAddress();
  try {
    const net = await provider.getNetwork();
    console.log('[set-session-registry] network', { chainId: String(net.chainId), signer });
  } catch {}

  // Probe selectors exist
  const loupe = new ethers.Contract(orderBook, ['function facetAddress(bytes4) view returns (address)'], wallet);
  const sigView = 'sessionRegistry()';
  const sigSet = 'setSessionRegistry(address)';
  const sel = (s: string) => ethers.id(s).slice(0, 10);
  const facetView = await loupe.facetAddress(sel(sigView));
  const facetSet = await loupe.facetAddress(sel(sigSet));
  if (!facetSet || facetSet === ethers.ZeroAddress) {
    throw new Error('Diamond missing setSessionRegistry(address) selector');
  }
  if (!facetView || facetView === ethers.ZeroAddress) {
    console.warn('[set-session-registry] Warning: sessionRegistry() view not found; proceeding to set');
  }

  const meta = new ethers.Contract(orderBook, [
    'function sessionRegistry() view returns (address)',
    'function setSessionRegistry(address) external',
  ], wallet);

  // Read current value (if available)
  let current = '0x0000000000000000000000000000000000000000';
  try {
    current = await meta.sessionRegistry();
  } catch {}
  console.log('[set-session-registry] current', { orderBook, sessionRegistry: current });
  if (current && current.toLowerCase() === registryAddress.toLowerCase()) {
    console.log('[set-session-registry] Already set to expected registry. Nothing to do.');
    return;
  }

  // Set new registry
  const tx = await meta.setSessionRegistry(registryAddress);
  console.log('[set-session-registry] tx sent', tx.hash);
  const rc = await tx.wait();
  console.log('[set-session-registry] mined', { blockNumber: rc?.blockNumber, gasUsed: rc?.gasUsed?.toString?.() });

  // Confirm
  try {
    const after = await meta.sessionRegistry();
    console.log('[set-session-registry] updated', { sessionRegistry: after });
  } catch {}
}

main().catch((e) => {
  console.error('set-session-registry failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});





