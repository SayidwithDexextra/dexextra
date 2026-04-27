const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const SPOKE_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091"; // New SpokeVault with Native USDC
  const ADMIN = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306"; // Creator address
  const HUB_DOMAIN = 999;
  const HUB_OUTBOX = "0x4c32ff22b927a134a3286d5E33212debF951AcF5";
  const RELAYER = "0x84b1e48e10d6326ed70a1947aaabf49ac8e290c7"; // Arbitrum relayer

  console.log("Deploying new SpokeBridgeInboxWormhole on Arbitrum...");
  console.log("  - SpokeVault:", SPOKE_VAULT);
  console.log("  - Admin:", ADMIN);
  
  const wallet = new ethers.Wallet(process.env.CREATOR_PRIVATE_KEY, ethers.provider);
  console.log("  - Deployer:", wallet.address);
  
  const SpokeBridgeInbox = await ethers.getContractFactory("SpokeBridgeInboxWormhole", wallet);
  const inbox = await SpokeBridgeInbox.deploy(SPOKE_VAULT, ADMIN);
  await inbox.waitForDeployment();
  const inboxAddr = await inbox.getAddress();
  
  console.log("  ✅ SpokeBridgeInbox deployed:", inboxAddr);
  
  // Set remote app for Hyperliquid
  console.log("\nConfiguring remote app for domain", HUB_DOMAIN);
  const remoteApp = "0x" + "0".repeat(24) + HUB_OUTBOX.slice(2).toLowerCase();
  const tx1 = await inbox.setRemoteApp(HUB_DOMAIN, remoteApp);
  await tx1.wait();
  console.log("  ✅ Set remote app:", remoteApp);
  
  // Grant BRIDGE_ENDPOINT_ROLE to relayer
  console.log("\nGranting BRIDGE_ENDPOINT_ROLE to relayer");
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  const tx2 = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  await tx2.wait();
  console.log("  ✅ Granted BRIDGE_ENDPOINT_ROLE to:", RELAYER);
  
  console.log("\n=== Deployment Complete ===");
  console.log("New SpokeBridgeInbox:", inboxAddr);
  console.log("\nUpdate .env.local with:");
  console.log(`SPOKE_INBOX_ADDRESS_ARBITRUM=${inboxAddr}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
