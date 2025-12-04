#!/usr/bin/env node

/**
 * set-session-registry.js
 *
 * Sets the GlobalSessionRegistry address on a target OrderBook (diamond) MetaTradeFacet.
 *
 * Usage:
 *   HARDHAT_NETWORK=hyperliquid ORDERBOOK=0x... REGISTRY=0x... npx hardhat run Dexetrav5/scripts/set-session-registry.js --network hyperliquid
 */

const { ethers } = require("hardhat");

function isAddress(v) { return typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v); }

async function main() {
  const orderBook = process.env.ORDERBOOK || '';
  const registry = process.env.REGISTRY || '';
  if (!isAddress(orderBook)) throw new Error('Set ORDERBOOK to the diamond address.');
  if (!isAddress(registry)) throw new Error('Set REGISTRY to the GlobalSessionRegistry address.');
  const facet = await ethers.getContractAt(
    [
      "function setSessionRegistry(address registry) external",
      "function sessionRegistry() view returns (address)"
    ],
    orderBook
  );
  const current = await facet.sessionRegistry();
  if (current.toLowerCase() === registry.toLowerCase()) {
    console.log("Registry already set:", current);
    return;
  }
  const tx = await facet.setSessionRegistry(registry);
  console.log("Tx submitted:", tx.hash);
  const rc = await tx.wait();
  console.log("Tx mined at block", rc.blockNumber);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});









