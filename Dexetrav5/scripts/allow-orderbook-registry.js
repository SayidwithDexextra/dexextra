#!/usr/bin/env node

/**
 * allow-orderbook-registry.js
 *
 * Marks an OrderBook as allowed on the GlobalSessionRegistry.
 *
 * Usage:
 *   ORDERBOOK=0x... REGISTRY=0x... npx hardhat --config Dexetrav5/hardhat.config.js run Dexetrav5/scripts/allow-orderbook-registry.js --network hyperliquid
 */

const { ethers } = require("hardhat");

function isAddress(v) {
  return typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
}

async function bumpedOverrides() {
  const fee = await ethers.provider.getFeeData();
  const bump = (x) => (x ? (x * 13n) / 10n : null); // +30%
  if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
    return {
      maxFeePerGas: bump(fee.maxFeePerGas) || fee.maxFeePerGas,
      maxPriorityFeePerGas:
        bump(fee.maxPriorityFeePerGas) || fee.maxPriorityFeePerGas,
    };
  }
  const base = fee.gasPrice || ethers.parseUnits("30", "gwei");
  const gasPrice = bump(base) || base;
  return { gasPrice };
}

async function main() {
  const orderBook = process.env.ORDERBOOK || "";
  const registryAddr =
    process.env.REGISTRY || process.env.SESSION_REGISTRY_ADDRESS || "";
  if (!isAddress(orderBook))
    throw new Error("Set ORDERBOOK to the diamond address.");
  if (!isAddress(registryAddr))
    throw new Error(
      "Set REGISTRY (or SESSION_REGISTRY_ADDRESS) to the GlobalSessionRegistry address."
    );

  const [signer] = await ethers.getSigners();
  console.log("👤 Signer:", await signer.getAddress());
  console.log("📘 OrderBook:", orderBook);
  console.log("📗 Registry:", registryAddr);

  const registry = await ethers.getContractAt(
    [
      "function allowedOrderbook(address) view returns (bool)",
      "function setAllowedOrderbook(address,bool)",
    ],
    registryAddr,
    signer
  );

  const already = await registry.allowedOrderbook(orderBook);
  if (already) {
    console.log("✅ OrderBook already allowed");
    return;
  }

  const ov = await bumpedOverrides();
  const tx = await registry.setAllowedOrderbook(orderBook, true, ov);
  console.log("⏳ setAllowedOrderbook tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ Allowed on registry, block", rc?.blockNumber);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
