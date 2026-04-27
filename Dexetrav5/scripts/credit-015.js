const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  const USER = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";
  const AMOUNT = "150000"; // 0.15 USDC (6 decimals)
  const DEPOSIT_ID = ethers.keccak256(ethers.toUtf8Bytes("refund-015-" + Date.now()));

  console.log("Crediting 0.15 USDC to user...");
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("User:", USER);
  console.log("Amount:", AMOUNT, "(0.15 USDC)");
  
  const wallet = new ethers.Wallet(process.env.CREATOR_PRIVATE_KEY, ethers.provider);
  console.log("Caller:", wallet.address);
  
  const hub = new ethers.Contract(COLLATERAL_HUB, [
    "function creditFromBridge(uint64,address,uint256,bytes32) external"
  ], wallet);
  
  const tx = await hub.creditFromBridge(42161, USER, AMOUNT, DEPOSIT_ID);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("✅ Credited 0.15 USDC");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
