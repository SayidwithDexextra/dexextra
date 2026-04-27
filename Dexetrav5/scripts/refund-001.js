const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  const REFUND = {
    chainId: 42161,
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    amount: "10000", // 0.01 USDC
  };
  const REFUND_ID = ethers.keccak256(ethers.toUtf8Bytes("refund-001-" + Date.now()));

  console.log("Refunding 0.01 USDC...");
  const wallet = new ethers.Wallet(process.env.CREATOR_PRIVATE_KEY, ethers.provider);
  const hub = new ethers.Contract(COLLATERAL_HUB, [
    "function creditFromBridge(uint64,address,uint256,bytes32) external"
  ], wallet);
  
  const tx = await hub.creditFromBridge(REFUND.chainId, REFUND.user, REFUND.amount, REFUND_ID);
  console.log("TX:", tx.hash);
  await tx.wait();
  console.log("✅ Refunded 0.01 USDC");
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
