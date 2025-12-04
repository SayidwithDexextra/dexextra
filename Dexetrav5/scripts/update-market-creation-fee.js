#!/usr/bin/env node

// update-market-creation-fee.js
//
// Updates the FuturesMarketFactory market creation fee using the deployer account.
//
// Usage examples:
//   npx hardhat run scripts/update-market-creation-fee.js --network hyperliquid --fee 0
//   npx hardhat run scripts/update-market-creation-fee.js --network localhost --fee 25.5
//   FEE_USDC=0 npx hardhat run scripts/update-market-creation-fee.js --network hyperliquid
//   # Pass raw 6-decimal base units instead of USDC via --raw
//   npx hardhat run scripts/update-market-creation-fee.js --network hyperliquid --fee 100000000 --raw

const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

// Load environment (prefer .env.local at repo root, then default .env)
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !process.argv[idx + 1].startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return fallback;
}

async function main() {
  console.log("\n⚙️  Update Market Creation Fee");

  // Parse inputs
  const feeInput = getArg("--fee", getArg("--fee-usdc", process.env.FEE_USDC));
  const useRaw = process.argv.includes("--raw");
  if (feeInput === undefined || feeInput === null) {
    console.error(
      "\n❌ Missing required --fee <USDC> argument (or FEE_USDC env).\n"
    );
    console.error("Examples:");
    console.error(
      "  npx hardhat run scripts/update-market-creation-fee.js --network hyperliquid --fee 0"
    );
    console.error(
      "  npx hardhat run scripts/update-market-creation-fee.js --network localhost --fee 25.5"
    );
    console.error(
      "  FEE_USDC=0 npx hardhat run scripts/update-market-creation-fee.js --network hyperliquid\n"
    );
    process.exit(1);
  }

  // Determine network & deployment file
  const networkName = network.name === "hardhat" ? "localhost" : network.name;
  const deploymentPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${networkName}-deployment.json`
  );

  // Resolve factory address (prefer explicit env override)
  const envFactory =
    process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
    process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;
  let fileFactory = null;
  if (fs.existsSync(deploymentPath)) {
    try {
      const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
      fileFactory = deployment?.contracts?.FUTURES_MARKET_FACTORY || null;
    } catch (e) {
      console.warn("⚠️  Failed to read deployment file:", e.message);
    }
  } else {
    console.warn(
      `⚠️  Deployment file not found for network '${networkName}': ${deploymentPath}`
    );
  }

  const factoryAddress = envFactory || fileFactory;
  if (!factoryAddress) {
    console.error(
      "\n❌ Could not resolve FuturesMarketFactory address. Set FUTURES_MARKET_FACTORY_ADDRESS in env or ensure the deployments file exists.\n"
    );
    process.exit(1);
  }

  const [deployer] = await ethers.getSigners();
  console.log(`🔑 Deployer: ${deployer.address}`);
  console.log(`🌐 Network: ${networkName}`);
  console.log(`🏭 Factory: ${factoryAddress}`);

  // Parse fee → 6 decimals (USDC). If --raw is used, treat as base units directly.
  let newFee;
  try {
    newFee = useRaw ? BigInt(feeInput) : ethers.parseUnits(String(feeInput), 6);
  } catch (e) {
    console.error(
      "\n❌ Invalid fee input. Provide a number (e.g., 0, 25.5) or use --raw for base units."
    );
    console.error("Error:", e.message || e);
    process.exit(1);
  }

  console.log(`🧮 New fee (base units, 6 decimals): ${newFee.toString()}`);

  // Attach to factory via compiled artifact
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    factoryAddress,
    deployer
  );

  console.log("\n🚀 Sending transaction: updateMarketCreationFee(...)");
  try {
    const tx = await factory.updateMarketCreationFee(newFee);
    console.log("   ⏳ Tx sent:", tx.hash);
    const rcpt = await tx.wait();
    console.log("   ✅ Mined in block:", rcpt.blockNumber);
    console.log("\n🎉 Success: Market creation fee updated.");
  } catch (e) {
    console.error("\n❌ Transaction failed.");
    console.error("Reason:", e?.shortMessage || e?.reason || e?.message || e);
    if (e?.data) console.error("Data:", e.data);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("\n❌ Script error:", err);
  process.exitCode = 1;
});
