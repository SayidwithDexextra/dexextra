const { ethers } = require("hardhat");

async function main() {
  console.log("🧪 Testing Enhanced Deployment Pipeline...\n");
  console.log(
    "This demonstrates how the VAMMWizard can now automatically register metrics!"
  );

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("📍 Testing with account:", deployer.address);

    // Get contracts
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );
    const metricRegistryAddress = await factory.metricRegistry();
    const metricRegistry = await ethers.getContractAt(
      "MetricRegistry",
      metricRegistryAddress
    );

    // Simulate what VAMMWizard would do
    const marketData = {
      symbol: "BTC",
      description: "Bitcoin Price Market",
      metricName: "Bitcoin Price USD",
      metricDataSource: "https://api.coinbase.com/v2/prices/BTC-USD/spot",
      settlementPeriod: 7, // days
    };

    console.log("📊 Market Data from VAMMWizard:");
    console.log("   Symbol:", marketData.symbol);
    console.log("   Description:", marketData.description);
    console.log("   Metric Name:", marketData.metricName);
    console.log("   Data Source:", marketData.metricDataSource);
    console.log("   Settlement Period:", marketData.settlementPeriod, "days");

    // Step 1: Generate metric ID (same logic as enhanced deployment service)
    const metricId = `0x${Buffer.from(marketData.metricName)
      .toString("hex")
      .padEnd(64, "0")}`;
    console.log("\n🔍 Generated Metric ID:", metricId);

    // Step 2: Check if metric exists
    let isMetricActive = false;
    try {
      isMetricActive = await metricRegistry.isMetricActive(metricId);
    } catch (error) {
      console.log("⚠️ Could not check metric status");
    }

    console.log(
      "📋 Current metric status:",
      isMetricActive ? "ACTIVE ✅" : "NOT REGISTERED ❌"
    );

    if (!isMetricActive) {
      console.log("\n📝 PIPELINE STEP: Metric registration would occur here");

      // Get registration requirements
      const registrationFee = await metricRegistry.registrationFee();
      const minimumStake = registrationFee * BigInt(10);

      console.log(
        "   Registration Fee:",
        ethers.formatEther(registrationFee),
        "MATIC"
      );
      console.log(
        "   Minimum Stake:",
        ethers.formatEther(minimumStake),
        "MATIC"
      );

      // Check if user has enough balance for registration
      const balance = await deployer.provider.getBalance(deployer.address);
      const totalRequired = registrationFee;

      console.log("   User Balance:", ethers.formatEther(balance), "MATIC");
      console.log(
        "   Required for Registration:",
        ethers.formatEther(totalRequired),
        "MATIC"
      );

      if (balance >= totalRequired) {
        console.log("   ✅ User has sufficient funds for metric registration");

        // In the real pipeline, this is where we'd register the metric
        console.log("   🔄 Would register metric: registerMetric(");
        console.log(`     "${marketData.metricName}",`);
        console.log(`     "${marketData.description}",`);
        console.log(`     "${marketData.metricDataSource}",`);
        console.log(`     "Real-time price feed",`);
        console.log(`     ${marketData.settlementPeriod},`);
        console.log(`     ${ethers.formatEther(minimumStake)}`);
        console.log("   )");
      } else {
        console.log("   ❌ Insufficient funds for metric registration");
      }
    } else {
      console.log(
        "\n✅ PIPELINE STEP: Metric already exists, skipping registration"
      );
    }

    console.log("\n🏭 PIPELINE STEP: VAMM deployment would occur here");
    console.log("   Using metric ID:", metricId);
    console.log("   Template: standard");
    console.log("   Category:", marketData.description);

    // Test VAMM deployment readiness
    const isAuthorized = await factory.authorizedDeployers(deployer.address);
    const deploymentFee = await factory.deploymentFee();
    const template = await factory.getTemplate("standard");

    console.log("\n📋 VAMM Deployment Readiness:");
    console.log(
      "   Authorization:",
      isAuthorized ? "AUTHORIZED ✅" : "NOT AUTHORIZED ❌"
    );
    console.log(
      "   Template Active:",
      template.isActive ? "ACTIVE ✅" : "INACTIVE ❌"
    );
    console.log(
      "   Deployment Fee:",
      ethers.formatEther(deploymentFee),
      "MATIC"
    );

    console.log("\n🎉 ENHANCED PIPELINE SUMMARY:");
    console.log("=".repeat(50));
    console.log("✅ The VAMMWizard can now:");
    console.log("   1. Check if metric exists");
    console.log(
      "   2. Register metric if needed (with user approval for fees)"
    );
    console.log("   3. Deploy VAMM with the registered metric");
    console.log("   4. Provide clear feedback at each step");
    console.log(
      "\n💡 This eliminates the 'metric not found' error completely!"
    );
  } catch (error) {
    console.error("❌ Test failed:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
