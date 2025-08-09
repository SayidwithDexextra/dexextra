const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking MetricRegistry...\n");

  // You'll need to find the MetricRegistry address
  // Let's try to get it from the factory first
  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get the factory contract
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );

    // Get the metric registry address from the factory
    const metricRegistryAddress = await factory.metricRegistry();
    console.log("📍 MetricRegistry Address:", metricRegistryAddress);

    // Get the metric registry contract
    const metricRegistry = await ethers.getContractAt(
      "MetricRegistry",
      metricRegistryAddress
    );

    // Check the specific metric ID that VAMMWizard is trying to use
    const testMetricId =
      "0x474f4c4420563600000000000000000000000000000000000000000000000000"; // "GOLD V6"
    console.log("🔍 Checking metric ID:", testMetricId);

    try {
      const isActive = await metricRegistry.isMetricActive(testMetricId);
      console.log("   Status:", isActive ? "ACTIVE ✅" : "INACTIVE ❌");

      if (!isActive) {
        console.log(
          "\n❌ The metric 'GOLD V6' is not registered or not active."
        );
        console.log("💡 You need to either:");
        console.log(
          "   1. Register this metric in the MetricRegistry first, OR"
        );
        console.log(
          "   2. Use a different symbol/metric that is already registered"
        );
      }
    } catch (error) {
      console.log("   Status: NOT FOUND ❌");
      console.log("   Error:", error.message);
    }

    // Try to get some registered metrics for reference
    console.log("\n🔍 Looking for available metrics...");

    // Try to get metric count or list (this depends on the MetricRegistry implementation)
    try {
      // This might not work depending on the contract interface
      const metricCount = await metricRegistry.getMetricCount();
      console.log("📊 Total registered metrics:", metricCount.toString());

      if (metricCount > 0) {
        console.log("📋 Available metrics:");
        for (let i = 0; i < Math.min(metricCount, 5); i++) {
          try {
            const metricId = await metricRegistry.getMetricByIndex(i);
            const isActive = await metricRegistry.isMetricActive(metricId);
            console.log(
              `   ${i + 1}. ${metricId} - ${isActive ? "ACTIVE" : "INACTIVE"}`
            );
          } catch (error) {
            console.log(`   ${i + 1}. Error reading metric`);
          }
        }
      }
    } catch (error) {
      console.log(
        "⚠️ Unable to enumerate metrics. Contract might not support this."
      );
    }

    console.log("\n💡 SOLUTION:");
    console.log("To fix the VAMMWizard deployment:");
    console.log("1. Register the 'GOLD V6' metric in MetricRegistry, OR");
    console.log(
      "2. Use a different symbol that corresponds to an existing active metric, OR"
    );
    console.log("3. Modify the VAMMWizard to use a valid metric ID");
  } catch (error) {
    console.error("❌ Error checking metrics:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
