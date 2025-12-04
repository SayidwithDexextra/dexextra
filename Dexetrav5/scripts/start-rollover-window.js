#!/usr/bin/env node

// start-rollover-window.js
// Calls MarketLifecycleFacet.startRolloverWindow() on a target OrderBook (Diamond)
//
// Usage:
//   HARDHAT_NETWORK=hyperliquid ORDERBOOK=0x... npx hardhat run scripts/start-rollover-window.js --network hyperliquid
//   Or:
//   npx hardhat run scripts/start-rollover-window.js --network hyperliquid -- --orderbook 0x...

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1] && !String(process.argv[idx + 1]).startsWith("--")) {
    return process.argv[idx + 1];
  }
  return fallback;
}
function extractError(error) {
  try {
    return (
      error?.shortMessage ||
      error?.reason ||
      error?.error?.message ||
      (typeof error?.data === "string" ? error.data : undefined) ||
      error?.message ||
      String(error)
    );
  } catch (_) {
    return String(error);
  }
}

async function main() {
  console.log("\n⏳ Start Rollover Window");
  console.log("═".repeat(80));
  try {
    const [signerLog] = await ethers.getSigners();
    console.log("👤 Signer:", await signerLog.getAddress());
  } catch (_) {}

  const explicitOrderBook = process.env.ORDERBOOK || getArg("--orderbook");
  const symbol = process.env.SYMBOL || getArg("--symbol");

  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  const normalizedName = (() => {
    const n = String(rawNetworkName || "").toLowerCase();
    if (n === "hyperliquid-testnet" || n === "hl_testnet" || n === "hl-testnet") return "hyperliquid_testnet";
    if (n === "hyperliquid" || n === "hl" || n === "hl-mainnet") return "hyperliquid";
    if (n === "hardhat" || n === "localhost") return "localhost";
    return n || "unknown";
  })();
  let effectiveNetworkName = normalizedName;
  if ((effectiveNetworkName === "hardhat" || effectiveNetworkName === "unknown") && Number(network.chainId) === 31337) {
    effectiveNetworkName = "localhost";
  }
  console.log(`🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`);

  // Load deployments
  const deploymentPath = path.join(__dirname, `../deployments/${effectiveNetworkName}-deployment.json`);
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath)) {
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    }
  } catch (_) {}

  let orderBook = explicitOrderBook || null;
  if (!orderBook && symbol) {
    const entry = (deployment.markets || []).find((m) => m?.symbol === symbol);
    if (entry) orderBook = entry.orderBook;
  }
  if (!orderBook && deployment?.defaultMarket?.orderBook) orderBook = deployment.defaultMarket.orderBook;
  if (!orderBook) {
    throw new Error("Missing ORDERBOOK. Provide --orderbook or set deployments.defaultMarket.orderBook");
  }
  console.log("🎯 OrderBook:", orderBook);

  const lifecycle = await ethers.getContractAt("MarketLifecycleFacet", orderBook);
  console.log("🟢 Calling startRolloverWindow...");
  try {
    const tx = await lifecycle.startRolloverWindow();
    console.log("   tx:", tx.hash);
    const rc = await tx.wait();
    console.log("✅ Rollover window started at block", rc.blockNumber);
  } catch (e) {
    console.error("❌ Failed to start rollover window:", extractError(e));
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ start-rollover-window failed:", extractError(e));
    process.exit(1);
  });












