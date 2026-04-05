#!/usr/bin/env node

/**
 * test-dispute-event.js
 *
 * Creates a test dispute and immediately resolves it to trigger the
 * DisputeResolved event for testing Alchemy webhooks.
 *
 * Usage:
 *   npx hardhat run scripts/test-dispute-event.js --network sepolia
 *
 * Env vars:
 *   SANDBOX_OOV3_ADDRESS - SandboxOOv3 contract address
 *   DISPUTE_RELAY_ADDRESS - DisputeRelay contract address
 */

const { ethers } = require("hardhat");

const SANDBOX_OOV3_ADDRESS = process.env.SANDBOX_OOV3_ADDRESS || "0x0F5341665c9cc2bB663333b2f197A65E862b51b8";
const DISPUTE_RELAY_ADDRESS = process.env.DISPUTE_RELAY_ADDRESS || "0x94E2545BefE6085D719D733F2777ed8386ef803B";

const SANDBOX_OOV3_ABI = [
  "function assertTruth(bytes calldata claim, address asserter, address callbackRecipient, address escalationManager, uint64 liveness, address currency, uint256 bond, bytes32 identifier, bytes32 domainId) external returns (bytes32)",
  "function resolveAssertion(bytes32 assertionId, bool assertedTruthfully) external",
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
  "function disputeAssertion(bytes32 assertionId, address disputer) external",
  "function defaultIdentifier() external view returns (bytes32)",
  "function owner() external view returns (address)",
  "event AssertionMade(bytes32 indexed assertionId, bytes32 domainId, bytes claim, address indexed asserter, address callbackRecipient, address escalationManager, address caller, uint64 expirationTime, address currency, uint256 bond, bytes32 indexed identifier)",
  "event AssertionResolved(bytes32 indexed assertionId, address indexed bondRecipient, bool disputed, bool settlementResolution, address settleCaller)",
];

