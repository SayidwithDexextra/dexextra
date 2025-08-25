import { ethers } from "hardhat";

const SILVER_MARKET_ADDRESS = "0x07d317C87E6d8AF322463aCF024f1e28D38F6117";
const ORDER_ROUTER_ADDRESS = "0x516a1790a04250FC6A5966A528D02eF20E1c1891";

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("🔗 Registering Silver V1 market with OrderRouter...");
  console.log("Account:", signer.address);
  
  const orderRouter = await ethers.getContractAt("OrderRouter", ORDER_ROUTER_ADDRESS, signer);
  const orderBook = await ethers.getContractAt("OrderBook", SILVER_MARKET_ADDRESS, signer);
  
  // Get the metric ID from the market
  const metricId = await orderBook.metricId();
  console.log("Metric ID:", metricId);
  
  // Check current registration status
  const currentRegistration = await orderRouter.marketOrderBooks(metricId);
  console.log("Current registration:", currentRegistration);
  
  if (currentRegistration === ethers.ZeroAddress) {
    console.log("\n📝 Registering market with OrderRouter...");
    
    try {
      // Register the market
      const tx = await orderRouter.registerMarket(metricId, SILVER_MARKET_ADDRESS);
      console.log("Transaction submitted:", tx.hash);
      
      const receipt = await tx.wait();
      console.log("✅ Market registered successfully!");
      console.log("Gas used:", receipt!.gasUsed.toString());
      
      // Verify registration
      const newRegistration = await orderRouter.marketOrderBooks(metricId);
      console.log("New registration:", newRegistration);
      
      if (newRegistration.toLowerCase() === SILVER_MARKET_ADDRESS.toLowerCase()) {
        console.log("🎉 Registration verified! Market is now accessible through OrderRouter");
      } else {
        console.log("❌ Registration verification failed");
      }
      
    } catch (error: any) {
      console.error("❌ Registration failed:", error.message);
      if (error.reason) {
        console.error("Reason:", error.reason);
      }
      
      if (error.message.includes("AccessControl")) {
        console.log("💡 Note: You may need MARKET_ROLE permission to register markets");
      }
    }
  } else {
    console.log("✅ Market is already registered!");
  }
}

main().catch(console.error);
