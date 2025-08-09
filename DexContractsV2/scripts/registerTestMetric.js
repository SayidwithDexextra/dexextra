const { ethers } = require("hardhat");

async function main() {
  console.log("📝 Registering Simple Test Metric...\n");

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("📍 Registering with account:", deployer.address);

    // Get the factory and metric registry
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );
    const metricRegistryAddress = await factory.metricRegistry();
    console.log("📍 MetricRegistry Address:", metricRegistryAddress);

    const metricRegistry = await ethers.getContractAt(
      "MetricRegistry",
      metricRegistryAddress
    );

    // Simple test metric
    const metricData = {
      name: "Test Metric",
      description: "Simple test metric for VAMMWizard testing",
      dataSource: "https://example.com/test",
      methodology: "Test methodology",
      settlementPeriod: 1, // 1 day (minimum)
      minimumStake: ethers.parseEther("10"), // Minimum stake requirement
      registrationFee: ethers.parseEther("0.1") // Correct registration fee
    };

    // Expected metric ID (first 8 bytes of keccak256 of name)
    const expectedMetricId = ethers
      .keccak256(ethers.toUtf8Bytes(metricData.name))
      .slice(0, 18); // First 8 bytes
    const paddedMetricId =
      expectedMetricId + "0".repeat(64 - expectedMetricId.length + 2); // Pad to 32 bytes

    console.log("🔍 Expected Metric ID:", paddedMetricId);

    // Check if already registered
    let isActive = false;
    try {
      isActive = await metricRegistry.isMetricActive(paddedMetricId);
    } catch (error) {
      console.log(
        "⚠️ Could not check metric status, proceeding with registration..."
      );
    }

    if (isActive) {
      console.log("✅ Test metric is already registered and active!");
      console.log("💡 Use this metric ID in VAMMWizard:", paddedMetricId);
      return;
    }

    console.log("📋 Registering test metric:");
    console.log("   Name:", metricData.name);
    console.log(
      "   Registration Fee:",
      ethers.formatEther(metricData.registrationFee),
      "MATIC"
    );

    // Check balance first
    const balance = await deployer.provider.getBalance(deployer.address);
    console.log("💰 Current balance:", ethers.formatEther(balance), "MATIC");

    if (balance < metricData.registrationFee) {
      console.log("❌ Insufficient balance for registration fee");
      return;
    }

    // Register the metric
    console.log("\n🚀 Registering metric...");
    const registerTx = await metricRegistry.registerMetric(
      metricData.name,
      metricData.description,
      metricData.dataSource,
      metricData.methodology,
      metricData.settlementPeriod,
      metricData.minimumStake,
      { value: metricData.registrationFee }
    );

    console.log("⏳ Transaction submitted:", registerTx.hash);
    const receipt = await registerTx.wait();

    if (receipt.status === 1) {
      console.log("✅ Transaction confirmed!");

      // Wait a moment and check again
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const isNowActive = await metricRegistry.isMetricActive(paddedMetricId);
      console.log("🔍 Verification - Metric is now active:", isNowActive);

      if (isNowActive) {
        console.log("\n🎉 SUCCESS! Test metric registered successfully!");
        console.log(
          "💡 Use this metric ID in your deployment:",
          paddedMetricId
        );
      } else {
        console.log("\n⚠️ Metric registered but may need activation.");
      }
    } else {
      console.log("❌ Transaction failed");
    }
  } catch (error) {
    console.error("❌ Registration failed:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.log("💡 Insufficient funds for registration fee.");
    } else if (error.message.includes("only owner")) {
      console.log("💡 Only the MetricRegistry owner can register metrics.");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
