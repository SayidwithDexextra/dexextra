import { ethers } from "hardhat";

/**
 * Script to fix market authorization issues in the DEX system
 * 
 * This script will:
 * 1. Check current authorization status of the SILVER_V1 market
 * 2. Authorize the market in CentralVault if needed
 * 3. Register the market with OrderRouter if needed
 * 4. Verify all authorizations are working correctly
 */

// Live Polygon contract addresses
const POLYGON_CONTRACTS = {
  centralVault: "0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C",
  orderRouter: "0x516a1790a04250FC6A5966A528D02eF20E1c1891",
  factory: "0x354f188944eF514eEEf05d8a31E63B33f87f16E0"
};

const SILVER_MARKET = {
  metricId: "SILVER_V1"
};

async function main() {
  console.log("🔧 Fixing Market Authorization Issues");
  console.log("=====================================");
  
  const [signer] = await ethers.getSigners();
  console.log("📋 Using account:", signer.address);
  
  // Load contracts
  const centralVault = await ethers.getContractAt("CentralVault", POLYGON_CONTRACTS.centralVault, signer);
  const orderRouter = await ethers.getContractAt("OrderRouter", POLYGON_CONTRACTS.orderRouter, signer);
  const factory = await ethers.getContractAt("MetricsMarketFactory", POLYGON_CONTRACTS.factory, signer);
  
  console.log("\n📊 Checking current authorization status...");
  
  // Get the orderbook address for SILVER_V1
  const orderbookAddress = await factory.getMarket(SILVER_MARKET.metricId);
  console.log(`OrderBook address: ${orderbookAddress}`);
  
  if (orderbookAddress === ethers.ZeroAddress) {
    console.log("❌ Market not found. Cannot proceed with authorization.");
    return;
  }
  
  // Check if market is authorized in CentralVault
  const isAuthorizedInVault = await centralVault.isAuthorizedMarket(orderbookAddress);
  console.log(`Market authorized in CentralVault: ${isAuthorizedInVault ? "✅" : "❌"}`);
  
  // Check if market is registered in OrderRouter
  let isRegisteredInRouter = false;
  try {
    const registeredOrderbook = await orderRouter.marketOrderBooks(SILVER_MARKET.metricId);
    isRegisteredInRouter = registeredOrderbook === orderbookAddress;
    console.log(`Market registered in OrderRouter: ${isRegisteredInRouter ? "✅" : "❌"}`);
    console.log(`  Expected: ${orderbookAddress}`);
    console.log(`  Actual: ${registeredOrderbook}`);
  } catch (error) {
    console.log(`Market registered in OrderRouter: ❌ (not found)`);
  }
  
  // Check current user's roles
  console.log("\n🔐 Checking user permissions...");
  
  const VAULT_ADMIN_ROLE = await centralVault.VAULT_ADMIN_ROLE();
  const hasVaultAdminRole = await centralVault.hasRole(VAULT_ADMIN_ROLE, signer.address);
  console.log(`User has VAULT_ADMIN_ROLE: ${hasVaultAdminRole ? "✅" : "❌"}`);
  
  const MARKET_ROLE = await orderRouter.MARKET_ROLE();
  const hasMarketRole = await orderRouter.hasRole(MARKET_ROLE, signer.address);
  console.log(`User has MARKET_ROLE: ${hasMarketRole ? "✅" : "❌"}`);
  
  const DEFAULT_ADMIN_ROLE = await centralVault.DEFAULT_ADMIN_ROLE();
  const hasDefaultAdminRole = await centralVault.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  console.log(`User has DEFAULT_ADMIN_ROLE: ${hasDefaultAdminRole ? "✅" : "❌"}`);
  
  // Check if we need to fix anything
  const needsVaultAuth = !isAuthorizedInVault;
  const needsRouterReg = !isRegisteredInRouter;
  
  if (!needsVaultAuth && !needsRouterReg) {
    console.log("\n✅ All authorizations are already in place!");
    return;
  }
  
  console.log("\n🛠️  Fixing authorization issues...");
  
  // Fix 1: Authorize market in CentralVault
  if (needsVaultAuth) {
    console.log("\n📝 Step 1: Authorizing market in CentralVault...");
    
    if (!hasVaultAdminRole && !hasDefaultAdminRole) {
      console.log("❌ User does not have VAULT_ADMIN_ROLE or DEFAULT_ADMIN_ROLE");
      console.log("💡 Trying to grant VAULT_ADMIN_ROLE first...");
      
      if (hasDefaultAdminRole) {
        try {
          await centralVault.grantRole(VAULT_ADMIN_ROLE, signer.address);
          console.log("✅ Granted VAULT_ADMIN_ROLE to user");
        } catch (error: any) {
          console.error("❌ Failed to grant VAULT_ADMIN_ROLE:", error.message);
        }
      } else {
        console.log("❌ Cannot grant roles - user lacks DEFAULT_ADMIN_ROLE");
        console.log("💡 The contract admin needs to grant VAULT_ADMIN_ROLE manually");
      }
    }
    
    try {
      console.log("🔐 Authorizing market in CentralVault...");
      const authTx = await centralVault.setMarketAuthorization(orderbookAddress, true);
      console.log(`Authorization transaction: ${authTx.hash}`);
      await authTx.wait();
      console.log("✅ Market authorized in CentralVault!");
      
      // Verify authorization
      const isNowAuthorized = await centralVault.isAuthorizedMarket(orderbookAddress);
      console.log(`Verification: Market is now authorized: ${isNowAuthorized ? "✅" : "❌"}`);
      
    } catch (error: any) {
      console.error("❌ Failed to authorize market in CentralVault:", error.message);
      if (error.message.includes("AccessControl")) {
        console.log("💡 User lacks required permissions for CentralVault authorization");
      }
    }
  }
  
  // Fix 2: Register market in OrderRouter
  if (needsRouterReg) {
    console.log("\n📝 Step 2: Registering market in OrderRouter...");
    
    if (!hasMarketRole && !hasDefaultAdminRole) {
      console.log("❌ User does not have MARKET_ROLE or DEFAULT_ADMIN_ROLE");
      console.log("💡 Trying to grant MARKET_ROLE first...");
      
      try {
        await orderRouter.grantRole(MARKET_ROLE, signer.address);
        console.log("✅ Granted MARKET_ROLE to user");
      } catch (error: any) {
        console.error("❌ Failed to grant MARKET_ROLE:", error.message);
        console.log("💡 The contract admin needs to grant MARKET_ROLE manually");
      }
    }
    
    try {
      console.log("🔗 Registering market in OrderRouter...");
      const regTx = await orderRouter.registerMarket(SILVER_MARKET.metricId, orderbookAddress);
      console.log(`Registration transaction: ${regTx.hash}`);
      await regTx.wait();
      console.log("✅ Market registered in OrderRouter!");
      
      // Verify registration
      const registeredAddress = await orderRouter.marketOrderBooks(SILVER_MARKET.metricId);
      const isNowRegistered = registeredAddress === orderbookAddress;
      console.log(`Verification: Market is now registered: ${isNowRegistered ? "✅" : "❌"}`);
      
    } catch (error: any) {
      console.error("❌ Failed to register market in OrderRouter:", error.message);
      if (error.message.includes("AccessControl")) {
        console.log("💡 User lacks required permissions for OrderRouter registration");
      }
    }
  }
  
  console.log("\n🎯 Final Authorization Check");
  console.log("============================");
  
  // Final verification
  const finalVaultAuth = await centralVault.isAuthorizedMarket(orderbookAddress);
  const finalRouterReg = await orderRouter.marketOrderBooks(SILVER_MARKET.metricId) === orderbookAddress;
  
  console.log(`✅ CentralVault Authorization: ${finalVaultAuth ? "WORKING" : "FAILED"}`);
  console.log(`✅ OrderRouter Registration: ${finalRouterReg ? "WORKING" : "FAILED"}`);
  
  if (finalVaultAuth && finalRouterReg) {
    console.log("\n🎉 SUCCESS: All authorization issues fixed!");
    console.log("===============================================");
    console.log(`✅ Market ${SILVER_MARKET.metricId} is fully authorized`);
    console.log(`✅ OrderBook: ${orderbookAddress}`);
    console.log(`✅ Ready for trading operations`);
  } else {
    console.log("\n⚠️  Some authorization issues remain:");
    if (!finalVaultAuth) {
      console.log("❌ CentralVault authorization still missing");
      console.log("💡 Manual intervention required by contract admin");
    }
    if (!finalRouterReg) {
      console.log("❌ OrderRouter registration still missing");
      console.log("💡 Manual intervention required by contract admin");
    }
  }
  
  console.log("\n📋 Authorization Details:");
  console.log(`  Market ID: ${SILVER_MARKET.metricId}`);
  console.log(`  OrderBook Address: ${orderbookAddress}`);
  console.log(`  CentralVault Address: ${POLYGON_CONTRACTS.centralVault}`);
  console.log(`  OrderRouter Address: ${POLYGON_CONTRACTS.orderRouter}`);
  console.log(`  User Address: ${signer.address}`);
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ Authorization script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Authorization script failed:", error);
      process.exit(1);
    });
}

export { main };
