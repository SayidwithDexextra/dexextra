import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, provider);
  const coreVaultAddr = '0x13C0EE284eF74E10A6442077718D57e2C50Ee88F';
  const orderBook = '0x3D69da19209411F09609CbE376F5352FFf90a7B4';
  
  console.log(`Granting CoreVault roles to orderbook (sequential)`);
  
  const coreVault = new ethers.Contract(coreVaultAddr, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
  ], adminWallet);
  
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  
  // Check current state
  const [hasOB, hasSettle] = await Promise.all([
    coreVault.hasRole(ORDERBOOK_ROLE, orderBook),
    coreVault.hasRole(SETTLEMENT_ROLE, orderBook),
  ]);
  
  console.log(`Current: ORDERBOOK=${hasOB}, SETTLEMENT=${hasSettle}`);
  
  if (!hasOB) {
    console.log(`\nGranting ORDERBOOK_ROLE...`);
    const tx = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
    console.log(`  TX: ${tx.hash}`);
    console.log(`  Waiting...`);
    await tx.wait();
    console.log(`  ✓ ORDERBOOK_ROLE confirmed`);
  }
  
  if (!hasSettle) {
    console.log(`\nGranting SETTLEMENT_ROLE...`);
    const tx = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
    console.log(`  TX: ${tx.hash}`);
    console.log(`  Waiting...`);
    await tx.wait();
    console.log(`  ✓ SETTLEMENT_ROLE confirmed`);
  }
  
  console.log('\n✓ All roles granted');
}

main().catch(e => { console.error(e); process.exit(1); });
