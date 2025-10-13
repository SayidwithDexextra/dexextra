import { ethers } from "hardhat";

/**
 * Query script to inspect OrderBookFactoryMinimal and its markets
 * 
 * Usage:
 * npx hardhat run scripts/query-factory-markets.ts --network polygon
 */

const FACTORY_ADDRESS = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";

async function main() {
  console.log("🔍 Querying OrderBookFactoryMinimal Markets\n");

  // Connect to factory
  const factory = await ethers.getContractAt("OrderBookFactoryMinimal", FACTORY_ADDRESS);
  console.log("🏭 Factory Address:", FACTORY_ADDRESS);

  try {
    // Get basic factory info
    const owner = await factory.owner();
    const creationFee = await factory.marketCreationFee();
    const vaultRouter = await factory.vaultRouter();
    
    console.log("📋 Factory Information:");
    console.log(`   Owner: ${owner}`);
    console.log(`   Creation Fee: ${ethers.formatEther(creationFee)} MATIC`);
    console.log(`   VaultRouter: ${vaultRouter}`);

    // Get total markets
    const totalMarkets = await factory.getTotalMarkets();
    console.log(`\n📊 Total Markets: ${totalMarkets}`);

    if (totalMarkets == 0) {
      console.log("   No markets found in factory");
      return;
    }

    // Get all market IDs
    console.log("\n📋 Fetching all markets...");
    const allMarketIds = await factory.getAllMarkets();
    
    console.log(`\n📈 Market Details (${allMarketIds.length} markets):`);
    console.log("=".repeat(80));

    // Query each market
    for (let i = 0; i < allMarketIds.length; i++) {
      const marketId = allMarketIds[i];
      
      try {
        const marketInfo = await factory.getMarket(marketId);
        
        console.log(`\n${i + 1}. Market: ${marketInfo.symbol}`);
        console.log(`   Market ID: ${marketId}`);
        console.log(`   OrderBook: ${marketInfo.orderBookAddress}`);
        console.log(`   Active: ${marketInfo.isActive}`);
        console.log(`   Creator: ${marketInfo.creator}`);

        // Try to get OrderBook details
        try {
          const orderBook = await ethers.getContractAt("OrderBook", marketInfo.orderBookAddress);
          
          // Check if OrderBook has these methods
          try {
            const symbol = await orderBook.symbol();
            console.log(`   OrderBook Symbol: ${symbol}`);
          } catch {
            // Method may not exist
          }

          try {
            const isActive = await orderBook.isActive();
            console.log(`   OrderBook Active: ${isActive}`);
          } catch {
            // Method may not exist
          }

        } catch (error) {
          console.log(`   ⚠️  Could not connect to OrderBook contract`);
        }

        // Check polygonscan links
        console.log(`   🔗 OrderBook: https://polygonscan.com/address/${marketInfo.orderBookAddress}`);
        
      } catch (error: any) {
        console.error(`   ❌ Error querying market ${i + 1}:`, error.message);
      }
    }

    // Test symbol lookup
    console.log("\n🔍 Testing Symbol Lookups:");
    console.log("-".repeat(40));
    
    const testSymbols = ["ETH/USD", "BTC/USD", "MATIC/USD", "Aluminum V1"];
    
    for (const symbol of testSymbols) {
      try {
        const marketId = await factory.getMarketBySymbol(symbol);
        if (marketId !== "0x0000000000000000000000000000000000000000000000000000000000000000") {
          console.log(`✅ "${symbol}" exists: ${marketId}`);
        } else {
          console.log(`❌ "${symbol}" not found`);
        }
      } catch (error) {
        console.log(`❌ "${symbol}" lookup failed`);
      }
    }

    // Factory contract stats
    console.log("\n📊 Contract Statistics:");
    console.log("-".repeat(30));
    console.log(`Factory Code Size: Checking...`);
    
    const factoryCode = await ethers.provider.getCode(FACTORY_ADDRESS);
    console.log(`Factory Code Size: ${(factoryCode.length - 2) / 2} bytes`);
    
    // Check factory balance
    const factoryBalance = await ethers.provider.getBalance(FACTORY_ADDRESS);
    console.log(`Factory Balance: ${ethers.formatEther(factoryBalance)} MATIC`);

    console.log("\n🔗 Useful Links:");
    console.log(`   Factory Contract: https://polygonscan.com/address/${FACTORY_ADDRESS}`);
    console.log(`   VaultRouter: https://polygonscan.com/address/${vaultRouter}`);

  } catch (error: any) {
    console.error("❌ Query failed:", error.message);
    
    if (error.code === 'CALL_EXCEPTION') {
      console.error("💡 This might indicate:");
      console.error("   - Wrong network (should be polygon)");
      console.error("   - Contract not deployed at this address");
      console.error("   - Network connection issues");
    }
  }
}

main()
  .then(() => {
    console.log("\n✅ Query completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Query failed:", error);
    process.exit(1);
  });
