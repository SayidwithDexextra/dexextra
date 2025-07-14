const hre = require("hardhat");

async function findOracleAddress() {
  console.log("🔍 Searching for deployed oracle address...");

  // Common deployed oracle addresses on localhost
  const commonAddresses = [
    "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
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
    "Could not find oracle address. Please deploy contracts first."
  );
}

async function main() {
  console.log("🔮 Oracle Debug & Refresh Tool\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Account:", deployer.address);

  try {
    // Find oracle address
    const oracleAddress = await findOracleAddress();
    const mockOracle = await hre.ethers.getContractAt(
      "MockPriceOracle",
      oracleAddress
    );

    console.log("\n📊 Oracle Status:");
    console.log("=".repeat(40));

    // Check current oracle status
    try {
      const [price, timestamp] = await mockOracle.getPriceWithTimestamp();
      console.log("   • Current Price:", hre.ethers.formatEther(price), "USD");
      console.log(
        "   • Last Update:",
        new Date(Number(timestamp) * 1000).toLocaleString()
      );

      const isActive = await mockOracle.isActive();
      console.log("   • Is Active:", isActive);

      const maxPriceAge = await mockOracle.maxPriceAge();
      console.log("   • Max Price Age:", maxPriceAge.toString(), "seconds");

      const currentTime = Math.floor(Date.now() / 1000);
      const ageSeconds = currentTime - Number(timestamp);
      console.log("   • Price Age:", ageSeconds, "seconds");

      if (ageSeconds > Number(maxPriceAge)) {
        console.log("   ❌ Price is STALE! (Age > Max Age)");
        console.log("   🔄 Refreshing oracle price...");

        // Refresh the oracle with current ETH price (example)
        const newPrice = hre.ethers.parseEther("2000"); // $2000 USD
        const tx = await mockOracle.updatePrice(newPrice);
        await tx.wait();

        console.log(
          "   ✅ Oracle price refreshed to:",
          hre.ethers.formatEther(newPrice),
          "USD"
        );
      } else {
        console.log("   ✅ Price is fresh and active");
      }
    } catch (error) {
      console.log("   ❌ Oracle Error:", error.message);

      if (error.message.includes("Oracle: inactive")) {
        console.log("   🔄 Activating oracle...");
        await mockOracle.setActive(true);
        console.log("   ✅ Oracle activated");
      }

      if (error.message.includes("Oracle: price too old")) {
        console.log("   🔄 Refreshing stale oracle price...");
        const newPrice = hre.ethers.parseEther("2000"); // $2000 USD
        const tx = await mockOracle.updatePrice(newPrice);
        await tx.wait();
        console.log(
          "   ✅ Oracle price refreshed to:",
          hre.ethers.formatEther(newPrice),
          "USD"
        );
      }
    }

    // Final status check
    console.log("\n🔍 Final Oracle Status:");
    console.log("=".repeat(40));
    try {
      const [finalPrice, finalTimestamp] =
        await mockOracle.getPriceWithTimestamp();
      console.log(
        "   • Final Price:",
        hre.ethers.formatEther(finalPrice),
        "USD"
      );
      console.log(
        "   • Final Update:",
        new Date(Number(finalTimestamp) * 1000).toLocaleString()
      );
      console.log("   • Is Active:", await mockOracle.isActive());
      console.log("   ✅ Oracle is ready for trading!");
    } catch (error) {
      console.log("   ❌ Final check failed:", error.message);
    }
  } catch (error) {
    console.error("❌ Error:", error.message);
    console.error("\n💡 To fix this issue:");
    console.error("   1. Make sure your local blockchain is running");
    console.error("   2. Deploy the contracts first:");
    console.error(
      "      npx hardhat run scripts/deploy_and_create_market.js --network localhost"
    );
    console.error("   3. Then run this script again");
  }
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
