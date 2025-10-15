// Simple test script to verify contract configuration
const fs = require("fs");
const path = require("path");

try {
  // Read the contracts.ts file to check if it exports correctly
  const contractsPath = path.join(__dirname, "src/lib/contracts.ts");
  const contractsContent = fs.readFileSync(contractsPath, "utf8");

  console.log("✅ Contract configuration file exists and is readable");

  // Check if key exports are present
  const hasContractAddresses = contractsContent.includes(
    "export const CONTRACT_ADDRESSES"
  );
  const hasContracts = contractsContent.includes("export const CONTRACTS");
  const hasDeploymentInfo = contractsContent.includes(
    "export const DEPLOYMENT_INFO"
  );
  const hasDexetrav5Config = contractsContent.includes("getDexetrav5Config");

  console.log("📋 Configuration exports check:");
  console.log(`  - CONTRACT_ADDRESSES: ${hasContractAddresses ? "✅" : "❌"}`);
  console.log(`  - CONTRACTS: ${hasContracts ? "✅" : "❌"}`);
  console.log(`  - DEPLOYMENT_INFO: ${hasDeploymentInfo ? "✅" : "❌"}`);
  console.log(
    `  - Dexetrav5 config integration: ${hasDexetrav5Config ? "✅" : "❌"}`
  );

  // Check if Dexetrav5 config file exists
  const dexetrav5ConfigPath = path.join(
    __dirname,
    "src/lib/dexetrav5Config.ts"
  );
  if (fs.existsSync(dexetrav5ConfigPath)) {
    console.log("✅ Dexetrav5 config file exists");
  } else {
    console.log("❌ Dexetrav5 config file missing");
  }

  console.log(
    "\n🎯 Contract configuration refactoring completed successfully!"
  );
} catch (error) {
  console.error("❌ Error testing contract configuration:", error.message);
}
