const { ethers } = require("hardhat");

async function main() {
  console.log("🧪 Testing market creation with different symbols...\n");

  const factoryAddress = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";

  // Connect to factory
  const factory = await ethers.getContractAt(
    "OrderBookFactoryMinimal",
    factoryAddress
  );
  console.log("🏭 Connected to factory:", factoryAddress);

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  // Test symbols to try
  const testSymbols = ["ALUM_V2", "ALUMINUM2", "ALV2"];

  for (const symbol of testSymbols) {
    console.log(`\n🧪 Testing symbol: "${symbol}"`);

    try {
      // Check if it exists first
      const existingMarketId = await factory.getMarketBySymbol(symbol);
      if (
        existingMarketId !==
        "0x0000000000000000000000000000000000000000000000000000000000000000"
      ) {
        console.log(`   ⚠️  Symbol "${symbol}" already exists`);
        continue;
      }

      const creationFee = await factory.marketCreationFee();
      console.log(
        `   💰 Creation fee: ${ethers.formatEther(creationFee)} MATIC`
      );

      // Estimate gas first
      console.log("   ⛽ Estimating gas...");
      const gasEstimate = await factory.createTraditionalMarket.estimateGas(
        symbol,
        {
          value: creationFee,
        }
      );
      console.log(`   ⛽ Gas estimate: ${gasEstimate.toString()}`);

      // Try the transaction
      console.log("   🔄 Creating market...");
      const tx = await factory.createTraditionalMarket(symbol, {
        value: creationFee,
        gasLimit: Math.floor(Number(gasEstimate) * 1.2), // 20% buffer
      });

      console.log(`   ⏳ Transaction: ${tx.hash}`);
      const receipt = await tx.wait();

      if (receipt.status === 1) {
        console.log(`   ✅ Successfully created "${symbol}"!`);
        console.log(`   ⛽ Gas used: ${receipt.gasUsed.toString()}`);

        // Parse event
        const marketCreatedEvent = receipt.logs.find((log) => {
          try {
            const parsed = factory.interface.parseLog(log);
            return parsed?.name === "MarketCreated";
          } catch {
            return false;
          }
        });

        if (marketCreatedEvent) {
          const parsedEvent = factory.interface.parseLog(marketCreatedEvent);
          console.log(`   🆔 Market ID: ${parsedEvent.args[0]}`);
          console.log(`   🏪 OrderBook: ${parsedEvent.args[1]}`);
        }

        // Stop at first success
        return {
          symbol,
          marketId: parsedEvent?.args[0],
          orderBook: parsedEvent?.args[1],
        };
      } else {
        console.log(`   ❌ Transaction failed for "${symbol}"`);
      }
    } catch (error) {
      console.log(`   ❌ Error with "${symbol}":`, error.message);

      if (error.reason) {
        console.log(`   📋 Reason: ${error.reason}`);
      }
    }
  }

  console.log("\n❌ All test symbols failed");
  return null;
}

main()
  .then((result) => {
    if (result) {
      console.log("\n🎉 Success! Created market:", result);
    }
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
