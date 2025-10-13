const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking ALUMINUM_V2 market status...\n");

  const factoryAddress = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";

  // Connect to factory
  const factory = await ethers.getContractAt(
    "OrderBookFactoryMinimal",
    factoryAddress
  );
  console.log("🏭 Connected to factory:", factoryAddress);

  try {
    // Check if ALUMINUM_V2 exists
    console.log("🔍 Checking if ALUMINUM_V2 market exists...");
    const marketId = await factory.getMarketBySymbol("ALUMINUM_V2");

    if (
      marketId !==
      "0x0000000000000000000000000000000000000000000000000000000000000000"
    ) {
      console.log("✅ ALUMINUM_V2 market already exists!");
      console.log("   Market ID:", marketId);

      const marketInfo = await factory.getMarket(marketId);
      console.log("   OrderBook:", marketInfo.orderBookAddress);
      console.log("   Active:", marketInfo.isActive);
      console.log("   Creator:", marketInfo.creator);
    } else {
      console.log("❌ ALUMINUM_V2 market does not exist");
    }
  } catch (error) {
    console.log("❌ ALUMINUM_V2 market does not exist (error):", error.message);
  }

  // Get all markets to see what exists
  console.log("\n📊 All existing markets:");
  try {
    const totalMarkets = await factory.getTotalMarkets();
    console.log("Total markets:", totalMarkets.toString());

    if (totalMarkets > 0) {
      const allMarkets = await factory.getAllMarkets();

      for (let i = 0; i < allMarkets.length; i++) {
        const marketId = allMarkets[i];
        const marketInfo = await factory.getMarket(marketId);
        console.log(
          `   ${i + 1}. ${marketInfo.symbol} (${marketInfo.orderBookAddress})`
        );
      }
    }
  } catch (error) {
    console.error("Error getting markets:", error.message);
  }

  // Try different variations
  const variations = [
    "Aluminum V2",
    "ALUMINUM_V2",
    "AluminumV2",
    "aluminum_v2",
  ];
  console.log("\n🔍 Checking symbol variations:");

  for (const symbol of variations) {
    try {
      const marketId = await factory.getMarketBySymbol(symbol);
      if (
        marketId !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        console.log(`✅ Found "${symbol}":`, marketId);
      } else {
        console.log(`❌ "${symbol}": not found`);
      }
    } catch (error) {
      console.log(`❌ "${symbol}": not found (error)`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
