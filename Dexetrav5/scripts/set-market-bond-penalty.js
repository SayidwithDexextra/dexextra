/* eslint-disable no-console */
// Updates the MarketBondManager creation penalty (bps) on-chain.
//
// Usage:
//   MARKET_BOND_MANAGER_ADDRESS=0x... MARKET_BOND_PENALTY_BPS=500 \
//   npx hardhat run scripts/set-market-bond-penalty.js --network hyperliquid
//
// Env (repo root .env.local / .env):
// - MARKET_BOND_MANAGER_ADDRESS (or NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS)
// - MARKET_BOND_PENALTY_BPS (default: 500)
// - MARKET_BOND_PENALTY_RECIPIENT (optional; defaults to current on-chain penaltyRecipient)
//
// Notes:
// - `setPenaltyConfig` is owner-only on MarketBondManager.
// - If penaltyBps > 0, recipient must be non-zero.

const path = require("path");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function requiredAddr(name, fallback = null) {
  const raw = process.env[name];
  const v = raw == null || String(raw).trim() === "" ? fallback : String(raw).trim();
  if (!v) throw new Error(`Missing env ${name}`);
  if (!ethers.isAddress(v)) throw new Error(`Invalid address env ${name}: ${v}`);
  return v;
}

function envUInt(name, fallback) {
  const raw = process.env[name];
  const v = raw == null || String(raw).trim() === "" ? fallback : String(raw).trim();
  if (!String(v).match(/^\d+$/)) throw new Error(`Invalid ${name} (expected integer): ${v}`);
  return BigInt(v);
}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log("--- Set MarketBondManager penalty ---");
  console.log("Network:", networkName);

  const bondManagerAddress =
    (process.env.MARKET_BOND_MANAGER_ADDRESS || "").trim() ||
    (process.env.NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS || "").trim();
  if (!bondManagerAddress) {
    throw new Error(
      "Missing MARKET_BOND_MANAGER_ADDRESS (or NEXT_PUBLIC_MARKET_BOND_MANAGER_ADDRESS)"
    );
  }
  if (!ethers.isAddress(bondManagerAddress)) {
    throw new Error(`Invalid bond manager address: ${bondManagerAddress}`);
  }

  const desiredBps = envUInt("MARKET_BOND_PENALTY_BPS", "500");
  if (desiredBps > 10000n) throw new Error("MARKET_BOND_PENALTY_BPS must be 0..10000");

  // Read-only contract first (to discover owner and current config)
  const bondManagerRead = await ethers.getContractAt("MarketBondManager", bondManagerAddress);
  const [owner, currentBpsRaw, currentRecipient] = await Promise.all([
    bondManagerRead.owner(),
    bondManagerRead.creationPenaltyBps(),
    bondManagerRead.penaltyRecipient(),
  ]);
  const currentBps = BigInt(currentBpsRaw.toString());

  console.log("Owner (on-chain):", owner);
  console.log("Current penalty (bps):", currentBps.toString());
  console.log("Current recipient:", currentRecipient);
  console.log("BondManager:", bondManagerAddress);
  console.log("Desired penalty (bps):", desiredBps.toString());

  // Choose a signing key that matches the on-chain owner.
  // We try a few common env vars used in this repo + an explicit override.
  const candidateKeyNames = [
    "MARKET_BOND_MANAGER_OWNER_PRIVATE_KEY",
    "ADMIN_PRIVATE_KEY",
    "PRIVATE_KEY_USERD",
    "PRIVATE_KEY_USER3",
    "PRIVATE_KEY_USER2",
    "PRIVATE_KEY_USER5",
    "ADMIN_PRIVATE_KEY_3",
  ];
  const ownerLower = String(owner).toLowerCase();
  let signer = null;
  let signerAddr = null;
  for (const k of candidateKeyNames) {
    const pk = (process.env[k] || "").trim();
    if (!pk) continue;
    if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) continue;
    const w = new ethers.Wallet(pk, ethers.provider);
    const addr = (await w.getAddress()).toLowerCase();
    if (addr === ownerLower) {
      signer = w;
      signerAddr = await w.getAddress();
      console.log("Using owner key from env:", k);
      break;
    }
  }
  if (!signer) {
    // Fall back to the default Hardhat signer if it happens to be the owner.
    const signers = await ethers.getSigners();
    const s0 = signers?.[0] || null;
    if (s0) {
      const addr = (await s0.getAddress()).toLowerCase();
      if (addr === ownerLower) {
        signer = s0;
        signerAddr = await s0.getAddress();
        console.log("Using Hardhat default signer (matches owner).");
      }
    }
  }
  if (!signer || !signerAddr) {
    throw new Error(
      `No configured private key matches MarketBondManager.owner (${owner}). ` +
        `Set MARKET_BOND_MANAGER_OWNER_PRIVATE_KEY to the owner's key (or ensure ADMIN_PRIVATE_KEY / PRIVATE_KEY_USERD... matches the owner).`
    );
  }
  console.log("Signer:", signerAddr);

  const recipientEnv = (process.env.MARKET_BOND_PENALTY_RECIPIENT || "").trim();
  const desiredRecipient =
    recipientEnv && recipientEnv.length ? requiredAddr("MARKET_BOND_PENALTY_RECIPIENT") : currentRecipient;

  if (desiredBps !== 0n && desiredRecipient === ethers.ZeroAddress) {
    throw new Error("Penalty recipient cannot be zero when penalty bps > 0");
  }

  const needsUpdate = currentBps !== desiredBps || String(currentRecipient).toLowerCase() !== String(desiredRecipient).toLowerCase();
  if (!needsUpdate) {
    console.log("✅ No change needed. Penalty already set.");
    return;
  }

  console.log("Updating to:", {
    penaltyBps: desiredBps.toString(),
    recipient: desiredRecipient,
  });

  const bondManager = await ethers.getContractAt("MarketBondManager", bondManagerAddress, signer);
  const tx = await bondManager.setPenaltyConfig(desiredBps, desiredRecipient);
  console.log("Tx:", tx.hash);
  console.log("Waiting for network to reflect update...");
  // Avoid hard-failing on flaky RPC receipt polling; confirm by reading state.
  let lastErr = null;
  for (let i = 0; i < 10; i++) {
    try {
      const [newBpsRaw, newRecipient] = await Promise.all([
        bondManagerRead.creationPenaltyBps(),
        bondManagerRead.penaltyRecipient(),
      ]);
      const newBps = BigInt(newBpsRaw.toString());
      if (
        newBps === desiredBps &&
        String(newRecipient).toLowerCase() === String(desiredRecipient).toLowerCase()
      ) {
        console.log("✅ Updated penalty (bps):", newBps.toString());
        console.log("✅ Updated recipient:", newRecipient);
        return;
      }
      console.log(
        `Not updated yet (attempt ${i + 1}/10): penalty=${newBps.toString()} recipient=${newRecipient}`
      );
      lastErr = null;
    } catch (e) {
      lastErr = e;
      console.log(`RPC read failed (attempt ${i + 1}/10). Retrying...`);
    }
    await sleep(3000);
  }
  if (lastErr) {
    throw lastErr;
  }
  throw new Error(`Timed out confirming update. Tx: ${tx.hash}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

