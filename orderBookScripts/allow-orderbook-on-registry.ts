#!/usr/bin/env tsx
/**
 * Whitelist an OrderBook (diamond) on GlobalSessionRegistry by calling:
 *   setAllowedOrderbook(orderBook, true)
 *
 * Configuration is read from .env.local (project root):
 *   - SESSION_REGISTRY_ADDRESS
 *   - ADMIN_PRIVATE_KEY (must be the owner of the registry)
 *   - RPC_URL (or RPC_URL_HYPEREVM)
 *
 * Usage:
 *   tsx scripts/allow-orderbook-on-registry.ts --orderbook 0xOrderBook
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

function requireEnv(name: string, fallback?: string): string {
  const v = process.env[name] || fallback;
  if (!v) {
    throw new Error(`Missing required env: ${name}`);
  }
  return v;
}

async function main() {
  // Load env from .env.local (fallback to .env)
  const root = process.cwd();
  const envLocalPath = path.join(root, '.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else {
    dotenv.config();
  }

  const argv = process.argv.slice(2);
  const getFlagValue = (long: string, short?: string) => {
    const iLong = argv.indexOf(long);
    if (iLong >= 0) return argv[iLong + 1];
    if (short) {
      const iShort = argv.indexOf(short);
      if (iShort >= 0) return argv[iShort + 1];
    }
    return undefined;
  };
  const orderBookInput = getFlagValue('--orderbook', '-o');
  if (!orderBookInput || !ethers.isAddress(orderBookInput)) {
    console.error('Usage: tsx scripts/allow-orderbook-on-registry.ts --orderbook 0xOrderBook');
    console.error('Error: missing or invalid --orderbook address');
    process.exit(1);
  }
  const orderBook = ethers.getAddress(orderBookInput);

  const rpcUrl = process.env.RPC_URL || process.env.RPC_URL_HYPEREVM;
  if (!rpcUrl) {
    throw new Error('RPC_URL (or RPC_URL_HYPEREVM) is required');
  }
  const registryAddress = requireEnv('SESSION_REGISTRY_ADDRESS');
  if (!ethers.isAddress(registryAddress)) {
    throw new Error('SESSION_REGISTRY_ADDRESS is not a valid address');
  }

  const pk = requireEnv('ADMIN_PRIVATE_KEY');
  if (!/^0x[a-fA-F0-9]{64}$/.test(pk)) {
    throw new Error('ADMIN_PRIVATE_KEY must be a 0x-prefixed 32-byte hex string');
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const signerAddress = await wallet.getAddress();

  const REGISTRY_ABI = [
    'function owner() view returns (address)',
    'function allowedOrderbook(address) view returns (bool)',
    'function setAllowedOrderbook(address,bool) external',
  ];

  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, wallet);

  // Verify signer is owner (avoids opaque on-chain revert)
  let owner: string;
  try {
    owner = await registry.owner();
  } catch (e: any) {
    console.error('Failed to read registry owner():', e?.message || String(e));
    throw e;
  }
  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `Signer is not registry owner. owner=${owner}, signer=${signerAddress}. Ensure ADMIN_PRIVATE_KEY corresponds to the registry owner.`,
    );
  }

  // Check current status
  const isAllowed: boolean = await registry.allowedOrderbook(orderBook);
  console.log('[allow-orderbook] current', { registry: registryAddress, orderBook, isAllowed, signer: signerAddress });
  if (isAllowed) {
    console.log('[allow-orderbook] OrderBook already allowed. Nothing to do.');
    return;
  }

  // Send tx
  const tx = await registry.setAllowedOrderbook(orderBook, true);
  console.log('[allow-orderbook] setAllowedOrderbook tx', tx.hash);
  const rc = await tx.wait();
  console.log('[allow-orderbook] mined', { blockNumber: rc?.blockNumber, gasUsed: rc?.gasUsed?.toString?.() });
}

main().catch((e) => {
  console.error('allow-orderbook-on-registry failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});


