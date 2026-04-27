const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  // The unprocessed 0.01 USDC deposit
  const DEPOSIT = {
    chainId: 42161,
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    amount: "10000", // 0.01 USDC
    depositId: "0x56fbd3a17049381241dbcb1dfddfa9c801c53e09a39c31ab357b097628418127"
  };

  console.log("=".repeat(60));
  console.log("CREDIT: Missing 0.01 USDC deposit");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("\nDeposit details:");
  console.log("  User:", DEPOSIT.user);
  console.log("  Amount:", DEPOSIT.amount, "(0.01 USDC)");
  console.log("  Deposit ID:", DEPOSIT.depositId);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) throw new Error("Missing CREATOR_PRIVATE_KEY");
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  const CollateralHubABI = [
    "function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external",
    "function processedDepositIds(bytes32) view returns (bool)"
  ];
  
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  
  const alreadyProcessed = await hub.processedDepositIds(DEPOSIT.depositId);
  console.log("Already processed:", alreadyProcessed);
  
  if (alreadyProcessed) {
    console.log("\n✅ Already credited!");
    return;
  }
  
  console.log("\nCrediting user...");
  const tx = await hub.creditFromBridge(
    DEPOSIT.chainId,
    DEPOSIT.user,
    DEPOSIT.amount,
    DEPOSIT.depositId
  );
  console.log("TX hash:", tx.hash);
  await tx.wait();
  
  console.log("\n✅ SUCCESS: User credited with 0.01 USDC!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
