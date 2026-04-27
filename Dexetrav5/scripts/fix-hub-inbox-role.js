const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  const HUB_INBOX = process.env.HUB_INBOX_ADDRESS;
  
  console.log("=".repeat(60));
  console.log("FIX: Grant BRIDGE_INBOX_ROLE to HubBridgeInbox");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("HubBridgeInbox:", HUB_INBOX);
  
  if (!COLLATERAL_HUB || !HUB_INBOX) {
    throw new Error("Missing COLLATERAL_HUB_ADDRESS or HUB_INBOX_ADDRESS in env");
  }

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("Using wallet:", wallet.address);
  
  const balance = await ethers.provider.getBalance(wallet.address);
  console.log("Wallet balance:", ethers.formatEther(balance), "HYPE");
  
  const CollateralHubABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account) external",
    "function getRoleAdmin(bytes32 role) view returns (bytes32)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)"
  ];
  
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  console.log("\nBRIDGE_INBOX_ROLE:", BRIDGE_INBOX_ROLE);
  
  // Check current state
  const hasRole = await hub.hasRole(BRIDGE_INBOX_ROLE, HUB_INBOX);
  console.log("HubBridgeInbox already has BRIDGE_INBOX_ROLE:", hasRole);
  
  if (hasRole) {
    console.log("\n✅ Role already granted - no action needed");
    return;
  }
  
  // Check if wallet is admin
  const DEFAULT_ADMIN_ROLE = await hub.DEFAULT_ADMIN_ROLE();
  const isAdmin = await hub.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
  console.log("Wallet is admin:", isAdmin);
  
  if (!isAdmin) {
    throw new Error("Wallet does not have DEFAULT_ADMIN_ROLE on CollateralHub");
  }
  
  // Grant role
  console.log("\nGranting BRIDGE_INBOX_ROLE to HubBridgeInbox...");
  const tx = await hub.grantRole(BRIDGE_INBOX_ROLE, HUB_INBOX);
  console.log("TX hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("TX confirmed in block:", receipt.blockNumber);
  
  // Verify
  const hasRoleAfter = await hub.hasRole(BRIDGE_INBOX_ROLE, HUB_INBOX);
  console.log("HubBridgeInbox has BRIDGE_INBOX_ROLE:", hasRoleAfter);
  
  if (hasRoleAfter) {
    console.log("\n✅ SUCCESS: Role granted successfully!");
  } else {
    console.log("\n❌ FAILED: Role grant failed");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
