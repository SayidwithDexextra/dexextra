#!/usr/bin/env node

/**
 * settle-market.js
 *
 * Manually settle a market on-chain.
 *
 * Usage:
 *   MARKET_ADDRESS=0x... PRICE=580.00 npx hardhat run scripts/settle-market.js --network hyperliquid
 */

const { ethers } = require("hardhat");

async function main() {
  const [signer] = await ethers.getSigners();
  const marketAddress = process.env.MARKET_ADDRESS;
  const priceStr = process.env.PRICE;

  if (!marketAddress || !priceStr) {
    console.error("Usage: MARKET_ADDRESS=0x... PRICE=123.45 npx hardhat run scripts/settle-market.js --network <network>");
    process.exit(1);
  }

  const price = ethers.parseUnits(priceStr, 6);

  console.log("\n=== Settle Market ===");
  console.log(`Market:  ${marketAddress}`);
  console.log(`Price:   $${priceStr} (${price.toString()} raw)`);
  console.log(`Signer:  ${signer.address}`);

  const market = new ethers.Contract(
    marketAddress,
    ["function settleMarket(uint256 finalPrice) external"],
    signer
  );

  console.log("\n📝 Calling settleMarket...");
  const tx = await market.settleMarket(price, { gasLimit: 2_000_000n });
  console.log(`   Tx: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`   ✅ Confirmed in block ${receipt.blockNumber}`);
  console.log(`   Gas used: ${receipt.gasUsed.toString()}`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Error:", e?.message || String(e));
    process.exit(1);
  });
