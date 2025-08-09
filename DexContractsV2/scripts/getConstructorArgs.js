const { ethers } = require("hardhat");

async function getConstructorArgs() {
  console.log("🔍 Extracting Constructor Arguments for MetricVAMMRouter");
  console.log("=".repeat(60));

  const ROUTER_ADDRESS = "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5";
  const CREATION_TX =
    "0x8ceb68cb2305d9c6bbe006d3699f3acef945d3e2b9bf4310b2bbb626a1c9a8e2";

  try {
    // Get the transaction receipt
    console.log("📋 Getting transaction receipt...");
    const receipt = await ethers.provider.getTransactionReceipt(CREATION_TX);

    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    console.log(`✅ Transaction found in block: ${receipt.blockNumber}`);
    console.log(`✅ Contract address: ${receipt.contractAddress}`);
    console.log(`✅ Gas used: ${receipt.gasUsed.toString()}`);

    // Get the transaction data
    console.log("\n📋 Getting transaction data...");
    const tx = await ethers.provider.getTransaction(CREATION_TX);

    if (!tx) {
      throw new Error("Transaction not found");
    }

    // Get the MetricVAMMRouter contract factory to decode constructor args
    console.log("\n🏗️ Loading contract factory...");
    const MetricVAMMRouter = await ethers.getContractFactory(
      "MetricVAMMRouter"
    );

    // Get the contract creation bytecode
    const creationBytecode = tx.data;
    const deployedBytecode = await ethers.provider.getCode(ROUTER_ADDRESS);

    console.log(`📏 Creation bytecode length: ${creationBytecode.length}`);
    console.log(`📏 Deployed bytecode length: ${deployedBytecode.length}`);

    // The constructor arguments are at the end of the creation bytecode
    // We need to find where the constructor args start
    const contractBytecode = MetricVAMMRouter.bytecode;
    console.log(`📏 Contract bytecode length: ${contractBytecode.length}`);

    // Constructor args start after the contract bytecode
    const constructorArgsHex = creationBytecode.slice(contractBytecode.length);
    console.log(`📋 Constructor args hex: ${constructorArgsHex}`);

    if (constructorArgsHex.length === 0) {
      console.log("❌ No constructor arguments found");
      return;
    }

    // Decode the constructor arguments
    console.log("\n🔍 Decoding constructor arguments...");

    // Router constructor: (address _factory, address _centralVault, address _metricRegistry, address _limitOrderManager)
    const constructorInterface = new ethers.Interface([
      "constructor(address _factory, address _centralVault, address _metricRegistry, address _limitOrderManager)",
    ]);

    try {
      const decodedArgs = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "address", "address", "address"],
        "0x" + constructorArgsHex
      );

      console.log("✅ Constructor arguments decoded successfully:");
      console.log(`  Factory:              ${decodedArgs[0]}`);
      console.log(`  Central Vault:        ${decodedArgs[1]}`);
      console.log(`  Metric Registry:      ${decodedArgs[2]}`);
      console.log(`  Limit Order Manager:  ${decodedArgs[3]}`);

      // Verify against expected addresses
      const expectedAddresses = {
        factory: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
        vault: "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93",
        registry: "0x8f5200203c53c5821061D1f29249f10A5b57CA6A",
        limitOrderManager: "0x6c91c1A5D49707f4716344d0881c43215FC55D41",
      };

      console.log("\n🔍 Verification against expected addresses:");
      console.log(
        `  Factory:              ${
          decodedArgs[0] === expectedAddresses.factory
            ? "✅ MATCH"
            : "❌ MISMATCH"
        }`
      );
      console.log(
        `  Central Vault:        ${
          decodedArgs[1] === expectedAddresses.vault
            ? "✅ MATCH"
            : "❌ MISMATCH"
        }`
      );
      console.log(
        `  Metric Registry:      ${
          decodedArgs[2] === expectedAddresses.registry
            ? "✅ MATCH"
            : "❌ MISMATCH"
        }`
      );
      console.log(
        `  Limit Order Manager:  ${
          decodedArgs[3] === expectedAddresses.limitOrderManager
            ? "✅ MATCH"
            : "❌ MISMATCH"
        }`
      );

      // Generate verification command
      console.log("\n🚀 Hardhat Verification Command:");
      console.log("=".repeat(40));
      console.log(`npx hardhat verify --network polygon ${ROUTER_ADDRESS} \\`);
      console.log(`  "${decodedArgs[0]}" \\`);
      console.log(`  "${decodedArgs[1]}" \\`);
      console.log(`  "${decodedArgs[2]}" \\`);
      console.log(`  "${decodedArgs[3]}"`);

      // Return the arguments for use in other scripts
      return {
        factory: decodedArgs[0],
        centralVault: decodedArgs[1],
        metricRegistry: decodedArgs[2],
        limitOrderManager: decodedArgs[3],
      };
    } catch (decodeError) {
      console.log(
        "❌ Failed to decode with 4 arguments, trying 3 arguments..."
      );

      // Try with 3 arguments (old version without limit order manager)
      try {
        const decodedArgs3 = ethers.AbiCoder.defaultAbiCoder().decode(
          ["address", "address", "address"],
          "0x" + constructorArgsHex
        );

        console.log("✅ Constructor arguments decoded (3 args):");
        console.log(`  Factory:              ${decodedArgs3[0]}`);
        console.log(`  Central Vault:        ${decodedArgs3[1]}`);
        console.log(`  Metric Registry:      ${decodedArgs3[2]}`);

        console.log("\n🚀 Hardhat Verification Command (3 args):");
        console.log("=".repeat(40));
        console.log(
          `npx hardhat verify --network polygon ${ROUTER_ADDRESS} \\`
        );
        console.log(`  "${decodedArgs3[0]}" \\`);
        console.log(`  "${decodedArgs3[1]}" \\`);
        console.log(`  "${decodedArgs3[2]}"`);

        return {
          factory: decodedArgs3[0],
          centralVault: decodedArgs3[1],
          metricRegistry: decodedArgs3[2],
        };
      } catch (decode3Error) {
        console.log("❌ Failed to decode constructor arguments");
        console.log("Raw hex:", constructorArgsHex);
        throw decode3Error;
      }
    }
  } catch (error) {
    console.error("❌ Error extracting constructor arguments:", error.message);
    throw error;
  }
}

// Execute if run directly
if (require.main === module) {
  getConstructorArgs()
    .then((args) => {
      console.log("\n🎉 Constructor arguments extracted successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Failed to extract constructor arguments:", error);
      process.exit(1);
    });
}

module.exports = { getConstructorArgs };
