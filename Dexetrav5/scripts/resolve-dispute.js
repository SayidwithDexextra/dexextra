#!/usr/bin/env node

/**
 * resolve-dispute.js
 *
 * Instantly resolve a dispute via the SandboxOOv3 (test environments only).
 * This replaces the 48-96h DVM vote with an admin decision.
 *
 * Interactive mode (default):
 *   npx hardhat run scripts/resolve-dispute.js --network sepolia
 *
 * Non-interactive mode (env vars):
 *   ASSERTION_ID=0x... CHALLENGER_WINS=true npx hardhat run scripts/resolve-dispute.js --network sepolia
 */

const path = require("path");
const fs = require("fs");
const readline = require("readline");
const { ethers } = require("hardhat");

const SANDBOX_OOV3_ABI = [
  "function resolveAssertion(bytes32 assertionId, bool assertedTruthfully) external",
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
  "function owner() external view returns (address)",
];

const DISPUTE_RELAY_ABI = [
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
  "function getDisputeCount() external view returns (uint256)",
  "function getAssertionIdAt(uint256 index) external view returns (bytes32)",
];

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function main() {
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [signer] = await ethers.getSigners();

  console.log("\n>>> Resolve Dispute via SandboxOOv3");
  console.log("=".repeat(60));
  console.log(`Network:  ${networkName}`);
  console.log(`Signer:   ${signer.address}`);

  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-sandbox-deployment.json`
  );
  if (!fs.existsSync(deploymentPath)) {
    console.error(`Deployment file not found: ${deploymentPath}`);
    console.error("Run deploy-sandbox-oov3.js first.");
    process.exit(1);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { SANDBOX_OOV3, DISPUTE_RELAY } = deployment.contracts;
  const decimals = deployment.bondTokenInfo?.decimals || 18;
  const symbol = deployment.bondTokenInfo?.symbol || "TOKEN";

  console.log(`Sandbox:  ${SANDBOX_OOV3}`);
  console.log(`Relay:    ${DISPUTE_RELAY}`);

  const sandbox = new ethers.Contract(SANDBOX_OOV3, SANDBOX_OOV3_ABI, signer);
  const relay = new ethers.Contract(DISPUTE_RELAY, DISPUTE_RELAY_ABI, signer);

  let assertionId = process.env.ASSERTION_ID || "";
  let challengerWins;

  const isInteractive = !assertionId;

  if (isInteractive) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    // Show pending disputes
    const count = await relay.getDisputeCount();
    const total = Number(count);

    if (total > 0) {
      console.log(`\n  Disputes on this relay: ${total}`);
      console.log("  " + "-".repeat(56));

      const start = Math.max(0, total - 10);
      for (let i = start; i < total; i++) {
        const id = await relay.getAssertionIdAt(i);
        const d = await relay.getDispute(id);
        const status = d.resolved
          ? d.challengerWon ? "RESOLVED (challenger won)" : "RESOLVED (proposer won)"
          : "PENDING";
        const proposed = `$${(Number(d.proposedPrice) / 1e6).toFixed(2)}`;
        const challenged = `$${(Number(d.challengedPrice) / 1e6).toFixed(2)}`;
        console.log(`  [${i}] ${id.slice(0, 10)}...${id.slice(-8)}  ${proposed} vs ${challenged}  ${status}`);
      }
      console.log("");
    } else {
      console.log("\n  No disputes found on this relay.\n");
      rl.close();
      process.exit(0);
    }

    assertionId = (await ask(rl, "  Assertion ID (paste full 0x... or index number): ")).trim();

    if (/^\d+$/.test(assertionId)) {
      const idx = parseInt(assertionId, 10);
      if (idx < 0 || idx >= total) {
        console.error(`  Index ${idx} out of range (0-${total - 1})`);
        rl.close();
        process.exit(1);
      }
      assertionId = await relay.getAssertionIdAt(idx);
      console.log(`  Resolved index ${idx} -> ${assertionId}`);
    }

    if (!assertionId.startsWith("0x") || assertionId.length !== 66) {
      console.error("  Invalid assertion ID. Must be a 0x-prefixed 32-byte hex string.");
      rl.close();
      process.exit(1);
    }

    const winnerChoice = (await ask(rl, "  Who wins? [c]hallenger / [p]roposer (default: c): ")).trim().toLowerCase();
    challengerWins = winnerChoice !== "p" && winnerChoice !== "proposer";

    rl.close();
  } else {
    challengerWins = (process.env.CHALLENGER_WINS || "true").toLowerCase() === "true";
  }

  const assertedTruthfully = !challengerWins;

  console.log(`\n  Assertion ID:    ${assertionId}`);
  console.log(`  Challenger wins: ${challengerWins}`);

  // Pre-check
  console.log("\n  Checking assertion state...");
  const assertion = await sandbox.getAssertion(assertionId);
  if (assertion.asserter === ethers.ZeroAddress) {
    console.error("  Assertion not found. It may belong to a different OOv3 instance.");
    process.exit(1);
  }
  if (assertion.settled) {
    console.log("  Assertion is already settled.");
    const dispute = await relay.getDispute(assertionId);
    console.log(`    resolved:      ${dispute.resolved}`);
    console.log(`    challengerWon: ${dispute.challengerWon}`);
    process.exit(0);
  }

  console.log(`    asserter:  ${assertion.asserter}`);
  console.log(`    disputer:  ${assertion.disputer}`);
  console.log(`    bond:      ${ethers.formatUnits(assertion.bond, decimals)} ${symbol}`);

  // Resolve
  console.log(`\n  Resolving (assertedTruthfully=${assertedTruthfully})...`);
  const tx = await sandbox.resolveAssertion(assertionId, assertedTruthfully);
  const receipt = await tx.wait();
  console.log(`    tx: ${receipt.hash}`);

  // Verify
  const dispute = await relay.getDispute(assertionId);
  console.log("\n  DisputeRelay result:");
  console.log(`    hlMarket:        ${dispute.hlMarket}`);
  console.log(`    proposedPrice:   $${(Number(dispute.proposedPrice) / 1e6).toFixed(2)}`);
  console.log(`    challengedPrice: $${(Number(dispute.challengedPrice) / 1e6).toFixed(2)}`);
  console.log(`    resolved:        ${dispute.resolved}`);
  console.log(`    challengerWon:   ${dispute.challengerWon}`);
  console.log(`    bondAmount:      ${ethers.formatUnits(dispute.bondAmount, decimals)} ${symbol}`);

  const winner = dispute.challengerWon ? "CHALLENGER" : "PROPOSER";
  const winningPrice = dispute.challengerWon ? dispute.challengedPrice : dispute.proposedPrice;
  console.log(`\n  Result: ${winner} wins. Winning price: $${(Number(winningPrice) / 1e6).toFixed(2)}`);
  console.log("\n  Done.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nResolve failed:", e.message || e);
    process.exit(1);
  });