const DISPUTE_RELAY_ABI = [
  "function escalateDisputeDirectToVote(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bytes calldata claim, uint256 bondAmount, uint64 liveness) external returns (bytes32)",
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
  "function getDisputeCount() external view returns (uint256)",
  "function getAssertionIdAt(uint256 index) external view returns (bytes32)",
  "function poolBalance() external view returns (uint256)",
  "function deposit(uint256 amount) external",
  "function owner() external view returns (address)",
  "function bondToken() external view returns (address)",
  "event DisputeResolved(bytes32 indexed assertionId, address indexed hlMarket, bool challengerWon, uint256 winningPrice)",
  "event DisputeEscalated(bytes32 indexed assertionId, address indexed hlMarket, uint256 proposedPrice, uint256 challengedPrice, uint256 bondAmount, uint256 timestamp)",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

async function main() {
  const [signer] = await ethers.getSigners();
  const networkName = process.env.HARDHAT_NETWORK || "unknown";

  console.log("\n" + "=".repeat(70));
  console.log("  TEST DISPUTE EVENT - Alchemy Webhook Tester");
  console.log("=".repeat(70));
  console.log(`Network:        ${networkName}`);
  console.log(`Signer:         ${signer.address}`);
  console.log(`SandboxOOv3:    ${SANDBOX_OOV3_ADDRESS}`);
  console.log(`DisputeRelay:   ${DISPUTE_RELAY_ADDRESS}`);
  console.log("=".repeat(70));

  const sandbox = new ethers.Contract(SANDBOX_OOV3_ADDRESS, SANDBOX_OOV3_ABI, signer);
  const relay = new ethers.Contract(DISPUTE_RELAY_ADDRESS, DISPUTE_RELAY_ABI, signer);

  // Get bond token info
  const bondTokenAddr = await relay.bondToken();
  const bondToken = new ethers.Contract(bondTokenAddr, ERC20_ABI, signer);
  const decimals = await bondToken.decimals();
  const symbol = await bondToken.symbol();

  // Use a small bond amount for testing (0.001 WETH)
  const bondAmount = ethers.parseUnits("0.001", decimals);
  const totalNeeded = bondAmount * 2n; // Need 2x for assert + dispute

  console.log(`\nBond Token:     ${bondTokenAddr} (${symbol})`);
  console.log(`Bond Amount:    ${ethers.formatUnits(bondAmount, decimals)} ${symbol} (per side)`);
  console.log(`Total Needed:   ${ethers.formatUnits(totalNeeded, decimals)} ${symbol}`);

  // Check pool balance
  const poolBal = await relay.poolBalance();
  console.log(`Pool Balance:   ${ethers.formatUnits(poolBal, decimals)} ${symbol}`);

  // Check if we need to deposit
  if (poolBal < totalNeeded) {
    const needed = totalNeeded - poolBal;
    console.log(`\n📝 Pool needs ${ethers.formatUnits(needed, decimals)} ${symbol} more...`);
    
    // Check signer balance
    const signerBal = await bondToken.balanceOf(signer.address);
    console.log(`   Your balance: ${ethers.formatUnits(signerBal, decimals)} ${symbol}`);
    
    if (signerBal < needed) {
      console.error(`\n❌ Insufficient ${symbol} balance to fund pool.`);
      process.exit(1);
    }

    // Approve and deposit
    const allowance = await bondToken.allowance(signer.address, DISPUTE_RELAY_ADDRESS);
    if (allowance < needed) {
      console.log(`   Approving ${symbol}...`);
      const approveTx = await bondToken.approve(DISPUTE_RELAY_ADDRESS, needed);
      await approveTx.wait();
    }
    
    console.log(`   Depositing to pool...`);
    const depositTx = await relay.deposit(needed);
    await depositTx.wait();
    console.log(`   Deposited: ${depositTx.hash}`);
  }

  // Check relay owner
  const relayOwner = await relay.owner();
  console.log(`\nRelay Owner:    ${relayOwner}`);
  if (relayOwner.toLowerCase() !== signer.address.toLowerCase()) {
    console.error(`\n❌ You are not the DisputeRelay owner. Only owner can escalate disputes.`);
    console.error(`   Owner: ${relayOwner}`);
    console.error(`   You:   ${signer.address}`);
    process.exit(1);
  }

  // Create a fake market address for testing
  const testMarketAddress = ethers.Wallet.createRandom().address;
  const proposedPrice = ethers.parseUnits("100.00", 6);  // $100.00
  const challengedPrice = ethers.parseUnits("95.00", 6); // $95.00
  const claim = ethers.toUtf8Bytes(`Test dispute: Is $100.00 the correct price for test market ${testMarketAddress}?`);
  const liveness = 60n; // 60 seconds

  console.log(`\n📝 Creating test dispute via escalateDisputeDirectToVote...`);
  console.log(`   Test Market:      ${testMarketAddress}`);
  console.log(`   Proposed Price:   $100.00`);
  console.log(`   Challenged Price: $95.00`);

  // Escalate dispute
  const initTx = await relay.escalateDisputeDirectToVote(
    testMarketAddress,
    proposedPrice,
    challengedPrice,
    claim,
    bondAmount,
    liveness
  );
  console.log(`   Tx sent: ${initTx.hash}`);
  const initReceipt = await initTx.wait();
  console.log(`   Confirmed in block: ${initReceipt.blockNumber}`);

  // Find the assertion ID from logs
  let assertionId = null;
  for (const log of initReceipt.logs) {
    try {
      const parsed = relay.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "DisputeEscalated") {
        assertionId = parsed.args.assertionId;
        console.log(`\n✅ DisputeEscalated event found!`);
        break;
      }
    } catch {}
  }

  if (!assertionId) {
    // Fallback: try sandbox events
    for (const log of initReceipt.logs) {
      try {
        const parsed = sandbox.interface.parseLog({ topics: log.topics, data: log.data });
        if (parsed && parsed.name === "AssertionMade") {
          assertionId = parsed.args.assertionId;
          break;
        }
      } catch {}
    }
  }

  if (!assertionId) {
    console.error("❌ Could not find assertion ID in transaction logs");
    process.exit(1);
  }

  console.log(`   Assertion ID: ${assertionId}`);

  // Verify dispute exists
  const dispute = await relay.getDispute(assertionId);
  console.log(`\n📋 Dispute details:`);
  console.log(`   Market:          ${dispute.hlMarket}`);
  console.log(`   Proposed:        $${ethers.formatUnits(dispute.proposedPrice, 6)}`);
  console.log(`   Challenged:      $${ethers.formatUnits(dispute.challengedPrice, 6)}`);
  console.log(`   Resolved:        ${dispute.resolved}`);

  // Now resolve the dispute (challenger wins)
  console.log(`\n📝 Resolving dispute (challenger wins)...`);
  const challengerWins = true;
  const resolveTx = await sandbox.resolveAssertion(assertionId, !challengerWins); // false = challenger wins
  console.log(`   Tx sent: ${resolveTx.hash}`);
  const resolveReceipt = await resolveTx.wait();
  console.log(`   Confirmed in block: ${resolveReceipt.blockNumber}`);

  // Parse DisputeResolved event
  console.log(`\n🔍 Looking for DisputeResolved event...`);
  for (const log of resolveReceipt.logs) {
    try {
      const parsed = relay.interface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "DisputeResolved") {
        console.log(`\n✅ DisputeResolved event found!`);
        console.log(`   Assertion ID:    ${parsed.args.assertionId}`);
        console.log(`   Market:          ${parsed.args.hlMarket}`);
        console.log(`   Challenger Won:  ${parsed.args.challengerWon}`);
        console.log(`   Winning Price:   $${ethers.formatUnits(parsed.args.winningPrice, 6)}`);
        console.log(`\n   Raw log:`);
        console.log(`   Address: ${log.address}`);
        console.log(`   Topics:  ${JSON.stringify(log.topics, null, 2)}`);
        console.log(`   Data:    ${log.data}`);
      }
    } catch {}
  }

  // Verify final state
  const finalDispute = await relay.getDispute(assertionId);
  console.log(`\n📋 Final dispute state:`);
  console.log(`   Resolved:        ${finalDispute.resolved}`);
  console.log(`   Challenger Won:  ${finalDispute.challengerWon}`);

  console.log(`\n` + "=".repeat(70));
  console.log(`  TEST COMPLETE - Check Alchemy webhook for the event!`);
  console.log(`  Event topic: 0x132d38a4764a3b723f8a96d80fe88e2f04637beba6a6a84c3cf9dc4af2135c59`);
  console.log("=".repeat(70) + "\n");
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message);
  process.exit(1);
});
