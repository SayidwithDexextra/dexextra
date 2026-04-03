#!/usr/bin/env node

/**
 * test-dispute-relay.js
 *
 * End-to-end test of the DisputeRelay on Sepolia.
 * Simulates the full dispute lifecycle:
 *
 *   1. Funds the DisputeRelay pool with test USDC
 *   2. Calls escalateDisputeDirectToVote() (assert + auto-dispute → DVM)
 *   3. Checks assertion status on UMA OOv3
 *   4. Optionally resolves via MockOracleAncillary (sandbox only)
 *   5. Settles the assertion and verifies the callback result
 *
 * Usage:
 *   npx hardhat run scripts/test-dispute-relay.js --network sepolia
 *
 * Required env vars:
 *   - Deployment file at deployments/sepolia-dispute-relay-deployment.json
 *     (created by deploy-dispute-relay.js)
 *
 * Optional env vars:
 *   MOCK_ORACLE_ADDRESS  - If set, uses MockOracleAncillary to resolve the DVM vote
 *                          (for sandbox/local testing). If unset, the test stops
 *                          after escalation since real DVM votes take 48-96 hours.
 *   CHALLENGER_WINS      - "true" or "false" (default: "true") — which way to resolve
 */

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

const DISPUTE_RELAY_ABI = [
  "function escalateDisputeDirectToVote(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, string evidenceUrl, uint256 bondAmount, uint64 liveness) external returns (bytes32)",
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
  "function getDisputeCount() external view returns (uint256)",
  "function poolBalance() external view returns (uint256)",
  "function deposit(uint256 amount) external",
  "event DisputeEscalated(bytes32 indexed assertionId, address indexed hlMarket, uint256 proposedPrice, uint256 challengedPrice, uint256 bondAmount, uint256 timestamp)",
  "event DisputeResolved(bytes32 indexed assertionId, address indexed hlMarket, bool challengerWon, uint256 winningPrice)",
];

const OOV3_ABI = [
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
  "function settleAssertion(bytes32 assertionId) external",
  "function defaultIdentifier() external view returns (bytes32)",
];

const MOCK_ORACLE_ABI = [
  "function pushPriceByRequestId(bytes32 requestId, int256 price) external",
  "event PriceRequestAdded(address indexed requester, bytes32 indexed identifier, uint256 time, bytes ancillaryData, bytes32 indexed requestId)",
];

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function allowance(address, address) view returns (uint256)",
];

