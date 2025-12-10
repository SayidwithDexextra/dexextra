#!/usr/bin/env node

/**
 * Meta runner: deploys updated SpokeVaults on spokes, then hub contracts.
 *
 * Order (default):
 *   1) polygon (or mumbai)   → SpokeVault w/ deposit()
 *   2) arbitrum              → SpokeVault w/ deposit()
 *   3) hyperliquid           → CoreVault, LiqManager, Factory, CollateralHub, OrderBook
 *
 * You can override networks via env:
 *   DEPLOY_POLYGON=0 to skip polygon
 *   DEPLOY_ARBITRUM=0 to skip arbitrum
 *   DEPLOY_HUB=0 to skip hub
 *
 * Notes:
 * - This script shells out to the existing refactor-deploy.js and respects your .env files.
 * - Ensure each network has RPC/key configured in hardhat.config and required envs set.
 */

const { spawnSync } = require("child_process");
const path = require("path");

const SCRIPT = path.join(__dirname, "refactor-deploy.js");

function run(step, network) {
  console.log(`\n=== ${step} (${network}) ===`);
  const proc = spawnSync(
    "npx",
    ["hardhat", "run", SCRIPT, "--network", network],
    { stdio: "inherit", env: process.env }
  );
  if (proc.status !== 0) {
    throw new Error(`${step} failed (network=${network}, code=${proc.status})`);
  }
}

function main() {
  // Fixed sequence: Arbitrum spoke first, then HyperLiquid hub
  run("Spoke deploy (Arbitrum)", process.env.ARBITRUM_NETWORK || "arbitrum");
  run("Hub deploy (HyperLiquid)", process.env.HUB_NETWORK || "hyperliquid");

  console.log("\n✅ Meta deployment sequence complete.");
}

main();





