const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  // The failed withdrawal - user's balance was debited but funds weren't released
  const REFUND = {
    chainId: 42161, // Arbitrum
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    amount: "100000", // 0.1 USDC that was debited
  };
  
  // Use a unique depositId for the refund credit
  const REFUND_DEPOSIT_ID = ethers.keccak256(ethers.toUtf8Bytes("refund-failed-withdrawal-" + Date.now()));

  console.log("=".repeat(60));
  console.log("REFUND: Re-credit user for failed withdrawal");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("\nRefund details:");
  console.log("  User:", REFUND.user);
  console.log("  Amount:", REFUND.amount, "(0.1 USDC)");
  console.log("  Refund ID:", REFUND_DEPOSIT_ID);

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
  const alreadyProcessed = await hub.processedDepositIds(REFUND_DEPOSIT_ID);
  console.log("Refund already processed:", alreadyProcessed);
  
  if (alreadyProcessed) {
    console.log("\n✅ Refund was already processed!");
    return;
  }
  
  // Credit the user
  console.log("\nRe-crediting user via CollateralHub.creditFromBridge...");
  const tx = await hub.creditFromBridge(
    REFUND.chainId,
    REFUND.user,
    REFUND.amount,
    REFUND_DEPOSIT_ID
  );
  console.log("TX hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("TX confirmed in block:", receipt.blockNumber);
  
  // Verify
  const processedAfter = await hub.processedDepositIds(REFUND_DEPOSIT_ID);
  console.log("Refund processed:", processedAfter);
  
  if (processedAfter) {
    console.log("\n✅ SUCCESS: User re-credited with 0.1 USDC!");
    console.log("\nNOTE: The cross-chain withdrawal API needs to be fixed to use Native USDC");
    console.log("      instead of Bridged USDC.e for Arbitrum withdrawals.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
