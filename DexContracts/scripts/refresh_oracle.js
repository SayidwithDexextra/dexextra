const hre = require("hardhat");
const fs = require("fs");

async function findOracleAddress() {
  console.log("🔍 Searching for deployed oracle address...");

  // Try to find oracle address from recent deployments
  // Check if there's a deployment artifacts or logs
  const deploymentsDir = "./deployments";
  const artifactsDir = "./artifacts";

  // Method 1: Check if user has the oracle address from previous runs
  const oracleAddress = process.argv[2];
  if (oracleAddress && hre.ethers.isAddress(oracleAddress)) {
    console.log("✅ Using provided oracle address:", oracleAddress);
    return oracleAddress;
  }

  // Method 2: Common deployed oracle addresses on localhost
  const commonAddresses = [
    "0x5FbDB2315678afecb367f032d93F642f64180aa3", // Common first deployment
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512", // Common second deployment
    "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0", // Common third deployment
  ];

  for (const addr of commonAddresses) {
    try {
      const contract = await hre.ethers.getContractAt("MockPriceOracle", addr);
      const price = await contract.getPrice();
      console.log("✅ Found oracle at:", addr);
      return addr;
    } catch (error) {
      // Address doesn't have a valid oracle
      continue;
    }
  }

  throw new Error(
    "Could not find oracle address. Please provide it as an argument: npx hardhat run scripts/refresh_oracle.js --network localhost <ORACLE_ADDRESS>"
  );
}

async function main() {
  console.log("🔮 Oracle Price Refresher\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Account:", deployer.address);

  try {
    // Find oracle address
    const oracleAddress = await findOracleAddress();

    // Connect to the oracle contract
    const mockOracle = await hre.ethers.getContractAt(
      "MockPriceOracle",
      oracleAddress
    );

    // Check current status
    console.log("\n📊 Current Oracle Status:");
    const [currentPrice, lastUpdate] = await mockOracle.getPriceWithTimestamp();
    const maxAge = await mockOracle.getMaxPriceAge();
    const currentTime = Math.floor(Date.now() / 1000);
    const age = currentTime - Number(lastUpdate);

    console.log("   • Price:", hre.ethers.formatEther(currentPrice), "USD");
    console.log(
      "   • Last Update:",
      new Date(Number(lastUpdate) * 1000).toLocaleString()
    );
    console.log("   • Age:", age, "seconds");
    console.log("   • Max Age:", maxAge.toString(), "seconds");
    console.log("   • Status:", age > maxAge ? "STALE ❌" : "FRESH ✅");

    if (age <= maxAge) {
      console.log("\n💡 Oracle price is still fresh. No update needed.");
      return;
    }

    // Update with a small random price change to simulate market movement
    const priceChange = (Math.random() - 0.5) * 0.02; // -1% to +1%
    const newPrice =
      currentPrice +
      (currentPrice * BigInt(Math.floor(priceChange * 1000))) / BigInt(1000);

    console.log("\n🔄 Updating Oracle...");
    console.log("   • New Price:", hre.ethers.formatEther(newPrice), "USD");
    console.log("   • Change:", (priceChange * 100).toFixed(2), "%");

    const tx = await mockOracle.updatePrice(newPrice);
    await tx.wait();

    console.log("✅ Oracle updated successfully!");
    console.log("   • Transaction:", tx.hash);

    // Verify
    const [updatedPrice, updatedTime] =
      await mockOracle.getPriceWithTimestamp();
    console.log("   • New Price:", hre.ethers.formatEther(updatedPrice), "USD");
    console.log(
      "   • Updated At:",
      new Date(Number(updatedTime) * 1000).toLocaleString()
    );

    console.log("\n🎉 Your vAMM contracts should now work properly!");
  } catch (error) {
    console.error("❌ Error:", error.message);

    if (error.message.includes("not owner")) {
      console.error(
        "\n💡 Solution: Make sure you're using the same account that deployed the oracle."
      );
      console.error(
        "   You can check the oracle owner with: mockOracle.owner()"
      );
    } else if (error.message.includes("Could not find oracle")) {
      console.error("\n💡 Solution: Run with oracle address as argument:");
      console.error(
        "   npx hardhat run scripts/refresh_oracle.js --network localhost <ORACLE_ADDRESS>"
      );
    }

    throw error;
  }
}

// Handle script execution
main()
  .then(() => {
    console.log("\n✨ Script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error.message);
    process.exit(1);
  });
