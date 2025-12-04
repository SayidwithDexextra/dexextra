#!/usr/bin/env node

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

async function resolveOrderBook() {
  const explicit = process.env.ORDERBOOK || getArg("--orderbook");
  if (explicit) return explicit;
  const network = await ethers.provider.getNetwork();
  let networkName = process.env.HARDHAT_NETWORK || "unknown";
  networkName = networkName === "hardhat" && Number(network.chainId) === 31337 ? "localhost" : networkName;
  const deploymentPath = path.join(__dirname, `../deployments/${networkName}-deployment.json`);
  if (fs.existsSync(deploymentPath)) {
    const dep = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
    if (dep?.defaultMarket?.orderBook) return dep.defaultMarket.orderBook;
    if (Array.isArray(dep?.markets) && dep.markets[0]?.orderBook) return dep.markets[0].orderBook;
  }
  throw new Error("ORDERBOOK not provided and not found in deployments.");
}

async function main() {
  const ob = await resolveOrderBook();
  const rollover = Number(process.env.ROLLOVER_LEAD || getArg("--rollover-lead", "0")); // seconds
  const challenge = Number(process.env.CHALLENGE_LEAD || getArg("--challenge-lead", "0")); // seconds
  console.log("OrderBook:", ob, "-> setLeadTimes(rollover:", rollover, "challenge:", challenge, ")");
  const lifecycle = await ethers.getContractAt("MarketLifecycleFacet", ob);
  const tx = await lifecycle.setLeadTimes(rollover, challenge);
  console.log("tx:", tx.hash);
  await tx.wait();
  console.log("✅ lead times set");
}

main().then(()=>process.exit(0)).catch((e)=>{ console.error(e); process.exit(1); });












