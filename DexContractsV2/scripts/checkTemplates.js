const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking Available VAMM Templates...\n");

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get the factory contract
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );

    console.log("📍 Factory Address:", FACTORY_ADDRESS);

    // Get all template names
    console.log("\n🔍 Checking available templates...");
    const templateNames = await factory.getAllTemplates();

    console.log("📋 Available Templates:");
    console.log("=".repeat(50));

    if (templateNames.length === 0) {
      console.log("❌ No templates found!");
    } else {
      for (let i = 0; i < templateNames.length; i++) {
        const templateName = templateNames[i];
        console.log(`${i + 1}. ${templateName}`);

        // Get template details
        try {
          const template = await factory.getTemplate(templateName);
          console.log(`   - Max Leverage: ${template.maxLeverage}`);
          console.log(`   - Trading Fee: ${template.tradingFeeRate / 100}%`);
          console.log(`   - Active: ${template.isActive}`);
        } catch (error) {
          console.log(`   - Error reading template: ${error.message}`);
        }
        console.log();
      }
    }

    // Check if "default" template exists specifically
    console.log("🔍 Checking 'default' template specifically...");
    try {
      const defaultTemplate = await factory.getTemplate("default");
      console.log("✅ 'default' template exists:");
      console.log(`   - Max Leverage: ${defaultTemplate.maxLeverage}`);
      console.log(`   - Active: ${defaultTemplate.isActive}`);
    } catch (error) {
      console.log("❌ 'default' template does not exist or is not active");
      console.log("   Available templates:", templateNames.join(", "));
    }

    // Check deployment fee
    console.log("\n💰 Deployment Info:");
    const deploymentFee = await factory.deploymentFee();
    console.log(
      `   - Deployment Fee: ${ethers.formatEther(deploymentFee)} MATIC`
    );

    const customTemplateFee = await factory.customTemplateFee();
    console.log(
      `   - Custom Template Fee: ${ethers.formatEther(customTemplateFee)} MATIC`
    );
  } catch (error) {
    console.error("❌ Error checking templates:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
