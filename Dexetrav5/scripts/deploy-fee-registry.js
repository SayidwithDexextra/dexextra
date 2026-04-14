const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FeeRegistry with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Configuration - these are the current hardcoded defaults
  const admin = deployer.address;
  const takerFeeBps = 7;      // 0.07%
  const makerFeeBps = 3;      // 0.03%
  const protocolFeeRecipient = process.env.RELAYER_ADDRESS || process.env.NEXT_PUBLIC_RELAYER_ADDRESS || deployer.address;
  const protocolFeeShareBps = 8000;  // 80% to protocol

  console.log("\nFeeRegistry Configuration:");
  console.log("  Admin:", admin);
  console.log("  Taker Fee:", takerFeeBps, "bps (0.07%)");
  console.log("  Maker Fee:", makerFeeBps, "bps (0.03%)");
  console.log("  Protocol Fee Recipient:", protocolFeeRecipient);
  console.log("  Protocol Fee Share:", protocolFeeShareBps, "bps (80%)");

  // Deploy FeeRegistry
  const FeeRegistry = await ethers.getContractFactory("FeeRegistry");
  const feeRegistry = await FeeRegistry.deploy(
    admin,
    takerFeeBps,
    makerFeeBps,
    protocolFeeRecipient,
    protocolFeeShareBps
  );

  await feeRegistry.waitForDeployment();
  const address = await feeRegistry.getAddress();

  console.log("\n✅ FeeRegistry deployed to:", address);
  
  // Verify deployment by reading back values
  const [readTaker, readMaker, readRecipient, readShare] = await feeRegistry.getFeeStructure();
  console.log("\nVerification - getFeeStructure():");
  console.log("  Taker Fee:", readTaker.toString(), "bps");
  console.log("  Maker Fee:", readMaker.toString(), "bps");
  console.log("  Protocol Recipient:", readRecipient);
  console.log("  Protocol Share:", readShare.toString(), "bps");

  console.log("\n📋 Add these to your .env.local:");
  console.log(`FEE_REGISTRY_ADDRESS=${address}`);
  console.log(`NEXT_PUBLIC_FEE_REGISTRY_ADDRESS=${address}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
