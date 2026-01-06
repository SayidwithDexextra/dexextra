#!/usr/bin/env node

/**
 * print-diamond-owner.js
 *
 * Prints the Diamond (OrderBook) contract owner via IERC173.owner().
 *
 * Usage:
 *   ORDERBOOK=0x... npx hardhat run Dexetrav5/scripts/print-diamond-owner.js --network hyperliquid
 *   npx hardhat run Dexetrav5/scripts/print-diamond-owner.js --network hyperliquid -- --orderbook 0x...
 */

const { ethers } = require("hardhat");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

async function main() {
  const orderBook =
    getArg("--orderbook", null) ||
    process.env.ORDERBOOK ||
    process.env.ORDERBOOK_ADDRESS ||
    process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS ||
    "";
  if (!isAddress(orderBook)) {
    throw new Error("Provide ORDERBOOK env or --orderbook 0x... (must be an address)");
  }

  const net = await ethers.provider.getNetwork();
  const code = await ethers.provider.getCode(orderBook);
  console.log("");
  console.log("Diamond owner lookup");
  console.log("────────────────────────────────────────────────────────────");
  console.log("network.chainId:", String(net.chainId));
  console.log("orderBook:", orderBook);
  console.log("codeSize:", code && code !== "0x" ? (code.length - 2) / 2 : 0);

  const c = await ethers.getContractAt(["function owner() view returns (address)"], orderBook);
  const owner = await c.owner();
  console.log("owner:", owner);
  console.log("");
}

main().catch((e) => {
  console.error(e?.message || String(e));
  process.exit(1);
});





