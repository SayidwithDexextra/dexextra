#!/usr/bin/env node

/**
 * Test Exact UI Call
 * 
 * This script simulates the exact same placeLimitOrder call that the UI is making
 * to see if we can reproduce the issue or if it's a UI caching problem.
 */

const hre = require("hardhat");

async function main() {
  console.log("🎯 Testing Exact UI Call\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Exact parameters from the error message
  const TRADING_ROUTER_ADDRESS = "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B";
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  
  // Exact parameters from the error
  const marketId = "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";
  const side = 1; // SELL
  const size = 20000000; // 20 USDC (6 decimals)
  const price = 5000000; // 5 USDC (6 decimals)

  console.log("📋 Exact UI Call Parameters:");
  console.log(`   Market ID: ${marketId}`);
  console.log(`   Side: ${side} (${side === 0 ? 'BUY' : 'SELL'})`);
  console.log(`   Size: ${size} (${hre.ethers.formatUnits(size, 6)} USDC)`);
  console.log(`   Price: ${price} (${hre.ethers.formatUnits(price, 6)} USDC)`);
  console.log(`   Required Margin: ~${hre.ethers.formatUnits(size * price * 10 / 100, 12)} USDC\n`);

  try {
    // Check collateral before the call
    const vaultRouter = await hre.ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
    const availableBefore = await vaultRouter.getAvailableCollateral(deployer.address);
    console.log(`💰 Available Collateral: ${hre.ethers.formatUnits(availableBefore, 6)} USDC\n`);

    // Get TradingRouter contract
    const tradingRouter = await hre.ethers.getContractAt("TradingRouter", TRADING_ROUTER_ADDRESS);

    console.log("🚀 ATTEMPTING EXACT UI CALL");
    console.log("=".repeat(50));

    // Try the exact same call as the UI
    console.log("⏳ Calling TradingRouter.placeLimitOrder...");
    
    // First simulate the call to see what would happen
    try {
      await tradingRouter.placeLimitOrder.staticCall(marketId, side, size, price);
      console.log("✅ Static call succeeded - transaction should work");
    } catch (staticError) {
      console.log("❌ Static call failed:", staticError.reason || staticError.message);
      
      // Check if it's the collateral error
      if (staticError.message.includes("insufficient collateral")) {
        console.log("\n🔍 DEBUGGING THE COLLATERAL CHECK:");
        
        // Let's manually check what the VaultRouter sees
        const userCollateral = await vaultRouter.userCollateral(deployer.address);
        const marginUsed = await vaultRouter.getTotalMarginUsed(deployer.address);
        const marginReserved = await vaultRouter.getTotalMarginReserved(deployer.address);
        const available = userCollateral - marginUsed - marginReserved;
        
        console.log(`   User Collateral: ${hre.ethers.formatUnits(userCollateral, 6)} USDC`);
        console.log(`   Margin Used: ${hre.ethers.formatUnits(marginUsed, 6)} USDC`);
        console.log(`   Margin Reserved: ${hre.ethers.formatUnits(marginReserved, 6)} USDC`);
        console.log(`   Calculated Available: ${hre.ethers.formatUnits(available, 6)} USDC`);
        
        // Check if market is authorized
        const isMarketAuthorized = await vaultRouter.authorizedMarkets(marketId);
        console.log(`   Market Authorized: ${isMarketAuthorized}`);
        
        return;
      }
    }

    // If static call succeeded, try the actual transaction
    const tx = await tradingRouter.placeLimitOrder(marketId, side, size, price);
    console.log("📋 Transaction hash:", tx.hash);
    
    console.log("⏳ Waiting for confirmation...");
    const receipt = await tx.wait();
    console.log("✅ Transaction confirmed in block:", receipt.blockNumber);
    
    console.log("\n🎉 SUCCESS! The UI call worked from the script!");
    console.log("   This suggests the issue is with the frontend state management");
    console.log("   or wallet connection, not the contracts themselves.");

  } catch (error) {
    console.error("❌ UI call failed:", error.message);
    
    if (error.message.includes("insufficient collateral")) {
      console.log("\n🔍 COLLATERAL ERROR REPRODUCED");
      console.log("   The error is real, not just a UI issue");
      console.log("   Let's investigate further...");
      
      // Check if there's a difference in how we're reading the state
      const vaultRouter = await hre.ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
      const collateral = await vaultRouter.userCollateral(deployer.address);
      const available = await vaultRouter.getAvailableCollateral(deployer.address);
      
      console.log(`   Direct userCollateral: ${hre.ethers.formatUnits(collateral, 6)} USDC`);
      console.log(`   getAvailableCollateral: ${hre.ethers.formatUnits(available, 6)} USDC`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
