const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  const SPOKE_OUTBOX_ARBITRUM = process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM;
  const RELAYER = process.env.RELAYER_ADDRESS;
  
  console.log("=".repeat(60));
  console.log("DEPLOY: New HubBridgeInbox");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("Spoke Outbox Arbitrum:", SPOKE_OUTBOX_ARBITRUM);
  console.log("Relayer:", RELAYER);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  const balance = await ethers.provider.getBalance(wallet.address);
  console.log("Wallet balance:", ethers.formatEther(balance), "HYPE");
  
  // Deploy new HubBridgeInbox
  console.log("\n--- Deploying HubBridgeInboxWormhole ---");
  const HubBridgeInbox = await ethers.getContractFactory("HubBridgeInboxWormhole", wallet);
  const inbox = await HubBridgeInbox.deploy(COLLATERAL_HUB, wallet.address);
  await inbox.waitForDeployment();
  const inboxAddress = await inbox.getAddress();
  console.log("New HubBridgeInbox deployed at:", inboxAddress);
  
  // Set up roles and configuration
  console.log("\n--- Configuring HubBridgeInbox ---");
  
  // 1. Set remote app for Arbitrum
  const ARBITRUM_DOMAIN = 42161;
  const remoteApp = ethers.zeroPadValue(SPOKE_OUTBOX_ARBITRUM, 32);
  console.log("Setting remote app for Arbitrum:", remoteApp);
  let tx = await inbox.setRemoteApp(ARBITRUM_DOMAIN, remoteApp);
  await tx.wait();
  console.log("Remote app set!");
  
  // 2. Grant BRIDGE_ENDPOINT_ROLE to relayer
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  console.log("Granting BRIDGE_ENDPOINT_ROLE to relayer...");
  tx = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  await tx.wait();
  console.log("Role granted!");
  
  // 3. Grant BRIDGE_INBOX_ROLE on CollateralHub to this new inbox
  console.log("\n--- Granting BRIDGE_INBOX_ROLE on CollateralHub ---");
  const CollateralHubABI = [
    "function grantRole(bytes32 role, address account) external",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ];
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  tx = await hub.grantRole(BRIDGE_INBOX_ROLE, inboxAddress);
  await tx.wait();
  console.log("BRIDGE_INBOX_ROLE granted to new inbox!");
  
  // Verify
  const hasRole = await hub.hasRole(BRIDGE_INBOX_ROLE, inboxAddress);
  console.log("New inbox has BRIDGE_INBOX_ROLE:", hasRole);
  
  // Output for env update
  console.log("\n" + "=".repeat(60));
  console.log("UPDATE .env.local:");
  console.log("=".repeat(60));
  console.log(`HUB_INBOX_ADDRESS=${inboxAddress}`);
  console.log("\n✅ DONE! Don't forget to update .env.local and restart your webhook.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
