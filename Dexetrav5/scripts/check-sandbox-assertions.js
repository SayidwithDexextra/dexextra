const { ethers } = require("hardhat");

const SANDBOX_OOV3 = process.env.SANDBOX_OOV3_ADDRESS || "0x0F5341665c9cc2bB663333b2f197A65E862b51b8";
const DISPUTE_RELAY = process.env.DISPUTE_RELAY_ADDRESS || "0x94E2545BefE6085D719D733F2777ed8386ef803B";

const SANDBOX_ABI = [
  "function getAssertion(bytes32 assertionId) external view returns (tuple(tuple(bool arbitrateViaEscalationManager, bool discardOracle, bool validateDisputers, address escalationManager) escalationManagerSettings, address asserter, uint64 assertionTime, bool settled, address currency, uint64 expirationTime, bool settlementResolution, bytes32 domainId, bytes32 identifier, uint256 bond, address callbackRecipient, address disputer))",
];

const RELAY_ABI = [
  "function getDisputeCount() external view returns (uint256)",
  "function getAssertionIdAt(uint256 index) external view returns (bytes32)",
  "function getDispute(bytes32 assertionId) external view returns (tuple(address hlMarket, uint256 proposedPrice, uint256 challengedPrice, bool resolved, bool challengerWon, uint256 bondAmount, uint256 timestamp))",
];

async function main() {
  const [signer] = await ethers.getSigners();
  
  console.log("\n=== SandboxOOv3 & DisputeRelay Check ===\n");
  console.log("SandboxOOv3:", SANDBOX_OOV3);
  console.log("DisputeRelay:", DISPUTE_RELAY);
  
  const sandbox = new ethers.Contract(SANDBOX_OOV3, SANDBOX_ABI, signer);
  const relay = new ethers.Contract(DISPUTE_RELAY, RELAY_ABI, signer);
  
  // Check dispute count in relay
  try {
    const count = await relay.getDisputeCount();
    console.log("\nDispute count in relay:", count.toString());
    
    // List all assertions in relay
    for (let i = 0; i < Math.min(Number(count), 10); i++) {
      const assertionId = await relay.getAssertionIdAt(i);
      console.log(`\n[${i}] Assertion: ${assertionId}`);
      
      try {
        const dispute = await relay.getDispute(assertionId);
        console.log("    Market:", dispute.hlMarket);
        console.log("    Proposed:", ethers.formatUnits(dispute.proposedPrice, 6));
        console.log("    Challenged:", ethers.formatUnits(dispute.challengedPrice, 6));
        console.log("    Resolved:", dispute.resolved);
        console.log("    ChallengerWon:", dispute.challengerWon);
      } catch (e) {
        console.log("    getDispute error:", e.message.substring(0, 100));
      }
      
      // Check if it exists in sandbox
      try {
        const assertion = await sandbox.getAssertion(assertionId);
        console.log("    In SandboxOOv3: YES, settled:", assertion.settled);
      } catch (e) {
        console.log("    In SandboxOOv3: NO (empty or error)");
      }
    }
  } catch (e) {
    console.log("Relay error:", e.message);
  }
  
  // Test the specific NETFLIX assertion
  const netflixAssertion = "0xe8984337b38cfe13d55d32d9af65318c0bcf5c255a7d5e3096297d2adb939369";
  console.log("\n=== Testing NETFLIX assertion ===");
  console.log("Assertion ID:", netflixAssertion);
  
  try {
    const assertion = await sandbox.getAssertion(netflixAssertion);
    console.log("Found in SandboxOOv3:", assertion);
  } catch (e) {
    console.log("Not found in SandboxOOv3:", e.message.substring(0, 150));
  }
  
  try {
    const dispute = await relay.getDispute(netflixAssertion);
    console.log("Found in DisputeRelay:", dispute);
  } catch (e) {
    console.log("Not found in DisputeRelay:", e.message.substring(0, 150));
  }
}

main().catch(console.error);
