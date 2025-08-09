const { ethers } = require("hardhat");

async function main() {
  console.log("📝 Registering GOLD V6 Metric...\n");

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

    // Metric details for GOLD V6
    const metricData = {
      name: "Gold Price V6",
      description: "Gold price in USD per ounce - Version 6",
      dataSource: "https://goldprice.org/",
      methodology: "Real-time gold price feed from major exchanges",
      settlementPeriod: 7, // 7 days
      minimumStake: ethers.parseEther("10"), // 10 MATIC minimum stake
      registrationFee: ethers.parseEther("0.1") // 0.1 MATIC registration fee
    };

    // Check if already registered
    const metricId =
      "0x474f4c4420563600000000000000000000000000000000000000000000000000";
    const isActive = await metricRegistry.isMetricActive(metricId);

    if (isActive) {
      console.log("✅ GOLD V6 metric is already registered and active!");
      return;
    }

    console.log("📋 Registering metric with details:");
    console.log("   Name:", metricData.name);
    console.log("   Description:", metricData.description);
    console.log("   Settlement Period:", metricData.settlementPeriod, "days");
    console.log(
      "   Registration Fee:",
      ethers.formatEther(metricData.registrationFee),
      "MATIC"
    );

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
    await registerTx.wait();

    // Verify registration
    const isNowActive = await metricRegistry.isMetricActive(metricId);
    console.log("🔍 Verification - Metric is now active:", isNowActive);

    if (isNowActive) {
      console.log("\n🎉 SUCCESS! GOLD V6 metric registered successfully!");
      console.log("💡 Your VAMMWizard should now work completely!");
      console.log("📝 Transaction hash:", registerTx.hash);
    } else {
      console.log("\n❌ Registration may have failed. Check the transaction.");
    }
  } catch (error) {
    console.error("❌ Registration failed:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.log(
        "💡 Insufficient funds for registration fee. You need at least 0.1 MATIC."
      );
    } else if (error.message.includes("already registered")) {
      console.log("💡 Metric may already be registered but inactive.");
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
