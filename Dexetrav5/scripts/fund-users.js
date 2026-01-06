#!/usr/bin/env node

/**
 * Fund users from AdvancedMarketAutomation/wallets.csv with the Arbitrum spoke token.
 *
 * - Token address is taken from `SPOKE_ARBITRUM_USDC_ADDRESS` (or `TOKEN_ADDRESS` override).
 * - If the token supports `faucet(uint256)`, the script can mint to the deployer as needed.
 * - If the token supports `owner()` + `mint(address,uint256)` and the deployer is the owner,
 *   the script can mint to the deployer as needed.
 *
 * Usage:
 *   SPOKE_ARBITRUM_USDC_ADDRESS=0x... npx hardhat run scripts/fund-users.js --network arbitrum
 *
 * Options:
 *   --csv <path>     CSV path (default ../../AdvancedMarketAutomation/wallets.csv)
 *   --amount <n>     Amount per user, human units (default 1000000 or FUND_AMOUNT)
 *   --eth <n>        (Optional) Also send ETH per user for gas (default 0; or FUND_ETH_AMOUNT)
 *   --skip-eth       Force skip ETH funding even if --eth/FUND_ETH_AMOUNT is set
 *   --yes            Transfer to all users without per-user prompt
 */

const path = require("node:path");
const fs = require("node:fs");
const readline = require("node:readline/promises");

const { ethers } = require("hardhat");

// Load env (prefer repo root .env.local)
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
  require("dotenv").config();
} catch (_) {}

const SPOKE_TOKEN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  // mint helpers (mock only)
  "function faucet(uint256 amount) external",
  "function owner() view returns (address)",
  "function mint(address to, uint256 amount) external",
];

function parseArgs(argv) {
  const args = {
    csv: path.resolve(__dirname, "../../AdvancedMarketAutomation/wallets.csv"),
    amount: process.env.FUND_AMOUNT || "1000000",
    eth: process.env.FUND_ETH_AMOUNT || "0",
    skipEth: false,
    yes: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv" && argv[i + 1]) args.csv = argv[++i];
    else if (a === "--amount" && argv[i + 1]) args.amount = argv[++i];
    else if (a === "--eth" && argv[i + 1]) args.eth = argv[++i];
    else if (a === "--skip-eth") args.skipEth = true;
    else if (a === "--yes") args.yes = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Fund users from AdvancedMarketAutomation/wallets.csv with the Arbitrum spoke token.",
          "",
          "Usage:",
          "  SPOKE_ARBITRUM_USDC_ADDRESS=0x... npx hardhat run scripts/fund-users.js --network arbitrum",
          "",
          "Options:",
          "  --csv <path>     CSV path (default ../../AdvancedMarketAutomation/wallets.csv)",
          "  --amount <n>     Amount per user, human units (default 1000000 or FUND_AMOUNT)",
          "  --eth <n>        (Optional) Also send ETH per user for gas (default 0; or FUND_ETH_AMOUNT)",
          "  --skip-eth       Force skip ETH funding even if --eth/FUND_ETH_AMOUNT is set",
          "  --yes            Transfer to all users without per-user prompt",
        ].join("\n")
      );
      process.exit(0);
    }
  }
  return args;
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        const next = line[i + 1];
        if (next === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else {
      if (ch === ",") {
        out.push(cur.trim());
        cur = "";
      } else if (ch === '"') {
        inQuotes = true;
      } else {
        cur += ch;
      }
    }
  }
  out.push(cur.trim());
  return out;
}

function loadWalletsFromCsv(csvPath) {
  const txt = fs.readFileSync(csvPath, "utf8");
  const lines = txt.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];

  const header = String(lines[0]).toLowerCase();
  const hasHeader =
    header.includes("nickname") && header.includes("address") && header.includes("privatekey");
  const start = hasHeader ? 1 : 0;

  const wallets = [];
  for (let i = start; i < lines.length; i++) {
    const parts = parseCsvLine(lines[i]);
    const nickname = String(parts[0] || "").trim();
    const address = String(parts[1] || "").trim();
    if (!ethers.isAddress(address)) continue;
    wallets.push({
      nickname: nickname || `User${String(wallets.length + 1).padStart(3, "0")}`,
      address,
    });
  }
  return wallets;
}

