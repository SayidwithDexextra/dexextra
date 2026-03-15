/**
 * Race-condition grant: pre-signs grantRole txs with the compromised admin key,
 * funds the account, then immediately broadcasts the pre-signed txs before a
 * sweeper bot can drain the funds.
 *
 * Steps:
 *   1. Pre-sign both grantRole txs offline (exact gas, nonce, etc.)
 *   2. Calculate exact gas cost needed
 *   3. Fund the admin from a separate funded account
 *   4. Immediately blast the pre-signed raw txs (no waiting for fund confirmation)
 *
 * Usage:  node scripts/relayers/grant-admin-race.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
const { ethers } = require("ethers");

const HUB_RPC = process.env.RPC_URL;
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY_3;
const FUNDER_PK = process.env.PRIVATE_KEY_USERD;

const TARGET_ADDR = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";
const COLLATERAL_HUB = "0x6bD4D6A4C19c85A5C37AA02b3F0421e623D7d0Ff";
const HUB_BRIDGE_OUTBOX = "0x4c32ff22b927a134a3286d5E33212debF951AcF5";

if (!HUB_RPC || !ADMIN_PK || !FUNDER_PK) {
  console.error("Missing RPC_URL / ADMIN_PRIVATE_KEY_3 / PRIVATE_KEY_USERD");
  process.exit(1);
}

const ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(HUB_RPC);

  const adminNorm = ADMIN_PK.startsWith("0x") ? ADMIN_PK : "0x" + ADMIN_PK;
  const funderNorm = FUNDER_PK.startsWith("0x") ? FUNDER_PK : "0x" + FUNDER_PK;

  const adminWallet = new ethers.Wallet(adminNorm, provider);
  const funderWallet = new ethers.Wallet(funderNorm, provider);

  console.log("Admin (compromised):", adminWallet.address);
  console.log("Funder:", funderWallet.address);
  console.log("Target for DEFAULT_ADMIN_ROLE:", TARGET_ADDR);

  const funderBalance = await provider.getBalance(funderWallet.address);
  console.log("Funder balance:", ethers.formatEther(funderBalance), "HYPE");

  const hub = new ethers.Contract(COLLATERAL_HUB, ABI, adminWallet);
  const outbox = new ethers.Contract(HUB_BRIDGE_OUTBOX, ABI, adminWallet);
  const adminRole = await hub.DEFAULT_ADMIN_ROLE();

  // Check if already done
  const hubHas = await hub.hasRole(adminRole, TARGET_ADDR);
  const outboxHas = await outbox.hasRole(adminRole, TARGET_ADDR);
  if (hubHas && outboxHas) {
    console.log("\nTarget already has DEFAULT_ADMIN_ROLE on both contracts. Nothing to do.");
    return;
  }

  // Build the list of txs we need
  const txsToSign = [];
  if (!hubHas) {
    txsToSign.push({ label: "CollateralHub.grantRole", contract: hub, target: COLLATERAL_HUB });
  }
  if (!outboxHas) {
    txsToSign.push({ label: "HubBridgeOutbox.grantRole", contract: outbox, target: HUB_BRIDGE_OUTBOX });
  }

  const { chainId } = await provider.getNetwork();
  const nonce = await provider.getTransactionCount(adminWallet.address, "pending");
  const feeData = await provider.getFeeData();

  // Use aggressive gas pricing to front-run the sweeper
  const basePriority = feeData.maxPriorityFeePerGas || ethers.parseUnits("1", "gwei");
  const baseMax = feeData.maxFeePerGas || ethers.parseUnits("1", "gwei");
  const maxPriorityFee = basePriority * 5n;
  const maxFee = (baseMax * 5n) > maxPriorityFee ? baseMax * 5n : maxPriorityFee + ethers.parseUnits("1", "gwei");

  const GAS_LIMIT = 80000n;

  console.log("\n--- Pre-signing transactions offline ---");
  const signedTxs = [];
  let totalGasCost = 0n;

  for (let i = 0; i < txsToSign.length; i++) {
    const { label, contract, target } = txsToSign[i];
    const calldata = contract.interface.encodeFunctionData("grantRole", [adminRole, TARGET_ADDR]);

    const txObj = {
      to: target,
      data: calldata,
      nonce: nonce + i,
      gasLimit: GAS_LIMIT,
      maxFeePerGas: maxFee,
      maxPriorityFeePerGas: maxPriorityFee,
      chainId,
      type: 2,
    };

    const signed = await adminWallet.signTransaction(txObj);
    signedTxs.push({ label, signed });
    totalGasCost += GAS_LIMIT * maxFee;
    console.log(`  [${i}] ${label} — nonce ${nonce + i}, signed ✓`);
  }

  // Add 20% buffer to gas cost
  const fundAmount = (totalGasCost * 120n) / 100n;
  console.log(`\nTotal gas budget: ${ethers.formatEther(totalGasCost)} HYPE`);
  console.log(`Funding amount (with 20% buffer): ${ethers.formatEther(fundAmount)} HYPE`);

  if (funderBalance < fundAmount) {
    console.error(`\nFunder has insufficient balance! Need ${ethers.formatEther(fundAmount)} HYPE`);
    process.exit(1);
  }

  // --- RACE SEQUENCE ---
  // Strategy: fund the account, wait for confirmation, then IMMEDIATELY
  // blast the pre-signed txs. The pre-signing saves precious milliseconds.
  console.log("\n=== EXECUTING RACE SEQUENCE ===");

  // Step 1: Send funding tx and wait for it to confirm
  console.log("Step 1: Funding admin account...");
  const fundTx = await funderWallet.sendTransaction({
    to: adminWallet.address,
    value: fundAmount,
    maxFeePerGas: maxFee,
    maxPriorityFeePerGas: maxPriorityFee,
  });
  console.log(`  Fund tx sent: ${fundTx.hash}`);
  const fundReceipt = await fundTx.wait();
  console.log(`  Fund confirmed in block ${fundReceipt.blockNumber}`);

  // Step 2: IMMEDIATELY blast the pre-signed txs — no delay
  const t0 = Date.now();
  console.log("Step 2: Broadcasting pre-signed grantRole txs NOW...");
  const broadcastPromises = signedTxs.map(async ({ label, signed }, i) => {
    try {
      const resp = await provider.broadcastTransaction(signed);
      console.log(`  [${i}] ${label} broadcast: ${resp.hash} (${Date.now() - t0}ms after fund)`);
      return { label, hash: resp.hash, resp };
    } catch (e) {
      console.error(`  [${i}] ${label} broadcast FAILED (${Date.now() - t0}ms):`, e.shortMessage || e.message);
      return { label, error: e };
    }
  });

  const results = await Promise.all(broadcastPromises);

  // Step 3: Wait for grantRole txs to confirm
  console.log("\nStep 3: Waiting for confirmations...");

  for (const r of results) {
    if (r.error) continue;
    try {
      console.log(`  Waiting for ${r.label}...`);
      const receipt = await r.resp.wait();
      console.log(`  ${r.label} confirmed in block ${receipt.blockNumber} — status: ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);
    } catch (e) {
      console.error(`  ${r.label} wait FAILED:`, e.shortMessage || e.message);
    }
  }

  // Step 4: Verify
  console.log("\n=== VERIFICATION ===");
  const hubVerify = await hub.hasRole(adminRole, TARGET_ADDR);
  const outboxVerify = await outbox.hasRole(adminRole, TARGET_ADDR);
  console.log(`CollateralHub  — ${TARGET_ADDR} has DEFAULT_ADMIN_ROLE: ${hubVerify}`);
  console.log(`HubBridgeOutbox — ${TARGET_ADDR} has DEFAULT_ADMIN_ROLE: ${outboxVerify}`);

  if (hubVerify && outboxVerify) {
    console.log("\n✓ SUCCESS — both roles granted!");
  } else {
    console.log("\n✗ PARTIAL OR FAILED — the sweeper may have drained funds first.");
    console.log("  You may need to retry, possibly with higher gas or a flashbots-style approach.");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
