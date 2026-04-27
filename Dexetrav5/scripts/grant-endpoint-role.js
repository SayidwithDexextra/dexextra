const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const NEW_INBOX = "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18";
  const RELAYER = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306"; // Actual fallback relayer

  // Admin key for new inbox (0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306)
  const adminKey = "0x8ec417aba0500c50c84eeae13b4cad3e7d3a31df86beca0c7838227a37539c89";

  console.log("Granting BRIDGE_ENDPOINT_ROLE on SpokeBridgeInbox to relayer...");
  console.log("Inbox:", NEW_INBOX);
  console.log("Relayer:", RELAYER);

  const wallet = new ethers.Wallet(adminKey, ethers.provider);
  console.log("Admin:", wallet.address);

  const inbox = new ethers.Contract(NEW_INBOX, [
    "function grantRole(bytes32 role, address account) external",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ], wallet);

  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  
  const tx = await inbox.grantRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("✅ Done");

  const hasRole = await inbox.hasRole(BRIDGE_ENDPOINT_ROLE, RELAYER);
  console.log("Relayer has BRIDGE_ENDPOINT_ROLE:", hasRole);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
