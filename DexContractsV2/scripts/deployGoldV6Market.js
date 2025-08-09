const { ethers } = require("hardhat");

async function main() {
  console.log("🥇 Deploying Complete Gold V6 Market...\n");
  console.log("📋 Target Configuration:");
  console.log("   • Metric: Gold Price V6");
  console.log("   • Start Price: $10.00 USD");
  console.log("   • Initial Reserves: 1000 (loose price sensitivity)");
  console.log("   • Settlement Period: 7 days");
  console.log("=".repeat(60));

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("\n📍 Deploying with account:", deployer.address);

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

    console.log("🏭 Factory Address:", FACTORY_ADDRESS);
    console.log("📋 MetricRegistry Address:", metricRegistryAddress);

    // ============================================
    // STEP 1: REGISTER GOLD V6 METRIC (IF NEEDED)
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("STEP 1: METRIC REGISTRATION");
    console.log("=".repeat(60));

    // Try to find existing metric first
    let metricData = {
      name: "Gold Price V6",
      description: "Gold price in USD per ounce - Version 6 for testing",
      dataSource: "https://goldprice.org/",
      methodology: "Real-time gold price feed from major exchanges",
      settlementPeriod: 7, // 7 days
    };

    // Check if metric with this name already exists
    let existingMetric = null;
    let isMetricActive = false;
    
    try {
      existingMetric = await metricRegistry.getMetricByName(metricData.name);
      isMetricActive = existingMetric.isActive;
      console.log("📊 Found existing metric:", metricData.name);
      console.log("🔍 Existing Metric ID:", existingMetric.metricId);
    } catch (error) {
      console.log("📊 Metric name not found, will create new one");
    }

    // If name exists but metric inactive, or name doesn't exist, create unique name
    if (!isMetricActive) {
      const timestamp = Date.now();
      metricData.name = `Gold Price V6 Test ${timestamp}`;
      console.log("📝 Using unique metric name:", metricData.name);
    }

    // Generate metric ID (same logic as VAMMWizard)
    const metricId = existingMetric ? existingMetric.metricId : `0x${Buffer.from(metricData.name)
      .toString("hex")
      .padEnd(64, "0")}`;
    console.log("🔍 Target Metric ID:", metricId);

    console.log(
      "📊 Metric Status:",
      isMetricActive ? "ACTIVE ✅" : "NEEDS REGISTRATION ❌"
    );

    if (!isMetricActive) {
      console.log("\n📝 Registering Gold V6 metric...");

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

      // Register the metric
      const registerTx = await metricRegistry.registerMetric(
        metricData.name,
        metricData.description,
        metricData.dataSource,
        metricData.methodology,
        metricData.settlementPeriod,
        minimumStake,
        { value: registrationFee }
      );

      console.log("⏳ Registration transaction:", registerTx.hash);
      await registerTx.wait();

      // Verify registration
      const isNowActive = await metricRegistry.isMetricActive(metricId);
      if (isNowActive) {
        console.log("✅ Gold V6 metric registered successfully!");
      } else {
        throw new Error("Metric registration verification failed");
      }
    } else {
      console.log("✅ Gold V6 metric already registered and active");
    }

    // ============================================
    // STEP 2: CREATE CUSTOM TEMPLATE
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("STEP 2: CUSTOM TEMPLATE CREATION");
    console.log("=".repeat(60));

    const templateName = `gold-v6-test-${Date.now()}`;
    const templateConfig = {
      maxLeverage: 10, // 10x leverage (conservative)
      tradingFeeRate: 30, // 0.3% trading fee
      liquidationFeeRate: 500, // 5% liquidation fee
      maintenanceMarginRatio: 1000, // 10% maintenance margin
      initialReserves: ethers.parseEther("1000"), // 1000 ETH initial reserves (loose sensitivity)
      volumeScaleFactor: 500, // 500 volume scale factor
      startPrice: ethers.parseEther("10"), // $10.00 start price
      description:
        "Gold V6 test template with $10 start price and loose sensitivity",
    };

    console.log("📋 Template Configuration:");
    console.log("   Name:", templateName);
    console.log("   Max Leverage:", templateConfig.maxLeverage + "x");
    console.log(
      "   Trading Fee:",
      (templateConfig.tradingFeeRate / 100).toFixed(2) + "%"
    );
    console.log(
      "   Liquidation Fee:",
      (templateConfig.liquidationFeeRate / 100).toFixed(1) + "%"
    );
    console.log(
      "   Maintenance Margin:",
      (templateConfig.maintenanceMarginRatio / 100).toFixed(1) + "%"
    );
    console.log(
      "   Initial Reserves:",
      ethers.formatEther(templateConfig.initialReserves),
      "ETH"
    );
    console.log("   Volume Scale Factor:", templateConfig.volumeScaleFactor);
    console.log(
      "   Start Price: $" + ethers.formatEther(templateConfig.startPrice)
    );

    console.log("\n🛠️ Creating custom template...");
    const templateTx = await factory.createTemplate(
      templateName,
      templateConfig.maxLeverage,
      templateConfig.tradingFeeRate,
      templateConfig.liquidationFeeRate,
      templateConfig.maintenanceMarginRatio,
      templateConfig.initialReserves,
      templateConfig.volumeScaleFactor,
      templateConfig.startPrice,
      templateConfig.description
    );

    console.log("⏳ Template creation transaction:", templateTx.hash);
    await templateTx.wait();

    // Verify template creation
    const template = await factory.getTemplate(templateName);
    if (template.isActive) {
      console.log("✅ Custom template created successfully!");
      console.log("   Template Active:", template.isActive);
      console.log(
        "   Start Price: $" + ethers.formatEther(template.startPrice)
      );
      console.log(
        "   Initial Reserves:",
        ethers.formatEther(template.initialReserves),
        "ETH"
      );
    } else {
      throw new Error("Template creation verification failed");
    }

    // ============================================
    // STEP 3: DEPLOY SPECIALIZED VAMM
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("STEP 3: VAMM DEPLOYMENT");
    console.log("=".repeat(60));

    // Check authorization
    const isAuthorized = await factory.authorizedDeployers(deployer.address);
    console.log(
      "🔐 Authorization status:",
      isAuthorized ? "AUTHORIZED ✅" : "NOT AUTHORIZED ❌"
    );

    if (!isAuthorized) {
      console.log("\n⚠️ User not authorized for deployment.");
      console.log(
        "💡 Run: npx hardhat run scripts/authorizeDeployer.js --network polygon"
      );
      return;
    }

    const category = `Gold V6 Market Test ${Date.now()}`;
    const allowedMetrics = [metricId];
    const deploymentFee = await factory.deploymentFee();

    console.log("📋 VAMM Deployment Parameters:");
    console.log("   Category:", category);
    console.log("   Template:", templateName);
    console.log("   Allowed Metrics:", allowedMetrics);
    console.log(
      "   Deployment Fee:",
      ethers.formatEther(deploymentFee),
      "MATIC"
    );

    console.log("\n🚀 Deploying specialized VAMM...");
    const vammTx = await factory.deploySpecializedVAMM(
      category,
      allowedMetrics,
      templateName,
      { value: deploymentFee }
    );

    console.log("⏳ VAMM deployment transaction:", vammTx.hash);
    const receipt = await vammTx.wait();

    // Get the deployed VAMM address from events
    const deployedEvent = receipt.logs.find((log) => {
      try {
        const parsed = factory.interface.parseLog(log);
        return parsed.name === "SpecializedVAMMDeployed";
      } catch (e) {
        return false;
      }
    });

    let vammAddress = null;
    if (deployedEvent) {
      const parsed = factory.interface.parseLog(deployedEvent);
      vammAddress = parsed.args.vamm;
    }

    // ============================================
    // STEP 4: VERIFICATION & RESULTS
    // ============================================
    console.log("\n" + "=".repeat(60));
    console.log("DEPLOYMENT SUCCESSFUL! 🎉");
    console.log("=".repeat(60));

    console.log("\n📊 DEPLOYMENT SUMMARY:");
    console.log("   ✅ Metric Registered: Gold Price V6");
    console.log("   ✅ Template Created:", templateName);
    console.log("   ✅ VAMM Deployed:", vammAddress || "Address not captured");
    console.log("   ✅ Category:", category);

    console.log("\n💰 MARKET CONFIGURATION:");
    console.log("   • Start Price: $10.00 USD");
    console.log("   • Initial Reserves: 1000 ETH (loose price sensitivity)");
    console.log("   • Max Leverage: 10x");
    console.log("   • Trading Fee: 0.30%");
    console.log("   • Settlement Period: 7 days");

    console.log("\n🔗 TRANSACTION DETAILS:");
    console.log(
      "   • Metric Registration:",
      isMetricActive ? "Previously registered" : registerTx?.hash
    );
    console.log("   • Template Creation:", templateTx.hash);
    console.log("   • VAMM Deployment:", vammTx.hash);

    console.log("\n💡 NEXT STEPS:");
    console.log("   1. Test this configuration in the VAMMWizard");
    console.log("   2. Verify the loose price sensitivity (1000 reserves)");
    console.log("   3. Check that $10 start price is properly set");
    console.log("   4. Test metric-based trading functionality");

    console.log(
      "\n🎯 This market is now ready for testing with the VAMMWizard!"
    );
  } catch (error) {
    console.error("\n❌ Deployment failed:", error.message);

    if (error.message.includes("insufficient funds")) {
      console.log("💡 Insufficient funds. You need MATIC for:");
      console.log("   • Metric registration fee (0.1 MATIC)");
      console.log("   • VAMM deployment fee (0.1 MATIC)");
      console.log("   • Gas fees for transactions");
    } else if (error.message.includes("not authorized")) {
      console.log(
        "💡 Authorization required. Run: npx hardhat run scripts/authorizeDeployer.js"
      );
    } else if (error.message.includes("already exists")) {
      console.log(
        "💡 Category or template already exists. Using unique names..."
      );
    }

    console.log("\n🔍 Error details:", error);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
