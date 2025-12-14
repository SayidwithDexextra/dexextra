#!/usr/bin/env node

/**
 * trigger-mock-events.js
 *
 * Deploys (or reuses) MockOrderBookEvents and fires:
 *  - PriceUpdated
 *  - TradeRecorded
 *  - LiquidationCompleted
 *
 * This is meant to drive the Alchemy → Supabase pipeline end to end.
 *
 * Usage:
 *   npx hardhat run scripts/trigger-mock-events.js --network <network> [--reuse <address>] [--market <hex32>]
 *
 * Env overrides:
 *   MOCK_OB_EVENTS   - existing contract address to reuse
 *   MOCK_MARKET_HEX  - bytes32 market id (hex string 0x...)
 */

// Load envs the same way as other scripts
try {
  const path = require("path");
  const fs = require("fs");
  const dotenv = require("dotenv");
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.join(__dirname, "..", ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch (_) {
  /* ignore */
}

const hre = require("hardhat");
const { ethers } = hre;

function parseArgs() {
  const out = {
    reuse: process.env.MOCK_OB_EVENTS,
    marketHex: process.env.MOCK_MARKET_HEX,
  };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--reuse" && argv[i + 1]) out.reuse = argv[++i];
    if (argv[i] === "--market" && argv[i + 1]) out.marketHex = argv[++i];
  }
  return out;
}

function normalizeHex32(raw) {
  if (!raw) return null;
  const clean = raw.toLowerCase();
  if (!clean.startsWith("0x")) return null;
  if (clean.length !== 66) return null;
  return clean;
}

async function main() {
  const { reuse, marketHex: cliMarket } = parseArgs();
  const [signer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("Network:", network.name, "chainId:", Number(network.chainId));
  console.log("Signer:", signer.address);

  const marketHex =
    normalizeHex32(cliMarket) ||
    normalizeHex32(process.env.MOCK_MARKET_HEX) ||
    ethers
      .hexlify(ethers.toUtf8Bytes("TEST-MARKET-0001").slice(0, 32))
      .padEnd(66, "0");

  let emitter;
  if (reuse) {
    emitter = await ethers.getContractAt("MockOrderBookEvents", reuse);
    console.log("Reusing MockOrderBookEvents at", emitter.target);
  } else {
    const Factory = await ethers.getContractFactory("MockOrderBookEvents");
    emitter = await Factory.deploy();
    await emitter.waitForDeployment();
    console.log("Deployed MockOrderBookEvents to", emitter.target);
  }

  // 1) PriceUpdated
  const tx1 = await emitter.emitPriceUpdated(1_000_000, 1_050_000); // $1.00 -> $1.05 if 6 decimals
  await tx1.wait();
  console.log("PriceUpdated emitted", tx1.hash);

  // 2) TradeRecorded
  const price = 1_050_000; // with 6 decimals ($1.05)
  const amount = ethers.parseUnits("1", 18); // 1e18 = 1 unit
  const buyerFee = 0;
  const sellerFee = 0;
  const liquidationPrice = 900_000; // $0.90 in 6 decimals
  const tx2 = await emitter.emitTradeRecorded(
    marketHex,
    signer.address,
    signer.address,
    price,
    amount,
    buyerFee,
    sellerFee,
    liquidationPrice
  );
  await tx2.wait();
  console.log("TradeRecorded emitted", tx2.hash, "market", marketHex);

  // 3) LiquidationCompleted
  const startSize = ethers.parseUnits("1", 18); // +1 long
  const remainingSize = 0; // fully closed
  const tx3 = await emitter.emitLiquidationCompleted(
    signer.address,
    1,
    "Direct",
    startSize,
    remainingSize
  );
  await tx3.wait();
  console.log("LiquidationCompleted emitted", tx3.hash);

  console.log("Done. Watch your Alchemy/Supabase pipeline for these events.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

