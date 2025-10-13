#!/usr/bin/env node

/**
 * Diagnose Collateral Issue
 * 
 * The user is still getting "insufficient collateral" errors even after depositing.
 * This script will help identify the root cause.
 */

const hre = require("hardhat");

async function main() {
  console.log("🔍 Diagnosing Collateral Issue\n");

  const [deployer] = await hre.ethers.getSigners();
  
  // Contract addresses
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const MOCK_USDC_ADDRESS = "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289";
  
  // The wallet address from the error message
  const ERROR_WALLET = "0x1bc0a803de77a004086e6010cd3f72ca7684e444";

  console.log("📋 Addresses to Check:");
  console.log(`   Deployer (script user): ${deployer.address}`);
  console.log(`   Error wallet (from UI): ${ERROR_WALLET}`);
  console.log(`   Same address?: ${deployer.address.toLowerCase() === ERROR_WALLET.toLowerCase()}\n`);

  try {
    const vaultRouter = await hre.ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
    const mockUSDC = await hre.ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);

    console.log("💰 DEPLOYER ACCOUNT STATE");
    console.log("=".repeat(50));
    
    const deployerUsdcBalance = await mockUSDC.balanceOf(deployer.address);
    const deployerCollateral = await vaultRouter.userCollateral(deployer.address);
    const deployerAvailable = await vaultRouter.getAvailableCollateral(deployer.address);
    
    console.log(`MockUSDC Balance: ${hre.ethers.formatUnits(deployerUsdcBalance, 6)} USDC`);
    console.log(`Total Collateral: ${hre.ethers.formatUnits(deployerCollateral, 6)} USDC`);
    console.log(`Available Collateral: ${hre.ethers.formatUnits(deployerAvailable, 6)} USDC\n`);

    console.log("🚨 ERROR WALLET STATE (from UI)");
    console.log("=".repeat(50));
    
    const errorUsdcBalance = await mockUSDC.balanceOf(ERROR_WALLET);
    const errorCollateral = await vaultRouter.userCollateral(ERROR_WALLET);
    const errorAvailable = await vaultRouter.getAvailableCollateral(ERROR_WALLET);
    const errorAllowance = await mockUSDC.allowance(ERROR_WALLET, VAULT_ROUTER_ADDRESS);
    
    console.log(`MockUSDC Balance: ${hre.ethers.formatUnits(errorUsdcBalance, 6)} USDC`);
    console.log(`Total Collateral: ${hre.ethers.formatUnits(errorCollateral, 6)} USDC`);
    console.log(`Available Collateral: ${hre.ethers.formatUnits(errorAvailable, 6)} USDC`);
    console.log(`VaultRouter Allowance: ${hre.ethers.formatUnits(errorAllowance, 6)} USDC\n`);

    console.log("🔍 DIAGNOSIS");
    console.log("=".repeat(50));

    if (deployer.address.toLowerCase() !== ERROR_WALLET.toLowerCase()) {
      console.log("❌ ISSUE IDENTIFIED: Wallet Mismatch!");
      console.log("   The script deposited collateral to the deployer account,");
      console.log("   but the UI is using a different wallet address.");
      console.log("");
      console.log("🔧 SOLUTIONS:");
      console.log("   1. Use the same wallet in the UI as the deployer account");
      console.log(`      Switch UI wallet to: ${deployer.address}`);
      console.log("");
      console.log("   2. OR deposit collateral to the UI wallet:");
      console.log(`      Target wallet: ${ERROR_WALLET}`);
      
      // Check if error wallet has MockUSDC
      if (errorUsdcBalance > 0n) {
        console.log("   ✅ Error wallet has MockUSDC - can deposit directly");
      } else {
        console.log("   ❌ Error wallet needs MockUSDC tokens first");
      }
      
    } else {
      console.log("✅ Wallet addresses match - investigating other issues...");
      
      if (errorCollateral === 0n) {
        console.log("❌ Collateral is 0 - deposit transaction might have failed");
        console.log("   Check transaction status and try depositing again");
      } else {
        console.log("✅ Collateral exists - might be a UI caching issue");
        console.log("   Try refreshing the UI or waiting a few minutes");
      }
    }

    // Additional diagnostics
    console.log("\n📊 ADDITIONAL INFO");
    console.log("=".repeat(50));
    
    const requiredMargin = hre.ethers.parseUnits("10", 6); // 10 USDC from error
    console.log(`Required for trade: ${hre.ethers.formatUnits(requiredMargin, 6)} USDC`);
    
    if (errorAvailable >= requiredMargin) {
      console.log("✅ Error wallet has sufficient collateral");
      console.log("   This might be a UI refresh issue");
    } else {
      console.log("❌ Error wallet needs more collateral");
      const needed = requiredMargin - errorAvailable;
      console.log(`   Need to deposit: ${hre.ethers.formatUnits(needed, 6)} USDC`);
    }

  } catch (error) {
    console.error("❌ Diagnostic failed:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
