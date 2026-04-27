import { ethers } from 'ethers';
import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(process.cwd(), '.env.local') });

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
  const adminWallet = new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY!, provider);
  const vaultAdminAddr = '0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306';
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS!;
  
  console.log('Granting DEFAULT_ADMIN_ROLE to vault admin on CoreVault');
  console.log(`  CoreVault: ${coreVaultAddr}`);
  console.log(`  VaultAdmin: ${vaultAdminAddr}`);
  console.log(`  Granter: ${await adminWallet.getAddress()}`);
  
  const coreVault = new ethers.Contract(coreVaultAddr, [
    'function hasRole(bytes32,address) view returns (bool)',
    'function grantRole(bytes32,address) external',
    'function DEFAULT_ADMIN_ROLE() view returns (bytes32)',
  ], adminWallet);
  
  const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
  console.log(`  DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
  
  const hasRole = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, vaultAdminAddr);
  if (hasRole) {
    console.log('\n✓ VaultAdmin already has DEFAULT_ADMIN_ROLE');
    return;
  }
  
  console.log('\nGranting role...');
  const tx = await coreVault.grantRole(DEFAULT_ADMIN_ROLE, vaultAdminAddr);
  console.log(`  TX: ${tx.hash}`);
  await tx.wait();
  console.log('✓ DEFAULT_ADMIN_ROLE granted to vault admin');
}

main().catch(e => { console.error(e); process.exit(1); });
