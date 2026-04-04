#!/usr/bin/env node

/**
 * resolve-dispute.js
 *
 * Instantly resolve a dispute via the SandboxOOv3 (test environments only).
 * This replaces the 48-96h DVM vote with an admin decision.
 *
 * Usage:
 *   ASSERTION_ID=0x... npx hardhat run scripts/resolve-dispute.js --network sepolia
 *
 * Environment variables:
 *   ASSERTION_ID      - The assertion to resolve (required)
 *   CHALLENGER_WINS   - "true" or "false" (default: "true")
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

const SANDBOX_OOV3_ABI = [
  "function resolveAssertion(bytes32 assertionId, bool assertedTruthfully) external",
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
  "function owner() external view returns (address)",
];

const DISPUTE_RELAY_ABI = [
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
];

async function main() {
  const assertionId = process.env.ASSERTION_ID;
  if (!assertionId) {
    console.error("ASSERTION_ID env var is required.");
    console.error("Usage: ASSERTION_ID=0x... npx hardhat run scripts/resolve-dispute.js --network sepolia");
    process.exit(1);
  }

  const challengerWins = (process.env.CHALLENGER_WINS || "true").toLowerCase() === "true";
  // assertedTruthfully = true means proposer wins, so invert
  const assertedTruthfully = !challengerWins;

  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [signer] = await ethers.getSigners();

  console.log("\n>>> Resolve Dispute via SandboxOOv3");
  console.log("=".repeat(60));
  console.log(`Network:          ${networkName}`);
  console.log(`Signer:           ${signer.address}`);
  console.log(`Assertion ID:     ${assertionId}`);
  console.log(`Challenger wins:  ${challengerWins}`);

  // Load sandbox deployment
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
  const { SANDBOX_OOV3, DISPUTE_RELAY, BOND_TOKEN } = deployment.contracts;
  const decimals = deployment.bondTokenInfo?.decimals || 18;
  const symbol = deployment.bondTokenInfo?.symbol || "TOKEN";

  console.log(`\nSandboxOOv3:      ${SANDBOX_OOV3}`);
  console.log(`DisputeRelay:     ${DISPUTE_RELAY}`);

  const sandbox = new ethers.Contract(SANDBOX_OOV3, SANDBOX_OOV3_ABI, signer);
  const relay = new ethers.Contract(DISPUTE_RELAY, DISPUTE_RELAY_ABI, signer);

  // Pre-check: verify the assertion exists and is not yet settled
  console.log("\nChecking assertion state...");
  const assertion = await sandbox.getAssertion(assertionId);
  if (assertion.asserter === ethers.ZeroAddress) {
    console.error("Assertion not found. It may belong to a different OOv3 instance.");
    process.exit(1);
  }
  if (assertion.settled) {
    console.log("Assertion is already settled.");
    const dispute = await relay.getDispute(assertionId);
    console.log(`  resolved:      ${dispute.resolved}`);
    console.log(`  challengerWon: ${dispute.challengerWon}`);
    process.exit(0);
  }

  console.log(`  asserter:    ${assertion.asserter}`);
  console.log(`  disputer:    ${assertion.disputer}`);
  console.log(`  bond:        ${ethers.formatUnits(assertion.bond, decimals)} ${symbol}`);
  console.log(`  settled:     ${assertion.settled}`);

  // Resolve
  console.log(`\nResolving (assertedTruthfully=${assertedTruthfully})...`);
  const tx = await sandbox.resolveAssertion(assertionId, assertedTruthfully);
  const receipt = await tx.wait();
  console.log(`  tx: ${receipt.hash}`);

  // Verify DisputeRelay received the callback
  const dispute = await relay.getDispute(assertionId);
  console.log("\nDisputeRelay state:");
  console.log(`  hlMarket:        ${dispute.hlMarket}`);
  console.log(`  proposedPrice:   $${(Number(dispute.proposedPrice) / 1e6).toFixed(2)}`);
  console.log(`  challengedPrice: $${(Number(dispute.challengedPrice) / 1e6).toFixed(2)}`);
  console.log(`  resolved:        ${dispute.resolved}`);
  console.log(`  challengerWon:   ${dispute.challengerWon}`);
  console.log(`  bondAmount:      ${ethers.formatUnits(dispute.bondAmount, decimals)} ${symbol}`);

  const winner = dispute.challengerWon ? "CHALLENGER" : "PROPOSER";
  const winningPrice = dispute.challengerWon ? dispute.challengedPrice : dispute.proposedPrice;
  console.log(`\nResult: ${winner} wins. Winning price: $${(Number(winningPrice) / 1e6).toFixed(2)}`);
  console.log("\nDone.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\nResolve failed:", e.message || e);
    process.exit(1);
  });
