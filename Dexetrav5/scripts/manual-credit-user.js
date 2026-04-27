const hre = require("hardhat");
const { ethers } = hre;

async function main() {
  const COLLATERAL_HUB = process.env.COLLATERAL_HUB_ADDRESS;
  
  // The missed deposit that went to OLD system
  const DEPOSIT = {
    chainId: 42161, // Arbitrum
    user: "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306",
    amount: "100000", // 0.1 USDC (6 decimals)
    depositId: "0x60720de494884bd21646aad855a51f56c1ff49b1d5ac350b7ea356f9018054b9"
  };
  
  // Use a unique depositId for the manual credit
  const MANUAL_DEPOSIT_ID = ethers.keccak256(ethers.toUtf8Bytes("manual-credit-" + DEPOSIT.depositId));

  console.log("=".repeat(60));
  console.log("MANUAL CREDIT: Credit user on new CoreVault");
  console.log("=".repeat(60));
  console.log("CollateralHub:", COLLATERAL_HUB);
  console.log("\nDeposit details:");
  console.log("  User:", DEPOSIT.user);
  console.log("  Amount:", DEPOSIT.amount, "(0.1 USDC)");
  console.log("  Original Deposit ID:", DEPOSIT.depositId);
  console.log("  Manual Credit ID:", MANUAL_DEPOSIT_ID);

  const CREATOR_PK = process.env.CREATOR_PRIVATE_KEY;
  if (!CREATOR_PK) {
    throw new Error("Missing CREATOR_PRIVATE_KEY in env");
  }
  
  const wallet = new ethers.Wallet(CREATOR_PK, ethers.provider);
  console.log("\nUsing wallet:", wallet.address);
  
  // Check if wallet has BRIDGE_INBOX_ROLE or DEFAULT_ADMIN_ROLE
  const CollateralHubABI = [
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account) external",
    "function creditFromBridge(uint64 chainId, address user, uint256 amount, bytes32 depositId) external",
    "function processedDepositIds(bytes32) view returns (bool)"
  ];
  
  const hub = new ethers.Contract(COLLATERAL_HUB, CollateralHubABI, wallet);
  
  const BRIDGE_INBOX_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_INBOX_ROLE"));
  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
  
  const hasBridgeRole = await hub.hasRole(BRIDGE_INBOX_ROLE, wallet.address);
  const isAdmin = await hub.hasRole(DEFAULT_ADMIN_ROLE, wallet.address);
  console.log("\nWallet has BRIDGE_INBOX_ROLE:", hasBridgeRole);
  console.log("Wallet is admin:", isAdmin);
  
  if (!hasBridgeRole && isAdmin) {
    console.log("Granting BRIDGE_INBOX_ROLE to wallet...");
    const tx = await hub.grantRole(BRIDGE_INBOX_ROLE, wallet.address);
    await tx.wait();
    console.log("Role granted!");
  } else if (!hasBridgeRole && !isAdmin) {
    throw new Error("Cannot credit - wallet needs BRIDGE_INBOX_ROLE");
  }
  
  // Check if manual credit was already processed
  const alreadyProcessed = await hub.processedDepositIds(MANUAL_DEPOSIT_ID);
  console.log("\nManual credit already processed:", alreadyProcessed);
  
  if (alreadyProcessed) {
    console.log("\n✅ Manual credit was already processed!");
    return;
  }
  
  // Credit the user
  console.log("\nCrediting user via CollateralHub.creditFromBridge...");
  const tx = await hub.creditFromBridge(
    DEPOSIT.chainId,
    DEPOSIT.user,
    DEPOSIT.amount,
    MANUAL_DEPOSIT_ID
  );
  console.log("TX hash:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("TX confirmed in block:", receipt.blockNumber);
  
  // Verify
  const processedAfter = await hub.processedDepositIds(MANUAL_DEPOSIT_ID);
  console.log("Manual credit processed:", processedAfter);
  
  if (processedAfter) {
    console.log("\n✅ SUCCESS: User credited with 0.1 USDC on new CoreVault!");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error:", error.message);
    process.exit(1);
  });
