const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const SPOKE_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091";
  const NEW_INBOX = "0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18";
  
  // Admin key for SpokeVault (CREATOR: 0x428d7cBd7feccf01a80dACE3d70b8eCf06451500)
  const adminKey = process.env.CREATOR_PRIVATE_KEY;
  
  console.log("Granting BRIDGE_INBOX_ROLE on SpokeVault to new inbox...");
  
  const wallet = new ethers.Wallet(adminKey, ethers.provider);
  console.log("Admin:", wallet.address);
  
  const vault = new ethers.Contract(SPOKE_VAULT, [
    "function setBridgeInbox(address _inbox) external",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ], wallet);
  
  const tx = await vault.setBridgeInbox(NEW_INBOX);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("✅ Done");
  
  // Verify
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  const hasRole = await vault.hasRole(BRIDGE_INBOX_ROLE, NEW_INBOX);
  console.log("New inbox has BRIDGE_INBOX_ROLE:", hasRole);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