async function safeCall(promise, fallback) {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log("🚀 Starting spoke user funding script...");

  const [deployer] = await ethers.getSigners();
  const net = await ethers.provider.getNetwork();
  console.log(`🌐 Network chainId: ${net.chainId}`);
  console.log(`🔑 Using deployer address: ${deployer.address}`);

  const tokenAddrRaw =
    (process.env.TOKEN_ADDRESS && process.env.TOKEN_ADDRESS.trim()) ||
    (process.env.SPOKE_ARBITRUM_USDC_ADDRESS && process.env.SPOKE_ARBITRUM_USDC_ADDRESS.trim()) ||
    "";
  if (!tokenAddrRaw || !ethers.isAddress(tokenAddrRaw)) {
    throw new Error(
      "Missing/invalid token address. Set SPOKE_ARBITRUM_USDC_ADDRESS (or TOKEN_ADDRESS override)."
    );
  }
  const tokenAddr = ethers.getAddress(tokenAddrRaw);

  const wallets = loadWalletsFromCsv(args.csv);
  if (wallets.length === 0) {
    throw new Error(`No valid wallet addresses found in CSV: ${args.csv}`);
  }

  const token = new ethers.Contract(tokenAddr, SPOKE_TOKEN_ABI, deployer);
  const decimals = Number(await safeCall(token.decimals(), 6));
  const symbol = String(await safeCall(token.symbol(), "USDC"));
  const name = String(await safeCall(token.name(), "Spoke Token"));

  const amountEach = ethers.parseUnits(String(args.amount), decimals);
  const totalNeeded = amountEach * BigInt(wallets.length);

  // Optional ETH funding (for gas). Default OFF.
  let ethEachWei = 0n;
  if (!args.skipEth) {
    const ethStr = String(args.eth || "0").trim();
    if (ethStr && ethStr !== "0") {
      try {
        ethEachWei = ethers.parseEther(ethStr);
      } catch {
        throw new Error(`Invalid --eth value: ${args.eth}`);
      }
      if (ethEachWei < 0n) {
        throw new Error(`--eth must be >= 0. Got: ${args.eth}`);
      }
    }
  }

  console.log("\n🪙 Token");
  console.log("────────────────────────────────────────");
  console.log(`Address:  ${tokenAddr}`);
  console.log(`Name:     ${name}`);
  console.log(`Symbol:   ${symbol}`);
  console.log(`Decimals: ${decimals}`);

  console.log("\n👥 Users");
  console.log("────────────────────────────────────────");
  console.log(`CSV:      ${args.csv}`);
  console.log(`Count:    ${wallets.length}`);
  console.log(`Per user:  ${ethers.formatUnits(amountEach, decimals)} ${symbol}`);
  console.log(`Total:     ${ethers.formatUnits(totalNeeded, decimals)} ${symbol}`);
  console.log(
    `ETH/user:  ${ethEachWei > 0n ? ethers.formatEther(ethEachWei) : "0"} ETH ${
      args.skipEth ? "(forced skip)" : ""
    }`
  );

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // One-time interactive opt-in/out for ETH funding (even if configured)
  if (ethEachWei > 0n && !args.yes) {
    const ans = await rl.question(
      `\nAlso send ${ethers.formatEther(ethEachWei)} ETH to each user for gas? (y/N) `
    );
    const ok = /^y(es)?$/i.test(String(ans || "").trim());
    if (!ok) {
      ethEachWei = 0n;
      console.log("ℹ️ Skipping ETH funding; will fund collateral token only.");
    }
  }

  // Ensure deployer has enough balance (mint to deployer if possible)
  let deployerBal = await token.balanceOf(deployer.address);
  console.log(`\n🏦 Deployer balance: ${ethers.formatUnits(deployerBal, decimals)} ${symbol}`);

  if (deployerBal < totalNeeded) {
    const shortfall = totalNeeded - deployerBal;

    // Determine mint capability
    const owner = await safeCall(token.owner(), null);
    const isOwner =
      owner &&
      ethers.isAddress(owner) &&
      ethers.getAddress(owner) === ethers.getAddress(deployer.address);

    // Prefer faucet (works even if not owner) — otherwise fallback to mint (owner-only)
    const canFaucet = await (async () => {
      try {
        await token.faucet.staticCall(1n);
        return true;
      } catch {
        return false;
      }
    })();

    const canOwnerMint = await (async () => {
      if (!isOwner) return false;
      try {
        await token.mint.staticCall(deployer.address, 1n);
        return true;
      } catch {
        return false;
      }
    })();

    console.log(
      `\n⚠️ Deployer is short by ${ethers.formatUnits(shortfall, decimals)} ${symbol}.`
    );

    if (!canFaucet && !canOwnerMint) {
      console.log("❌ This token does not appear to support faucet() or owner-mint from this signer.");
      console.log(
        "   Either fund the deployer with tokens manually, or point SPOKE_ARBITRUM_USDC_ADDRESS to your mock token."
      );
      await rl.close();
      process.exit(1);
    }

    const mintMethod = canFaucet ? "faucet" : "mint";
    const prompt = args.yes
      ? "yes"
      : await rl.question(
          `Mint ${ethers.formatUnits(shortfall, decimals)} ${symbol} to deployer via ${mintMethod}? (y/N) `
        );
    const ok = args.yes || /^y(es)?$/i.test(String(prompt).trim());
    if (!ok) {
      console.log("Aborted (not enough deployer balance to continue).");
      await rl.close();
      process.exit(1);
    }

    const mintTx =
      mintMethod === "faucet"
        ? await token.faucet(shortfall)
        : await token.mint(deployer.address, shortfall);
    console.log(`   ⏳ Mint tx sent... hash: ${mintTx.hash}`);
    await mintTx.wait();
    deployerBal = await token.balanceOf(deployer.address);
    console.log(`   ✅ New deployer balance: ${ethers.formatUnits(deployerBal, decimals)} ${symbol}`);
  }

  console.log("\n💸 Funding users (interactive)...");
  console.log("────────────────────────────────────────");
  if (!args.yes) {
    console.log("Controls per user: [y] send, [s] skip, [a] send all remaining, [q] quit");
  }

  let sendAll = !!args.yes;
  let funded = 0;
  let skipped = 0;
  let failed = 0;

  for (const user of wallets) {
    // Optional ETH top-up first (if enabled)
    if (ethEachWei > 0n) {
      try {
        const ethBefore = await ethers.provider.getBalance(user.address);
        const txEth = await deployer.sendTransaction({
          to: user.address,
          value: ethEachWei,
        });
        console.log(
          `\n⛽ ETH top-up -> ${user.nickname} (${user.address}) | before=${ethers.formatEther(
            ethBefore
          )} ETH | tx=${txEth.hash}`
        );
        await txEth.wait();
      } catch (e) {
        console.error(
          `\n⚠️ Failed ETH top-up for ${user.nickname} (${user.address}):`,
          e?.message || e
        );
      }
    }

    const before = await safeCall(token.balanceOf(user.address), 0n);
    const beforeFmt = ethers.formatUnits(before, decimals);

    let action = "y";
    if (!sendAll) {
      const ans = await rl.question(
        `\nFund ${user.nickname} (${user.address}) | current=${beforeFmt} ${symbol} -> send ${ethers.formatUnits(
          amountEach,
          decimals
        )} ${symbol}? (y/s/a/q) `
      );
      action = String(ans || "").trim().toLowerCase();
      if (action === "a") {
        sendAll = true;
        action = "y";
      }
    }

    if (action === "q") {
      console.log("\n👋 Quitting early by user request.");
      break;
    }
    if (action === "s" || action === "n" || action === "") {
      console.log("   ⏭️ skipped");
      skipped++;
      continue;
    }
    if (action !== "y") {
      console.log("   ⏭️ skipped (unrecognized input)");
      skipped++;
      continue;
    }

    try {
      const tx = await token.transfer(user.address, amountEach);
      console.log(`   ⏳ transfer tx: ${tx.hash}`);
      await tx.wait();
      const after = await safeCall(token.balanceOf(user.address), before);
      console.log(`   ✅ funded. new balance: ${ethers.formatUnits(after, decimals)} ${symbol}`);
      funded++;
    } catch (e) {
      console.error(`   ❌ failed to fund ${user.nickname}:`, e?.message || e);
      failed++;
    }
  }

  await rl.close();

  console.log("\n🎉 Funding run completed.");
  console.log("────────────────────────────────────────");
  console.log(`✅ Funded:  ${funded}`);
  console.log(`⏭️ Skipped: ${skipped}`);
  console.log(`❌ Failed:  ${failed}`);
}

main().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