async function main() {
  console.log("\n🧪 DisputeRelay End-to-End Test");
  console.log("═".repeat(80));

  const network = await ethers.provider.getNetwork();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  const [signer] = await ethers.getSigners();

  console.log(`🌐 Network: ${networkName} (Chain ID: ${network.chainId})`);
  console.log(`👤 Signer: ${signer.address}`);

  // Load deployment
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${networkName}-dispute-relay-deployment.json`
  );
  if (!fs.existsSync(deploymentPath)) {
    console.error(`❌ Deployment file not found: ${deploymentPath}`);
    console.error("   Run deploy-dispute-relay.js first.");
    process.exit(1);
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  const { DISPUTE_RELAY, UMA_OOV3, BOND_TOKEN } = deployment.contracts;

  console.log(`\n📋 Contracts:`);
  console.log(`   DisputeRelay: ${DISPUTE_RELAY}`);
  console.log(`   UMA OOv3:     ${UMA_OOV3}`);
  console.log(`   Bond Token:   ${BOND_TOKEN}`);

  const relay = new ethers.Contract(DISPUTE_RELAY, DISPUTE_RELAY_ABI, signer);
  const oov3 = new ethers.Contract(UMA_OOV3, OOV3_ABI, signer);
  const token = new ethers.Contract(BOND_TOKEN, ERC20_ABI, signer);

  // ──────────────────────────────────────────────
  // Step 1: Fund the pool if needed
  // ──────────────────────────────────────────────
  console.log("\n📦 STEP 1: Check & fund pool");
  console.log("─".repeat(60));

  const bondAmount = ethers.parseUnits("50", 6); // 50 USDC per side
  const totalNeeded = bondAmount * 2n; // 100 USDC total (assert + dispute)

  let poolBal = await relay.poolBalance();
  console.log(`   Pool balance: ${ethers.formatUnits(poolBal, 6)} USDC`);

  if (poolBal < totalNeeded) {
    const deficit = totalNeeded - poolBal;
    console.log(`   Need ${ethers.formatUnits(totalNeeded, 6)}, funding ${ethers.formatUnits(deficit, 6)}...`);

    // Mint if MockUSDC
    try {
      await token.mint(signer.address, deficit);
      console.log(`   ✅ Minted ${ethers.formatUnits(deficit, 6)} test USDC`);
    } catch {
      console.log("   ℹ️  Could not mint (not MockUSDC). Ensure you have enough tokens.");
    }

    await token.approve(DISPUTE_RELAY, deficit);
    await relay.deposit(deficit);
    poolBal = await relay.poolBalance();
    console.log(`   ✅ Pool funded: ${ethers.formatUnits(poolBal, 6)} USDC`);
  } else {
    console.log("   ✅ Pool has sufficient funds");
  }

  // ──────────────────────────────────────────────
  // Step 2: Escalate a mock dispute
  // ──────────────────────────────────────────────
  console.log("\n🚀 STEP 2: Escalate mock dispute to UMA");
  console.log("─".repeat(60));

  const mockMarket = "0x0000000000000000000000000000000000000001";
  const proposedPrice = ethers.parseUnits("2500", 6);    // $2,500 (proposer's price)
  const challengedPrice = ethers.parseUnits("2700", 6);   // $2,700 (challenger's price)
  const evidenceUrl = "https://web.archive.org/web/20260101/example.com/price";
  const liveness = 120; // 2 minutes (irrelevant since we auto-dispute)

  console.log(`   Market (mock):     ${mockMarket}`);
  console.log(`   Proposed price:    $${ethers.formatUnits(proposedPrice, 6)}`);
  console.log(`   Challenged price:  $${ethers.formatUnits(challengedPrice, 6)}`);
  console.log(`   Bond per side:     ${ethers.formatUnits(bondAmount, 6)} USDC`);
  console.log(`   Evidence:          ${evidenceUrl}`);

  console.log("\n   Calling escalateDisputeDirectToVote()...");
  const tx = await relay.escalateDisputeDirectToVote(
    mockMarket,
    proposedPrice,
    challengedPrice,
    evidenceUrl,
    bondAmount,
    liveness
  );

  const receipt = await tx.wait();
  console.log(`   ✅ Transaction: ${receipt.hash}`);

  // Parse assertionId from event
  const iface = new ethers.Interface(DISPUTE_RELAY_ABI);
  let assertionId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed?.name === "DisputeEscalated") {
        assertionId = parsed.args.assertionId;
        break;
      }
    } catch {}
  }

  if (!assertionId) {
    console.error("   ❌ Could not parse assertionId from events");
    process.exit(1);
  }
  console.log(`   ✅ Assertion ID: ${assertionId}`);

  // ──────────────────────────────────────────────
  // Step 3: Verify state
  // ──────────────────────────────────────────────
  console.log("\n🔍 STEP 3: Verify on-chain state");
  console.log("─".repeat(60));

  const dispute = await relay.getDispute(assertionId);
  console.log(`   hlMarket:       ${dispute.hlMarket}`);
  console.log(`   proposedPrice:  ${ethers.formatUnits(dispute.proposedPrice, 6)}`);
  console.log(`   challengedPrice:${ethers.formatUnits(dispute.challengedPrice, 6)}`);
  console.log(`   resolved:       ${dispute.resolved}`);
  console.log(`   bondAmount:     ${ethers.formatUnits(dispute.bondAmount, 6)}`);

  // Check OOv3 assertion
  try {
    const assertion = await oov3.getAssertion(assertionId);
    console.log(`\n   OOv3 Assertion:`);
    console.log(`   asserter:      ${assertion.asserter}`);
    console.log(`   disputer:      ${assertion.disputer}`);
    console.log(`   settled:       ${assertion.settled}`);
    console.log(`   bond:          ${ethers.formatUnits(assertion.bond, 6)}`);

    const hasDisputer = assertion.disputer !== ethers.ZeroAddress;
    console.log(`   auto-disputed:  ${hasDisputer ? "YES ✅ (direct to DVM)" : "NO ❌"}`);
  } catch (e) {
    console.log(`   ⚠️  Could not read OOv3 assertion: ${e.message}`);
  }

  // ──────────────────────────────────────────────
  // Step 4: Resolve via MockOracle (sandbox only)
  // ──────────────────────────────────────────────
  const mockOracleAddr = process.env.MOCK_ORACLE_ADDRESS ||
    deployment.umaNetworkAddresses?.MockOracleAncillary || "";

  if (mockOracleAddr) {
    console.log("\n🗳️  STEP 4: Resolve via MockOracleAncillary (sandbox mode)");
    console.log("─".repeat(60));
    console.log(`   MockOracle: ${mockOracleAddr}`);

    const challengerWins = (process.env.CHALLENGER_WINS || "true").toLowerCase() === "true";
    // assertedTruthfully=true means proposer wins, but we framed it as
    // "proposer's price is correct" so: pushing 1e18 = proposer wins, 0 = challenger wins
    const priceToResolve = challengerWins
      ? 0n  // assertion was false → proposer was wrong → challenger wins
      : ethers.parseEther("1"); // assertion was true → proposer was right

    console.log(`   Resolving as: ${challengerWins ? "CHALLENGER WINS" : "PROPOSER WINS"}`);
    console.log(`   Price value:  ${priceToResolve.toString()}`);

    const mockOracle = new ethers.Contract(mockOracleAddr, MOCK_ORACLE_ABI, signer);

    // Find the PriceRequestAdded event from the dispute transaction
    const mockIface = new ethers.Interface(MOCK_ORACLE_ABI);
    let requestId = null;

    // Scan recent blocks for the PriceRequestAdded event
    const currentBlock = await ethers.provider.getBlockNumber();
    const fromBlock = Math.max(0, currentBlock - 100);
    const filter = {
      address: mockOracleAddr,
      fromBlock,
      toBlock: currentBlock,
    };

    try {
      const logs = await ethers.provider.getLogs(filter);
      for (const log of logs) {
        try {
          const parsed = mockIface.parseLog({ topics: log.topics, data: log.data });
          if (parsed?.name === "PriceRequestAdded") {
            requestId = parsed.args.requestId;
          }
        } catch {}
      }
    } catch (e) {
      console.log(`   ⚠️  Could not scan for PriceRequestAdded: ${e.message}`);
    }

    if (requestId) {
      console.log(`   Request ID: ${requestId}`);
      try {
        await mockOracle.pushPriceByRequestId(requestId, priceToResolve);
        console.log("   ✅ Price pushed to MockOracle");

        // Settle the assertion
        console.log("   Settling assertion...");
        await oov3.settleAssertion(assertionId);
        console.log("   ✅ Assertion settled");

        // Check result
        const resolvedDispute = await relay.getDispute(assertionId);
        console.log(`\n   🏆 RESULT:`);
        console.log(`   resolved:       ${resolvedDispute.resolved}`);
        console.log(`   challengerWon:  ${resolvedDispute.challengerWon}`);
        const winPrice = resolvedDispute.challengerWon
          ? resolvedDispute.challengedPrice
          : resolvedDispute.proposedPrice;
        console.log(`   winning price:  $${ethers.formatUnits(winPrice, 6)}`);
      } catch (e) {
        console.log(`   ⚠️  MockOracle resolution failed: ${e.message}`);
        console.log("   This is expected if using the public Sepolia OOv3 (no MockOracle).");
      }
    } else {
      console.log("   ⚠️  No PriceRequestAdded event found. MockOracle may not be wired to this OOv3.");
      console.log("   If using public Sepolia OOv3, the DVM vote must resolve naturally (48-96h).");
    }
  } else {
    console.log("\n⏸️  STEP 4: Skipped (no MOCK_ORACLE_ADDRESS)");
    console.log("   On public Sepolia, the DVM vote takes 48-96 hours to resolve.");
    console.log("   Monitor at: https://testnet.oracle.uma.xyz/");
    console.log("   After resolution, call settleAssertion and check getDispute.");
  }

  // ──────────────────────────────────────────────
  // Final summary
  // ──────────────────────────────────────────────
  console.log("\n" + "═".repeat(80));
  console.log("📊 TEST SUMMARY");
  console.log("═".repeat(80));

  const finalPoolBal = await relay.poolBalance();
  const disputeCount = await relay.getDisputeCount();

  console.log(`   Disputes created:  ${disputeCount}`);
  console.log(`   Pool balance:      ${ethers.formatUnits(finalPoolBal, 6)} USDC`);
  console.log(`   Assertion ID:      ${assertionId}`);

  const finalDispute = await relay.getDispute(assertionId);
  console.log(`   Status:            ${finalDispute.resolved ? "RESOLVED" : "PENDING (awaiting DVM vote)"}`);
  if (finalDispute.resolved) {
    console.log(`   Winner:            ${finalDispute.challengerWon ? "CHALLENGER" : "PROPOSER"}`);
  }

  console.log("\n✅ Test complete.\n");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ Test failed:", e.message || e);
    process.exit(1);
  });
