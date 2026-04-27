const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const NEW_INBOX = "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18";
  const HUB_DOMAIN = 999;
  const HUB_OUTBOX = "0x4c32ff22b927a134a3286d5E33212debF951AcF5";
  const RELAYER = "0x84b1e48e10d6326ed70a1947aaabf49ac8e290c7"; // Arbitrum relayer
  
  // Admin key: 0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306
  const adminKey = "0x8ec417aba0500c50c84eeae13b4cad3e7d3a31df86beca0c7838227a37539c89";
  
  console.log("Configuring SpokeBridgeInbox at:", NEW_INBOX);
  
  const wallet = new ethers.Wallet(adminKey, ethers.provider);
  console.log("Admin wallet:", wallet.address);
  
  const inbox = new ethers.Contract(NEW_INBOX, [
    "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
    "function grantRole(bytes32 role, address account) external",
    "function remoteAppByDomain(uint64) view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ], wallet);
  
  // Set remote app for Hyperliquid
  const remoteApp = "0x" + "0".repeat(24) + HUB_OUTBOX.slice(2).toLowerCase();
  console.log("\n1. Setting remote app for domain", HUB_DOMAIN);
  console.log("   Remote app:", remoteApp);
  
  const tx1 = await inbox.setRemoteApp(HUB_DOMAIN, remoteApp);
  console.log("   TX:", tx1.hash);
  await tx1.wait();
  console.log("   ✅ Done");
  
  // Grant BRIDGE_ENDPOINT_ROLE to relayer
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  console.log("\n2. Granting BRIDGE_ENDPOINT_ROLE to relayer");
  console.log("   Relayer:", RELAYER);
  
  const tx2 = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  console.log("   TX:", tx2.hash);
  await tx2.wait();
  console.log("   ✅ Done");
  
  // Verify
  console.log("\n=== Verification ===");
  const storedRemoteApp = await inbox.remoteAppByDomain(HUB_DOMAIN);
  console.log("Remote app for domain 999:", storedRemoteApp);
  const hasRole = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  console.log("Relayer has BRIDGE_ENDPOINT_ROLE:", hasRole);
  
  console.log("\n=== Update .env.local ===");
  console.log(`SPOKE_INBOX_ADDRESS_ARBITRUM=${NEW_INBOX}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
