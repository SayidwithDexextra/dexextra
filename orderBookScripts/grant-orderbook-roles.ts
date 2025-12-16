#!/usr/bin/env tsx
/**
 * Grant ORDERBOOK_ROLE and SETTLEMENT_ROLE to an OrderBook on CoreVault.
 *
 * Env (from .env.local):
 *   - RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL)
 *   - CORE_VAULT_ADDRESS  (target CoreVault)
 *   - ORDERBOOK_ADDRESS    (orderbook/diamond to grant roles to)
 *   - ADMIN_PRIVATE_KEY    (signer with DEFAULT_ADMIN_ROLE on CoreVault)
 *
 * CLI overrides:
 *   --rpc <url>
 *   --corevault <address>
 *   --orderbook <address>
 *
 * Usage:
 *   tsx orderBookScripts/grant-orderbook-roles.ts
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

function loadEnv() {
  const root = process.cwd();
  const local = path.join(root, '.env.local');
  if (fs.existsSync(local)) {
    dotenv.config({ path: local });
  } else {
    dotenv.config();
  }
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = process.argv[idx + 1];
  return v && !v.startsWith('--') ? v : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

async function main() {
  loadEnv();

  const rpcUrl =
    getArg('--rpc') || process.env.RPC_URL || process.env.RPC_URL_HYPEREVM || process.env.HYPERLIQUID_RPC_URL;
  if (!rpcUrl) throw new Error('RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) is required');

  const coreVaultAddress = getArg('--corevault') || requireEnv('CORE_VAULT_ADDRESS');
  const orderBookAddress = getArg('--orderbook') || requireEnv('ORDERBOOK_ADDRESS');

  const pk = process.env.ADMIN_PRIVATE_KEY;
  if (!pk) throw new Error('Provide ADMIN_PRIVATE_KEY (signer with DEFAULT_ADMIN_ROLE on CoreVault)');

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  const vault = new ethers.Contract(
    coreVaultAddress,
    ['function hasRole(bytes32,address) view returns (bool)', 'function grantRole(bytes32,address)'],
    wallet
  );

  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));

  console.log('[grant-roles] coreVault', coreVaultAddress);
  console.log('[grant-roles] orderBook', orderBookAddress);
  console.log('[grant-roles] signer', wallet.address);

  const checks = [
    { name: 'ORDERBOOK_ROLE', role: ORDERBOOK_ROLE },
    { name: 'SETTLEMENT_ROLE', role: SETTLEMENT_ROLE },
  ];

  for (const { name, role } of checks) {
    const has = await vault.hasRole(role, orderBookAddress);
    console.log(`[check] ${name} currently ${has ? '✅' : '❌'}`);
    if (!has) {
      console.log(`[tx] granting ${name} ...`);
      const tx = await vault.grantRole(role, orderBookAddress);
      console.log(`[tx] hash ${tx.hash}`);
      const rcpt = await tx.wait();
      console.log(`[tx] ${name} granted in block ${rcpt?.blockNumber}`);
    }
  }

  // Final verify
  for (const { name, role } of checks) {
    const has = await vault.hasRole(role, orderBookAddress);
    console.log(`[final] ${name} ${has ? '✅' : '❌'}`);
  }
}

main().catch((e) => {
  console.error('grant-orderbook-roles failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});




