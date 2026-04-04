#!/usr/bin/env node
/**
 * register-lifecycle-operators.js
 *
 * Registers a list of addresses as lifecycle operators on a market diamond
 * using a single batch transaction.
 *
 * Env:
 *   MARKET_ADDRESS — target diamond
 *   OPERATOR_ADDRESSES — comma-separated list of addresses to register
 *   ADMIN_PRIVATE_KEY — diamond owner key
 *
 * Usage:
 *   MARKET_ADDRESS=0x... OPERATOR_ADDRESSES=0x...,0x... \
 *   npx hardhat run scripts/register-lifecycle-operators.js --network hyperliquid
 */

const { ethers } = require("hardhat");

async function main() {
  const marketAddress = (process.env.MARKET_ADDRESS || "").trim();
  const operatorsCsv = (process.env.OPERATOR_ADDRESSES || "").trim();

  if (!marketAddress || !/^0x[a-fA-F0-9]{40}$/.test(marketAddress)) {
    throw new Error("Set MARKET_ADDRESS env var.");
  }
  if (!operatorsCsv) {
    throw new Error("Set OPERATOR_ADDRESSES env var (comma-separated).");
  }

  const operators = operatorsCsv.split(",").map((a) => a.trim()).filter(Boolean);
  console.log(`\n🔑 Registering ${operators.length} operator(s) on ${marketAddress}\n`);

  const [signer] = await ethers.getSigners();
  const lifecycle = await ethers.getContractAt(
    [
      "function setLifecycleOperatorBatch(address[] operators, bool authorized) external",
      "function isLifecycleOperator(address account) external view returns (bool)",
    ],
    marketAddress,
    signer,
  );

  const toRegister = [];
  for (const addr of operators) {
    try {
      const already = await lifecycle.isLifecycleOperator(addr);
      if (already) {
        console.log(`   ⏭️  ${addr} already registered`);
      } else {
        toRegister.push(addr);
      }
    } catch {
      toRegister.push(addr);
    }
  }

  if (!toRegister.length) {
    console.log("\n   All operators already registered.");
  } else {
    console.log(`\n   📦 Batch registering ${toRegister.length} operator(s)...`);
    const tx = await lifecycle.setLifecycleOperatorBatch(toRegister, true);
    console.log(`   tx: ${tx.hash}`);
    await tx.wait();
    console.log(`   ✅ ${toRegister.length} operator(s) registered in one transaction`);
  }

  console.log("\n✅ Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Failed:", e?.message || String(e));
    process.exit(1);
  });
