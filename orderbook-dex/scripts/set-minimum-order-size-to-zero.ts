import { ethers } from "hardhat";

/**
 * Script to set minimum order size to effectively 0 (1 wei) for a specific metric
 * 
 * Since the contract validation requires minimumOrderSize > 0, we set it to 1 wei
 * which is the smallest possible value and effectively 0 for practical purposes.
 */

// Configuration
const FACTORY_ADDRESS = "0x354f188944eF514eEEf05d8a31E63B33f87f16E0"; // From POLYGON_DEPLOYMENT.md
const METRIC_ID = "SILVER_V1"; // Default metric, can be changed via command line
const NEW_MIN_ORDER_SIZE = 1n; // 1 wei - effectively 0 but passes validation

async function main() {
  console.log("\n🔧 Setting minimum order size to effectively 0 (1 wei)...");
  console.log(`📊 Target Metric: ${METRIC_ID}`);
  console.log(`🏭 Factory Address: ${FACTORY_ADDRESS}`);
  
  // Get command line argument for metric ID if provided
  const args = process.argv.slice(2);
  const targetMetricId = args.length > 0 ? args[0] : METRIC_ID;
  
  if (args.length > 0) {
    console.log(`📝 Using custom metric ID from command line: ${targetMetricId}`);
  }

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log(`👤 Admin/Caller: ${signer.address}`);
  
  // Check balance
  const balance = await ethers.provider.getBalance(signer.address);
  console.log(`💰 Caller Balance: ${ethers.formatEther(balance)} MATIC`);

  // Connect to factory contract
  console.log("\n🔗 Connecting to MetricsMarketFactory...");
  const factory = await ethers.getContractAt("MetricsMarketFactory", FACTORY_ADDRESS, signer);

  try {
    // Check if market exists
    console.log("\n🔍 Checking if market exists...");
    const marketExists = await factory.marketExists(targetMetricId);
    if (!marketExists) {
      console.error(`❌ Market with metric ID "${targetMetricId}" does not exist`);
      console.log("Available metrics can be checked by calling getAllMarkets()");
      process.exit(1);
    }
    console.log("✅ Market found");

    // Get current configuration
    console.log("\n📋 Current market configuration:");
    const currentConfig = await factory.getMarketConfig(targetMetricId);
    console.log({
      metricId: currentConfig.metricId,
      description: currentConfig.description,
      decimals: Number(currentConfig.decimals),
      currentMinimumOrderSize: currentConfig.minimumOrderSize.toString(),
      minimumOrderSizeFormatted: ethers.formatUnits(currentConfig.minimumOrderSize, Number(currentConfig.decimals)),
      settlementDate: new Date(Number(currentConfig.settlementDate) * 1000).toISOString(),
      tradingEndDate: new Date(Number(currentConfig.tradingEndDate) * 1000).toISOString()
    });

    // Check if already at minimum
    if (currentConfig.minimumOrderSize === NEW_MIN_ORDER_SIZE) {
      console.log("\n✅ Minimum order size is already set to 1 wei (effectively 0)");
      return;
    }

    // Update minimum order size
    console.log(`\n⚙️ Updating minimum order size from ${currentConfig.minimumOrderSize.toString()} to ${NEW_MIN_ORDER_SIZE.toString()} (1 wei)...`);
    
    // The tickSize parameter is deprecated but still required by the function signature
    // We pass the fixed tick size value (0.01 = 1e16 wei)
    const FIXED_TICK_SIZE = 1n * 10n ** 16n; // 0.01 in wei
    
    // Estimate gas
    const gasEstimate = await factory.updateMarketParameters.estimateGas(
      targetMetricId, 
      NEW_MIN_ORDER_SIZE, 
      FIXED_TICK_SIZE
    );
    console.log(`⛽ Estimated gas: ${gasEstimate.toString()}`);

    // Send transaction
    const tx = await factory.updateMarketParameters(
      targetMetricId, 
      NEW_MIN_ORDER_SIZE, 
      FIXED_TICK_SIZE
    );
    
    console.log(`📤 Transaction sent: ${tx.hash}`);
    console.log("⏳ Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log(`✅ Transaction confirmed in block: ${receipt?.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);

    // Verify the update
    console.log("\n🔍 Verifying update...");
    const updatedConfig = await factory.getMarketConfig(targetMetricId);
    console.log({
      metricId: updatedConfig.metricId,
      newMinimumOrderSize: updatedConfig.minimumOrderSize.toString(),
      newMinimumOrderSizeFormatted: ethers.formatUnits(updatedConfig.minimumOrderSize, Number(updatedConfig.decimals)),
      updateSuccessful: updatedConfig.minimumOrderSize === NEW_MIN_ORDER_SIZE
    });

    if (updatedConfig.minimumOrderSize === NEW_MIN_ORDER_SIZE) {
      console.log("\n🎉 SUCCESS: Minimum order size has been set to effectively 0 (1 wei)!");
      console.log("📈 This means any order size will be accepted by the market.");
    } else {
      console.error("\n❌ FAILED: Minimum order size was not updated correctly");
      process.exit(1);
    }

  } catch (error: any) {
    console.error("\n❌ Error occurred:");
    
    if (error.code === 'CALL_EXCEPTION') {
      console.error("Contract call failed. Possible reasons:");
      console.error("- Caller does not have FACTORY_ADMIN_ROLE");
      console.error("- Market is paused or inactive");
      console.error("- Invalid parameters passed");
    } else if (error.code === 'INSUFFICIENT_FUNDS') {
      console.error("Insufficient MATIC balance for transaction");
    } else {
      console.error("Details:", error.message);
    }
    
    process.exit(1);
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✨ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n💥 Script failed:", error);
      process.exit(1);
    });
}

export { main };
