const { ethers } = require("hardhat");

async function main() {
  console.log("🧪 Testing VAMM Deployment with Standard Template...\n");

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get signer
    const [deployer] = await ethers.getSigners();
    console.log("📍 Testing with account:", deployer.address);

    // Get the factory contract
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );

    // Check authorization first
    const isAuthorized = await factory.authorizedDeployers(deployer.address);
    console.log("🔐 Authorization status:", isAuthorized);

    if (!isAuthorized) {
      console.log("❌ Not authorized. Please run authorizeDeployer.js first.");
      return;
    }

    // Test parameters similar to what VAMMWizard would use
    let category = "Test Gold Market";
    const metricId =
      "0x474f4c4420563600000000000000000000000000000000000000000000000000"; // "GOLD V6" in hex
    const allowedMetrics = [metricId];
    const templateName = "standard"; // Using the fixed template name

    console.log("\n🔍 Test Parameters:");
    console.log("   Category:", category);
    console.log("   Template:", templateName);
    console.log("   Metric ID:", metricId);

    // Check if template exists and is active
    const template = await factory.getTemplate(templateName);
    console.log("\n📋 Template Details:");
    console.log("   Max Leverage:", template.maxLeverage.toString());
    console.log("   Active:", template.isActive);

    if (!template.isActive) {
      console.log("❌ Template is not active!");
      return;
    }

    // Get deployment fee
    const deploymentFee = await factory.deploymentFee();
    console.log(
      "\n💰 Deployment fee:",
      ethers.formatEther(deploymentFee),
      "MATIC"
    );

    // Check if category already exists
    const existingVAMM = await factory.getVAMMByCategory(category);
    if (existingVAMM !== "0x0000000000000000000000000000000000000000") {
      console.log("⚠️ Category already exists, using unique name...");
      const timestamp = Date.now();
      const uniqueCategory = `${category} ${timestamp}`;
      console.log("   New category:", uniqueCategory);

      // Test with unique category
      category = uniqueCategory;
    }

    console.log("\n🚀 Testing deployment (DRY RUN - estimating gas)...");

    // Estimate gas to test if the call would succeed
    const gasEstimate = await factory.deploySpecializedVAMM.estimateGas(
      category,
      allowedMetrics,
      templateName,
      { value: deploymentFee }
    );

    console.log("✅ Gas estimate successful:", gasEstimate.toString());
    console.log("🎉 The deployment would succeed with these parameters!");
    console.log(
      "\n💡 Your VAMMWizard should now work without authorization errors."
    );
  } catch (error) {
    console.error("❌ Test failed:", error.message);

    if (error.message.includes("not authorized")) {
      console.log(
        "💡 Authorization issue detected. Run authorizeDeployer.js first."
      );
    } else if (error.message.includes("invalid template")) {
      console.log("💡 Template issue detected. Check available templates.");
    } else if (error.message.includes("category already exists")) {
      console.log("💡 Category already exists. Use a unique category name.");
    } else if (error.message.includes("metric")) {
      console.log(
        "💡 Metric validation issue. Check if metrics are registered and active."
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
