#!/usr/bin/env npx tsx
/**
 * Get User Collateral Balance with Full Decimal Precision
 * 
 * Usage:
 *   npx tsx scripts/get-user-balance.ts <wallet_address>
 *   npx tsx scripts/get-user-balance.ts 0x1234...abcd
 * 
 * Shows:
 *   - Total collateral (raw and formatted)
 *   - Collateral breakdown (deposited, cross-chain, withdrawable, available)
 *   - Recent fee transactions from trading_fees table
 */

import { ethers } from 'ethers';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment
const envPath = path.join(process.cwd(), '.env.local');
if (fs.existsSync(envPath)) {
  dotenv.config({ path: envPath });
} else {
  dotenv.config();
}

// Use fallback RPC if env var is missing or malformed
let RPC_URL = process.env.RPC_URL || '';
if (!RPC_URL.startsWith('https://') && !RPC_URL.startsWith('http://')) {
  RPC_URL = 'https://rpc.hyperliquid.xyz/evm';
}

// Read CoreVault from env, with fallback
const CORE_VAULT_ADDRESS = process.env.CORE_VAULT_ADDRESS 
  || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS 
  || '0x13C0EE284eF74E10A6442077718D57e2C50Ee88F';

const CoreVaultABI = [
  'function userCollateral(address user) external view returns (uint256)',
  'function getCollateralBreakdown(address user) external view returns (uint256 depositedCollateral, uint256 crossChainCredit, uint256 withdrawableCollateral, uint256 availableForTrading)',
  'function getAvailableCollateral(address user) external view returns (uint256)',
  'function getTotalMarginUsed(address user) external view returns (uint256)',
  'function getUserPositionCount(address user) external view returns (uint256)',
];

function formatUsdc(value: bigint, decimals: number = 6): string {
  const str = value.toString().padStart(decimals + 1, '0');
  const intPart = str.slice(0, -decimals) || '0';
  const decPart = str.slice(-decimals);
  return `${intPart}.${decPart}`;
}

function formatUsdcPretty(value: bigint): string {
  const num = Number(value) / 1e6;
  return `$${num.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 6 })}`;
}

async function main() {
  const userAddress = process.argv[2];
  
  if (!userAddress || !ethers.isAddress(userAddress)) {
    console.error('Usage: npx tsx scripts/get-user-balance.ts <wallet_address>');
    console.error('Example: npx tsx scripts/get-user-balance.ts 0x1234567890abcdef1234567890abcdef12345678');
    process.exit(1);
  }

  console.log('\n╔════════════════════════════════════════════════════════════════════╗');
  console.log('║              USER COLLATERAL BALANCE (FULL PRECISION)              ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝\n');

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const coreVault = new ethers.Contract(CORE_VAULT_ADDRESS, CoreVaultABI, provider);

  console.log(`User Address:  ${userAddress}`);
  console.log(`CoreVault:     ${CORE_VAULT_ADDRESS}`);
  console.log(`RPC:           ${RPC_URL}\n`);

  try {
    // Get total collateral
    const totalCollateral = await coreVault.userCollateral(userAddress);
    
    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│ TOTAL COLLATERAL                                                    │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    console.log(`│ Raw (6 decimals):    ${totalCollateral.toString().padEnd(45)}│`);
    console.log(`│ Exact USDC:          ${formatUsdc(totalCollateral).padEnd(45)}│`);
    console.log(`│ Formatted:           ${formatUsdcPretty(totalCollateral).padEnd(45)}│`);
    console.log('└─────────────────────────────────────────────────────────────────────┘\n');

    // Get breakdown
    try {
      const [deposited, crossChain, withdrawable, available] = await coreVault.getCollateralBreakdown(userAddress);
      
      console.log('┌─────────────────────────────────────────────────────────────────────┐');
      console.log('│ COLLATERAL BREAKDOWN                                                │');
      console.log('├─────────────────────────────────────────────────────────────────────┤');
      console.log(`│ Deposited Collateral:     ${formatUsdc(deposited).padEnd(40)}│`);
      console.log(`│ Cross-Chain Credit:       ${formatUsdc(crossChain).padEnd(40)}│`);
      console.log(`│ Withdrawable:             ${formatUsdc(withdrawable).padEnd(40)}│`);
      console.log(`│ Available for Trading:    ${formatUsdc(available).padEnd(40)}│`);
      console.log('└─────────────────────────────────────────────────────────────────────┘\n');
    } catch (e) {
      console.log('(Collateral breakdown not available on this vault version)\n');
    }

    // Get margin info
    try {
      const marginUsed = await coreVault.getTotalMarginUsed(userAddress);
      const positionCount = await coreVault.getUserPositionCount(userAddress);
      
      console.log('┌─────────────────────────────────────────────────────────────────────┐');
      console.log('│ MARGIN & POSITIONS                                                  │');
      console.log('├─────────────────────────────────────────────────────────────────────┤');
      console.log(`│ Total Margin Used:        ${formatUsdc(marginUsed).padEnd(40)}│`);
      console.log(`│ Open Positions:           ${positionCount.toString().padEnd(40)}│`);
      console.log('└─────────────────────────────────────────────────────────────────────┘\n');
    } catch (e) {
      // Skip if not available
    }

    // Calculate precision examples
    console.log('┌─────────────────────────────────────────────────────────────────────┐');
    console.log('│ PRECISION REFERENCE                                                 │');
    console.log('├─────────────────────────────────────────────────────────────────────┤');
    console.log('│ 1 USDC        = 1000000 (raw)                                       │');
    console.log('│ $0.01 (1 cent)= 10000 (raw)                                         │');
    console.log('│ $0.001        = 1000 (raw)                                          │');
    console.log('│ $0.0001       = 100 (raw)                                           │');
    console.log('│ $0.00001      = 10 (raw)                                            │');
    console.log('│ $0.000001     = 1 (raw) ← smallest unit                             │');
    console.log('└─────────────────────────────────────────────────────────────────────┘\n');

  } catch (err: any) {
    console.error('Error querying CoreVault:', err?.message || err);
    process.exit(1);
  }
}

main().catch(console.error);
