#!/usr/bin/env node

/**
 * VaultRouter Manager - Complete Collateral Management Script
 * 
 * This script helps you interact with VaultRouter for:
 * 1. Checking current collateral balance
 * 2. Getting MockUSDC tokens (if needed)
 * 3. Approving VaultRouter to spend MockUSDC
 * 4. Depositing collateral
 * 5. Checking available collateral for trading
 */

const hre = require("hardhat");

async function main() {
  console.log("🏦 VaultRouter Collateral Manager\n");

  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Using account:", deployer.address);

  // Contract addresses from your deployment
  const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const MOCK_USDC_ADDRESS = "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289"; // From contractConfig.ts

  console.log("📋 Contract Addresses:");
  console.log(`   VaultRouter: ${VAULT_ROUTER_ADDRESS}`);
  console.log(`   MockUSDC: ${MOCK_USDC_ADDRESS}\n`);

  try {
    // Get contract instances
    const vaultRouter = await hre.ethers.getContractAt("VaultRouter", VAULT_ROUTER_ADDRESS);
    const mockUSDC = await hre.ethers.getContractAt("MockUSDC", MOCK_USDC_ADDRESS);

    // Step 1: Check current state
    console.log("📊 CURRENT STATE");
    console.log("=".repeat(50));

    const usdcBalance = await mockUSDC.balanceOf(deployer.address);
    const currentCollateral = await vaultRouter.userCollateral(deployer.address);
    const availableCollateral = await vaultRouter.getAvailableCollateral(deployer.address);
    const allowance = await mockUSDC.allowance(deployer.address, VAULT_ROUTER_ADDRESS);

    console.log(`💰 MockUSDC Balance: ${hre.ethers.formatUnits(usdcBalance, 6)} USDC`);
    console.log(`🏦 Total Collateral in Vault: ${hre.ethers.formatUnits(currentCollateral, 6)} USDC`);
    console.log(`✅ Available for Trading: ${hre.ethers.formatUnits(availableCollateral, 6)} USDC`);
    console.log(`📝 Current Allowance: ${hre.ethers.formatUnits(allowance, 6)} USDC\n`);

    // Step 2: Get MockUSDC if needed
    if (usdcBalance === 0n) {
      console.log("💳 GETTING MOCK USDC TOKENS");
      console.log("=".repeat(50));
      
      // Check if MockUSDC has a mint function
      try {
        const mintAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
        console.log("🚀 Minting 10,000 MockUSDC tokens...");
        
        const mintTx = await mockUSDC.mint(deployer.address, mintAmount);
        console.log("📋 Mint transaction hash:", mintTx.hash);
        
        await mintTx.wait();
        console.log("✅ Successfully minted MockUSDC tokens!\n");
        
        const newBalance = await mockUSDC.balanceOf(deployer.address);
        console.log(`💰 New MockUSDC Balance: ${hre.ethers.formatUnits(newBalance, 6)} USDC\n`);
      } catch (mintError) {
        console.log("❌ Minting failed (might not be available)");
        console.log("🔍 You'll need to get MockUSDC tokens another way\n");
      }
    }

    // Step 3: Approve VaultRouter if needed
    const currentUsdcBalance = await mockUSDC.balanceOf(deployer.address);
    if (currentUsdcBalance > 0n && allowance < currentUsdcBalance) {
      console.log("📝 APPROVING VAULT ROUTER");
      console.log("=".repeat(50));
      
      const approveAmount = currentUsdcBalance; // Approve full balance
      console.log(`🚀 Approving ${hre.ethers.formatUnits(approveAmount, 6)} USDC...`);
      
      const approveTx = await mockUSDC.approve(VAULT_ROUTER_ADDRESS, approveAmount);
      console.log("📋 Approve transaction hash:", approveTx.hash);
      
      await approveTx.wait();
      console.log("✅ Successfully approved VaultRouter!\n");
    }

    // Step 4: Deposit collateral
    const finalUsdcBalance = await mockUSDC.balanceOf(deployer.address);
    if (finalUsdcBalance > 0n) {
      console.log("💰 DEPOSITING COLLATERAL");
      console.log("=".repeat(50));
      
      // Calculate how much to deposit (leave a small buffer for gas)
      const depositAmount = finalUsdcBalance > hre.ethers.parseUnits("100", 6) 
        ? finalUsdcBalance - hre.ethers.parseUnits("100", 6) // Leave 100 USDC
        : finalUsdcBalance; // Deposit all if less than 100
      
      console.log(`🚀 Depositing ${hre.ethers.formatUnits(depositAmount, 6)} USDC to VaultRouter...`);
      
      const depositTx = await vaultRouter.depositCollateral(depositAmount);
      console.log("📋 Deposit transaction hash:", depositTx.hash);
      
      await depositTx.wait();
      console.log("✅ Successfully deposited collateral!\n");
    }

    // Step 5: Final state check
    console.log("📊 FINAL STATE");
    console.log("=".repeat(50));

    const finalCollateral = await vaultRouter.userCollateral(deployer.address);
    const finalAvailable = await vaultRouter.getAvailableCollateral(deployer.address);
    const marginSummary = await vaultRouter.getMarginSummary(deployer.address);

    console.log(`🏦 Total Collateral: ${hre.ethers.formatUnits(finalCollateral, 6)} USDC`);
    console.log(`✅ Available for Trading: ${hre.ethers.formatUnits(finalAvailable, 6)} USDC`);
    console.log(`📊 Margin Used: ${hre.ethers.formatUnits(marginSummary.marginUsed, 6)} USDC`);
    console.log(`📊 Margin Reserved: ${hre.ethers.formatUnits(marginSummary.marginReserved, 6)} USDC`);

    // Check if we have enough for the failed trade
    const requiredMargin = hre.ethers.parseUnits("10", 6); // 10 USDC from error message
    if (finalAvailable >= requiredMargin) {
      console.log("\n🎉 SUCCESS! You now have sufficient collateral for trading!");
      console.log(`✅ Required: ${hre.ethers.formatUnits(requiredMargin, 6)} USDC`);
      console.log(`✅ Available: ${hre.ethers.formatUnits(finalAvailable, 6)} USDC`);
      console.log("🚀 You can now place limit orders successfully!");
    } else {
      console.log("\n⚠️  Still need more collateral:");
      console.log(`❌ Required: ${hre.ethers.formatUnits(requiredMargin, 6)} USDC`);
      console.log(`❌ Available: ${hre.ethers.formatUnits(finalAvailable, 6)} USDC`);
      console.log(`❌ Need: ${hre.ethers.formatUnits(requiredMargin - finalAvailable, 6)} more USDC`);
    }

  } catch (error) {
    console.error("❌ Error managing collateral:", error.message);
    
    if (error.message.includes("insufficient")) {
      console.log("\n💡 Common solutions:");
      console.log("   1. Get more MockUSDC tokens");
      console.log("   2. Approve VaultRouter to spend your MockUSDC");
      console.log("   3. Deposit collateral to VaultRouter");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Script failed:", error);
    process.exit(1);
  });
