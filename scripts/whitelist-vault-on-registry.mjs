#!/usr/bin/env node
/**
 * Whitelist CoreVault as an allowed caller on GlobalSessionRegistry
 * so that sessionTopUpPositionMargin can call chargeSession.
 *
 * Usage:
 *   node scripts/whitelist-vault-on-registry.mjs
 */
import { ethers } from 'ethers';

const RPC_URL = process.env.RPC_URL || 'https://rpc.hyperliquid.xyz/evm';
const REGISTRY = process.env.SESSION_REGISTRY_ADDRESS;
const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
const OWNER_KEY = process.env.SESSION_REGISTRY_OWNER_PRIVATE_KEY;

if (!REGISTRY) { console.error('SESSION_REGISTRY_ADDRESS not set'); process.exit(1); }
if (!CORE_VAULT) { console.error('CORE_VAULT_ADDRESS not set'); process.exit(1); }
if (!OWNER_KEY) { console.error('SESSION_REGISTRY_OWNER_PRIVATE_KEY not set'); process.exit(1); }

const pk = OWNER_KEY.startsWith('0x') ? OWNER_KEY : `0x${OWNER_KEY}`;

const REGISTRY_ABI = [
  'function setAllowedOrderbook(address orderbook, bool allowed) external',
  'function allowedOrderbook(address) view returns (bool)',
  'function owner() view returns (address)',
];

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const net = await provider.getNetwork();
  console.log(`Chain: ${net.chainId}`);

  const wallet = new ethers.Wallet(pk, provider);
  console.log(`Owner wallet: ${wallet.address}`);

  const registry = new ethers.Contract(REGISTRY, REGISTRY_ABI, wallet);

  const onChainOwner = await registry.owner();
  console.log(`Registry owner on-chain: ${onChainOwner}`);
  if (onChainOwner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`Wallet ${wallet.address} is NOT the registry owner (${onChainOwner})`);
    process.exit(1);
  }

  const alreadyAllowed = await registry.allowedOrderbook(CORE_VAULT);
  console.log(`\nCoreVault ${CORE_VAULT} currently allowed: ${alreadyAllowed}`);

  if (alreadyAllowed) {
    console.log('Already whitelisted — nothing to do.');
    return;
  }

  console.log('Calling setAllowedOrderbook(coreVault, true) ...');
  const tx = await registry.setAllowedOrderbook(CORE_VAULT, true);
  console.log(`  tx hash: ${tx.hash}`);
  const rc = await tx.wait();
  console.log(`  mined in block ${rc.blockNumber}`);

  const nowAllowed = await registry.allowedOrderbook(CORE_VAULT);
  console.log(`\nCoreVault allowed after tx: ${nowAllowed}`);
  console.log('Done.');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
