const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const HUB_INBOX = process.env.HUB_INBOX_ADDRESS;
  const NEW_COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  console.log("=".repeat(60));
  console.log("FIX: Update HubBridgeInbox to point to new CollateralHub");
  console.log("=".repeat(60));
  console.log("HubBridgeInbox:", HUB_INBOX);
  console.log("New CollateralHub:", NEW_COLLATERAL_HUB);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  const HubInboxABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
    "function collateralHub() view returns (address)",
    "function setCollateralHub(address _collateralHub) external"
  ];
  
  const inbox = new ethers.Contract(HUB_INBOX, HubInboxABI, wallet);
  
  const currentHub = await inbox.collateralHub();
  console.log("\nCurrent CollateralHub:", currentHub);
  console.log("Target CollateralHub:", NEW_COLLATERAL_HUB);
  
  if (currentHub.toLowerCase() === NEW_COLLATERAL_HUB.toLowerCase()) {
    console.log("\n✅ Already pointing to correct CollateralHub!");
    return;
  }
  
  // Check if wallet is admin
  const DEFAULT_ADMIN_ROLE = await inbox.DEFAULT_ADMIN_ROLE();
  const isAdmin = await inbox.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
  console.log("Wallet is admin:", isAdmin);
  
  if (!isAdmin) {
    throw new Error("Wallet does not have DEFAULT_ADMIN_ROLE on HubBridgeInbox");
  }
  
  console.log("\nUpdating CollateralHub address...");
  const tx = await inbox.setCollateralHub(NEW_COLLATERAL_HUB);
  console.log("TX hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("TX confirmed in block:", receipt.blockNumber);
  
  const newHub = await inbox.collateralHub();
  console.log("New CollateralHub:", newHub);
  
  if (newHub.toLowerCase() === NEW_COLLATERAL_HUB.toLowerCase()) {
    console.log("\n✅ SUCCESS: HubBridgeInbox now points to new CollateralHub!");
  } else {
    console.log("\n❌ FAILED: Update did not work");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
