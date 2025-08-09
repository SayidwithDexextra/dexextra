const { run, ethers } = require("hardhat");

/**
 * Verify SpecializedMetricVAMM at 0xc6d15Af1c2214b3f3e060fe4e95Dd5d0D1612053
 * Based on the contract state analysis
 */

const CONTRACT_ADDRESS = "0xc6d15Af1c2214b3f3e060fe4e95Dd5d0D1612053";

// Constructor arguments based on contract state analysis
const CONSTRUCTOR_ARGS = [
  "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93", // _centralVault
  "0x8f5200203c53c5821061D1f29249f10A5b57CA6A", // _metricRegistry
  "0x069331Cc5c881db1B1382416b189c198C5a2b356", // _factory
  "Financial", // _category
  [], // _allowedMetrics (empty array for now, we'll try to find the actual metrics)
  {
    maxLeverage: 50000000000000, // Max leverage value (the 0.00000000000000005 * 1e18)
    tradingFeeRate: 30, // Trading fee rate: 30 basis points
    liquidationFeeRate: 500, // Estimated liquidation fee rate
    maintenanceMarginRatio: 500, // Estimated maintenance margin ratio
    initialReserves: ethers.parseEther("10000"), // Estimated initial reserves
    volumeScaleFactor: ethers.parseEther("1"), // Estimated volume scale factor
    startPrice: ethers.parseEther("50"), // Start price: 50.0
    isActive: true, // Template is active
    description: "Financial trading template",
  }, // _template
  ethers.parseEther("50"), // _startPrice: 50.0
];

async function main() {
  console.log("🔍 Verifying SpecializedMetricVAMM at:", CONTRACT_ADDRESS);
  console.log("=".repeat(60));

  try {
    console.log("📋 Constructor Arguments:");
    console.log("1. Central Vault:", CONSTRUCTOR_ARGS[0]);
    console.log("2. Metric Registry:", CONSTRUCTOR_ARGS[1]);
    console.log("3. Factory:", CONSTRUCTOR_ARGS[2]);
    console.log("4. Category:", CONSTRUCTOR_ARGS[3]);
    console.log("5. Allowed Metrics:", CONSTRUCTOR_ARGS[4]);
    console.log("6. Template:", JSON.stringify(CONSTRUCTOR_ARGS[5], null, 2));
    console.log("7. Start Price:", ethers.formatEther(CONSTRUCTOR_ARGS[6]));

    console.log("\n🚀 Starting verification...");

    await run("verify:verify", {
      address: CONTRACT_ADDRESS,
      constructorArguments: CONSTRUCTOR_ARGS,
      contract:
        "contracts/core/SpecializedMetricVAMM.sol:SpecializedMetricVAMM",
    });

    console.log("✅ Contract verified successfully!");
    console.log(
      `🔗 View on Polygonscan: https://polygonscan.com/address/${CONTRACT_ADDRESS}#code`
    );
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Contract is already verified!");
      console.log(
        `🔗 View on Polygonscan: https://polygonscan.com/address/${CONTRACT_ADDRESS}#code`
      );
    } else {
      console.error("❌ Verification failed:", error.message);

      // If verification fails, let's try with different approaches
      console.log("\n💡 Alternative approaches:");
      console.log(
        "1. The contract might use different metrics - check deployment logs"
      );
      console.log(
        "2. Template parameters might be different - check contract state"
      );
      console.log("3. Try manual verification on Polygonscan website");
      console.log(
        `🔗 https://polygonscan.com/address/${CONTRACT_ADDRESS}#code`
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
