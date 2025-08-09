const { ethers } = require("hardhat");

/**
 * Script to help identify constructor arguments for SpecializedMetricVAMM
 * Contract address: 0xc6d15Af1c2214b3f3e060fe4e95Dd5d0D1612053
 */

const CONTRACT_ADDRESS = "0xc6d15Af1c2214b3f3e060fe4e95Dd5d0D1612053";

// Your existing deployed contracts
const EXISTING_CONTRACTS = {
  usdc: "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377",
  metricRegistry: "0x8f5200203c53c5821061D1f29249f10A5b57CA6A",
  centralVault: "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93",
  factory: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
  router: "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5",
};

async function main() {
  console.log("🔍 Analyzing SpecializedMetricVAMM at:", CONTRACT_ADDRESS);
  console.log("=".repeat(60));

  try {
    // Connect to the deployed contract
    const SpecializedMetricVAMM = await ethers.getContractFactory(
      "SpecializedMetricVAMM"
    );
    const contract = SpecializedMetricVAMM.attach(CONTRACT_ADDRESS);

    // Read the immutable/public variables to determine constructor args
    console.log(
      "📋 Reading contract state to determine constructor arguments...\n"
    );

    try {
      const centralVault = await contract.centralVault();
      console.log("✅ Central Vault:", centralVault);
    } catch (e) {
      console.log("❌ Could not read centralVault:", e.message);
    }

    try {
      const metricRegistry = await contract.metricRegistry();
      console.log("✅ Metric Registry:", metricRegistry);
    } catch (e) {
      console.log("❌ Could not read metricRegistry:", e.message);
    }

    try {
      const factory = await contract.factory();
      console.log("✅ Factory:", factory);
    } catch (e) {
      console.log("❌ Could not read factory:", e.message);
    }

    try {
      const category = await contract.vammCategory();
      console.log("✅ Category:", category);
    } catch (e) {
      console.log("❌ Could not read vammCategory:", e.message);
    }

    try {
      const startPrice = await contract.startPrice();
      console.log("✅ Start Price:", ethers.formatEther(startPrice));
    } catch (e) {
      console.log("❌ Could not read startPrice:", e.message);
    }

    try {
      const maxLeverage = await contract.maxLeverage();
      console.log("✅ Max Leverage:", ethers.formatEther(maxLeverage));
    } catch (e) {
      console.log("❌ Could not read maxLeverage:", e.message);
    }

    try {
      const tradingFeeRate = await contract.tradingFeeRate();
      console.log("✅ Trading Fee Rate:", tradingFeeRate.toString());
    } catch (e) {
      console.log("❌ Could not read tradingFeeRate:", e.message);
    }

    console.log("\n" + "=".repeat(60));
    console.log(
      "🎯 Based on the contract state, here are possible constructor arguments:"
    );
    console.log("=".repeat(60));

    // Generate possible constructor arguments
    console.log("Constructor arguments for verification:");
    console.log("1. _centralVault: (read from contract state above)");
    console.log("2. _metricRegistry: (read from contract state above)");
    console.log("3. _factory: (read from contract state above)");
    console.log("4. _category: (read from contract state above)");
    console.log(
      "5. _allowedMetrics: [array of bytes32] - need to check contract or deployment logs"
    );
    console.log(
      "6. _template: {struct} - need to reconstruct from contract state"
    );
    console.log("7. _startPrice: (read from contract state above)");

    console.log("\n🔧 Manual verification command template:");
    console.log("npx hardhat verify --network polygon", CONTRACT_ADDRESS);
    console.log('  "CENTRAL_VAULT_ADDRESS"');
    console.log('  "METRIC_REGISTRY_ADDRESS"');
    console.log('  "FACTORY_ADDRESS"');
    console.log('  "CATEGORY_STRING"');
    console.log('  \'["METRIC1_HASH","METRIC2_HASH"]\'');
    console.log('  \'{"maxLeverage":"VALUE","tradingFeeRate":VALUE,...}\'');
    console.log('  "START_PRICE_VALUE"');
  } catch (error) {
    console.error("❌ Error analyzing contract:", error.message);

    console.log("\n💡 Alternative approach: Check Polygonscan directly");
    console.log(`🔗 https://polygonscan.com/address/${CONTRACT_ADDRESS}#code`);
    console.log("\nLook for:");
    console.log("1. Constructor arguments in the 'Contract' tab");
    console.log("2. Contract creation transaction");
    console.log("3. Input data of the deployment transaction");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
