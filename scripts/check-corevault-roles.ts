import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const coreVaultAddr = '0x13C0EE284eF74E10A6442077718D57e2C50Ee88F';
  const vaultAdminAddr = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
  const adminAddr = '0x428d7cBd7feccf01a80dACE3d70b8eCf06451500';
  const orderBook = '0x3D69da19209411F09609CbE376F5352FFf90a7B4';
  
  console.log('Checking CoreVault roles...');
  console.log(`  CoreVault: ${coreVaultAddr}`);
  
  const coreVault = new ethers.Contract(coreVaultAddr, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function getRoleAdmin(bytes32) view returns (bytes32)',
  ], provider);
  
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes('ORDERBOOK_ROLE'));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('SETTLEMENT_ROLE'));
  
  console.log(`\nRole hashes:`);
  console.log(`  DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
  console.log(`  ORDERBOOK_ROLE: ${ORDERBOOK_ROLE}`);
  console.log(`  SETTLEMENT_ROLE: ${SETTLEMENT_ROLE}`);
  
  // Check who has DEFAULT_ADMIN_ROLE
  const [adminHasDefault, vaultAdminHasDefault] = await Promise.all([
    coreVault.hasRole(DEFAULT_ADMIN_ROLE, adminAddr),
    coreVault.hasRole(DEFAULT_ADMIN_ROLE, vaultAdminAddr),
  ]);
  
  console.log(`\nDEFAULT_ADMIN_ROLE holders:`);
  console.log(`  Admin (${adminAddr}): ${adminHasDefault}`);
  console.log(`  VaultAdmin (${vaultAdminAddr}): ${vaultAdminHasDefault}`);
  
  // Check role admins
  const [orderbookRoleAdmin, settlementRoleAdmin] = await Promise.all([
    coreVault.getRoleAdmin(ORDERBOOK_ROLE),
    coreVault.getRoleAdmin(SETTLEMENT_ROLE),
  ]);
  
  console.log(`\nRole admins:`);
  console.log(`  ORDERBOOK_ROLE admin: ${orderbookRoleAdmin}`);
  console.log(`  SETTLEMENT_ROLE admin: ${settlementRoleAdmin}`);
  
  // Check if orderbook already has roles
  const [obHasOrderbook, obHasSettlement] = await Promise.all([
    coreVault.hasRole(ORDERBOOK_ROLE, orderBook),
    coreVault.hasRole(SETTLEMENT_ROLE, orderBook),
  ]);
  
  console.log(`\nOrderbook ${orderBook} roles:`);
  console.log(`  has ORDERBOOK_ROLE: ${obHasOrderbook}`);
  console.log(`  has SETTLEMENT_ROLE: ${obHasSettlement}`);
  
  // Try to simulate the grantRole call
  console.log('\nSimulating grantRole call...');
  const iface = new ethers.Interface([
    'function grantRole(bytes32 role, address account)',
  ]);
  const calldata = iface.encodeFunctionData('grantRole', [ORDERBOOK_ROLE, orderBook]);
  console.log(`  Calldata: ${calldata}`);
  
  try {
    const result = await provider.call({
      to: coreVaultAddr,
      from: vaultAdminAddr,
      data: calldata,
    });
    console.log(`  Simulation result: ${result}`);
  } catch (e: any) {
    console.log(`  Simulation failed: ${e?.message || String(e)}`);
    if (e.data) console.log(`  Revert data: ${e.data}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
