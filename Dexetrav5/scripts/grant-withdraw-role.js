const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  const RELAYER = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";
  
  console.log("Granting WITHDRAW_REQUESTER_ROLE on CollateralHub...");
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("Relayer:", RELAYER);
  
  const wallet = new ethers.Wallet(process.env.CREATOR_PRIVATE_KEY, ethers.provider);
  console.log("Admin:", wallet.address);
  
  const hub = new ethers.Contract(COLLATERAL_HUB, [
    "function grantRole(bytes32 role, address account) external",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ], wallet);
  
  const WITHDRAW_REQUESTER_ROLE = ethers.keccak256(ethers.toUtf8Bytes("WITHDRAW_REQUESTER_ROLE"));
  
  const tx = await hub.grantRole(WITHDRAW_REQUESTER_ROLE, RELAYER);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("✅ Done");
  
  const hasRole = await hub.hasRole(WITHDRAW_REQUESTER_ROLE, RELAYER);
  console.log("Relayer has WITHDRAW_REQUESTER_ROLE:", hasRole);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
