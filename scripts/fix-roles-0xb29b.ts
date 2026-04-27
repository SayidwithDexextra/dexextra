import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

const MARKET = '0xb29bEB072Ea6269Df9fa31Ce5C2F64804C4De253';

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const wallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, provider);
  const coreVault = new ethers.Contract(process.env.CORE_VAULT_ADDRESS!, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
  ], wallet);
  
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  
  console.log(`Fixing roles for ${MARKET}...`);
  
  if (!await coreVault.hasRole(ORDERBOOK_ROLE, MARKET)) {
    const tx1 = await coreVault.grantRole(ORDERBOOK_ROLE, MARKET);
    console.log(`ORDERBOOK_ROLE tx: ${tx1.hash}`);
    await tx1.wait();
    console.log('✓ ORDERBOOK_ROLE granted');
  } else {
    console.log('✓ ORDERBOOK_ROLE already granted');
  }
  
  if (!await coreVault.hasRole(SETTLEMENT_ROLE, MARKET)) {
    const tx2 = await coreVault.grantRole(SETTLEMENT_ROLE, MARKET);
    console.log(`SETTLEMENT_ROLE tx: ${tx2.hash}`);
    await tx2.wait();
    console.log('✓ SETTLEMENT_ROLE granted');
  } else {
    console.log('✓ SETTLEMENT_ROLE already granted');
  }
  
  console.log('Done!');
}
main().catch(e => { console.error(e); process.exit(1); });
