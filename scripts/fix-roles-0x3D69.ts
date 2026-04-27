import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const vaultAdminWallet = new ethers.Wallet(process.env.ROLE_GRANTER_PRIVATE_KEY!, provider);
  const coreVaultAddr = '0x13C0EE284eF74E10A6442077718D57e2C50Ee88F';
  const orderBook = '0x3D69da19209411F09609CbE376F5352FFf90a7B4';
  
  console.log(`Granting CoreVault roles to orderbook`);
  console.log(`  CoreVault: ${coreVaultAddr}`);
  console.log(`  OrderBook: ${orderBook}`);
  console.log(`  Granter: ${await vaultAdminWallet.getAddress()}`);
  
  const coreVault = new ethers.Contract(coreVaultAddr, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
  ], vaultAdminWallet);
  
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  
  // Check current state
  const [hasOB, hasSettle] = await Promise.all([
    coreVault.hasRole(ORDERBOOK_ROLE, orderBook),
    coreVault.hasRole(SETTLEMENT_ROLE, orderBook),
  ]);
  
  console.log(`\nCurrent state:`);
  console.log(`  ORDERBOOK_ROLE: ${hasOB}`);
  console.log(`  SETTLEMENT_ROLE: ${hasSettle}`);
  
  const txs: {label: string, tx: ethers.TransactionResponse}[] = [];
  
  if (!hasOB) {
    console.log(`\nGranting ORDERBOOK_ROLE...`);
    const tx = await coreVault.grantRole(ORDERBOOK_ROLE, orderBook);
    console.log(`  TX: ${tx.hash}`);
    txs.push({ label: 'ORDERBOOK_ROLE', tx });
  }
  
  if (!hasSettle) {
    console.log(`\nGranting SETTLEMENT_ROLE...`);
    const tx = await coreVault.grantRole(SETTLEMENT_ROLE, orderBook);
    console.log(`  TX: ${tx.hash}`);
    txs.push({ label: 'SETTLEMENT_ROLE', tx });
  }
  
  if (txs.length === 0) {
    console.log('\n✓ All roles already granted');
    return;
  }
  
  console.log(`\nWaiting for ${txs.length} tx(s)...`);
  for (const { label, tx } of txs) {
    await tx.wait();
    console.log(`  ✓ ${label} confirmed`);
  }
  
  console.log('\n✓ All roles granted to orderbook');
}

main().catch(e => { console.error(e); process.exit(1); });
