/**
 * Quick fix for market 0xD4097af446919Adc49f57D5d8F43eba9d3880b64
 * Lane A completed, just need to grant CoreVault roles using admin wallet
 */
import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const MARKET = '0xD4097af446919Adc49f57D5d8F43eba9d3880b64';

async function main() {
  const rpcUrl = process.env.RPC_URL || process.env.JSON_RPC_URL;
  const pk = process.env.ADMIN_PRIVATE_KEY;
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  
  if (!rpcUrl || !pk || !coreVaultAddr) throw new Error('Missing env vars');
  
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  
  console.log(`Admin: ${await wallet.getAddress()}`);
  console.log(`CoreVault: ${coreVaultAddr}`);
  console.log(`Market: ${MARKET}`);
  
  const coreVault = new ethers.Contract(coreVaultAddr, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
  ], wallet);
  
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  
  // Check current state
  const hasOB = await coreVault.hasRole(ORDERBOOK_ROLE, MARKET);
  const hasSR = await coreVault.hasRole(SETTLEMENT_ROLE, MARKET);
  
  console.log(`\nCurrent state:`);
  console.log(`  ORDERBOOK_ROLE: ${hasOB}`);
  console.log(`  SETTLEMENT_ROLE: ${hasSR}`);
  
  if (hasOB && hasSR) {
    console.log('\n✓ Roles already granted!');
    return;
  }
  
  if (!hasOB) {
    console.log('\nGranting ORDERBOOK_ROLE...');
    const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, MARKET);
    console.log(`  TX: ${tx1.hash}`);
    await tx1.wait();
    console.log('  ✓ ORDERBOOK_ROLE granted');
  }
  
  if (!hasSR) {
    console.log('\nGranting SETTLEMENT_ROLE...');
    const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, MARKET);
    console.log(`  TX: ${tx2.hash}`);
    await tx2.wait();
    console.log('  ✓ SETTLEMENT_ROLE granted');
  }
  
  console.log('\n✓ All roles granted!');
}

main().catch(e => { console.error(e); process.exit(1); });
