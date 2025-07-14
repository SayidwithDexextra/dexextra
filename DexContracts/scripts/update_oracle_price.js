const hre = require("hardhat");

async function main() {
  console.log("🔮 Updating Oracle Price...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Updating with account:", deployer.address);

  // Oracle address - you can pass this as an argument or hardcode it
  const oracleAddress = process.argv[2];

  if (!oracleAddress) {
    console.error("❌ Please provide oracle address as argument:");
    console.error(
      "   npx hardhat run scripts/update_oracle_price.js --network localhost <ORACLE_ADDRESS>"
    );
    console.error("   Or:");
    console.error("   node scripts/update_oracle_price.js <ORACLE_ADDRESS>");
    process.exit(1);
  }

  console.log("🎯 Oracle Address:", oracleAddress);

  try {
    // Connect to the oracle contract
    const mockOracle = await hre.ethers.getContractAt(
      "MockPriceOracle",
      oracleAddress
    );

    // Check current oracle status
    console.log("\n📊 Current Oracle Status:");
    const currentPrice = await mockOracle.getPriceWithTimestamp();
    console.log(
      "   • Current Price:",
      hre.ethers.formatEther(currentPrice[0]),
      "USD"
    );
    console.log(
      "   • Last Update:",
      new Date(Number(currentPrice[1]) * 1000).toLocaleString()
    );
    console.log("   • Is Active:", await mockOracle.isActive());
    console.log(
      "   • Max Price Age:",
      await mockOracle.getMaxPriceAge(),
      "seconds"
    );
    console.log("   • Current Time:", new Date().toLocaleString());

    // Calculate if price is stale
    const currentTime = Math.floor(Date.now() / 1000);
    const lastUpdate = Number(currentPrice[1]);
    const maxAge = Number(await mockOracle.getMaxPriceAge());
    const age = currentTime - lastUpdate;

    console.log("   • Price Age:", age, "seconds");
    console.log("   • Price Stale:", age > maxAge ? "YES ❌" : "NO ✅");

    // Simulate a new price (current price +/- 0-5% random change)
    const currentPriceValue = currentPrice[0];
    const randomChange = (Math.random() - 0.5) * 0.1; // -5% to +5%
    const newPriceValue =
      currentPriceValue +
      (currentPriceValue * BigInt(Math.floor(randomChange * 1000))) /
        BigInt(1000);

    console.log("\n🔄 Updating Oracle Price...");
    console.log(
      "   • New Price:",
      hre.ethers.formatEther(newPriceValue),
      "USD"
    );
    console.log(
      "   • Change:",
      (
        (Number(newPriceValue - currentPriceValue) /
          Number(currentPriceValue)) *
        100
      ).toFixed(2),
      "%"
    );

    // Update the price
    const tx = await mockOracle.updatePrice(newPriceValue);
    console.log("   • Transaction:", tx.hash);

    await tx.wait();
    console.log("✅ Oracle price updated successfully!");

    // Verify the update
    console.log("\n📈 Updated Oracle Status:");
    const updatedPrice = await mockOracle.getPriceWithTimestamp();
    console.log(
      "   • Updated Price:",
      hre.ethers.formatEther(updatedPrice[0]),
      "USD"
    );
    console.log(
      "   • Updated Time:",
      new Date(Number(updatedPrice[1]) * 1000).toLocaleString()
    );
    console.log("   • Is Active:", await mockOracle.isActive());

    console.log(
      "\n🎉 Oracle update complete! You can now interact with your vAMM contracts."
    );
  } catch (error) {
    console.error("❌ Failed to update oracle:", error.message);

    if (error.message.includes("not owner")) {
      console.error(
        "\n💡 Make sure you're using the same account that deployed the oracle."
      );
    }

    throw error;
  }
}

// Handle script execution
main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
