const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  // The FIRST missed deposit (not recorded in webhook)
  const DEPOSIT = {
    chainId: 42161, // Arbitrum
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    amount: "100000", // 0.1 USDC (6 decimals)
    depositId: "0xe7a5d3620571e20c14b23df9db015026babc5267cd98b8ea9a1b44c2c1731cbc"
  };

  console.log("=".repeat(60));
  console.log("MANUAL CREDIT: First deposit (missed by webhook)");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("\nDeposit details:");
  console.log("  User:", DEPOSIT.user);
  console.log("  Amount:", DEPOSIT.amount, "(0.1 USDC)");
  console.log("  Deposit ID:", DEPOSIT.depositId);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  const CollateralHubABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external",
    "function processedDepositIds(bytes32) view returns (bool)"
  ];
  
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  
  // Check if already processed
  const alreadyProcessed = await hub.processedDepositIds(DEPOSIT.depositId);
  console.log("Deposit already processed:", alreadyProcessed);
  
  if (alreadyProcessed) {
    console.log("\n✅ Deposit was already processed!");
    return;
  }
  
  // Credit the user (wallet already has BRIDGE_INBOX_ROLE from earlier)
  console.log("\nCrediting user via CollateralHub.creditFromBridge...");
  const tx = await hub.creditFromBridge(
    DEPOSIT.chainId,
    DEPOSIT.user,
    DEPOSIT.amount,
    DEPOSIT.depositId
  );
  console.log("TX hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("TX confirmed in block:", receipt.blockNumber);
  
  // Verify
  const processedAfter = await hub.processedDepositIds(DEPOSIT.depositId);
  console.log("Deposit processed:", processedAfter);
  
  if (processedAfter) {
    console.log("\n✅ SUCCESS: User credited with 0.1 USDC for first deposit!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
