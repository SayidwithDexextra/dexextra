const { run } = require("hardhat");

/**
 * Quick Contract Verification Utility
 *
 * Usage:
 * npx hardhat run scripts/quickVerify.js --network polygon
 *
 * Or with specific contract:
 * CONTRACT_ADDRESS=0x123... CONTRACT_NAME=CentralizedVault npx hardhat run scripts/quickVerify.js --network polygon
 */

/**
 * Quick verification configurations for common contracts
 */
const QUICK_VERIFY_CONFIGS = {
  // Mock contracts (for testing)
  MockUSDC: {
    constructorArgs: [1000000],
    contractPath: "contracts/mocks/MockUSDC.sol:MockUSDC",
  },
  MockUMAOracle: {
    constructorArgs: [],
    contractPath: "contracts/mocks/MockUMAOracle.sol:MockUMAOracle",
  },

  // Core contracts (will need actual deployed addresses)
  CentralizedVault: {
    constructorArgs: [], // Will be populated from user input or env
    contractPath: "contracts/core/CentralizedVault.sol:CentralizedVault",
  },
  MetricRegistry: {
    constructorArgs: [],
    contractPath: "contracts/metrics/MetricRegistry.sol:MetricRegistry",
  },
  MetricVAMMFactory: {
    constructorArgs: [],
    contractPath: "contracts/core/MetricVAMMFactory.sol:MetricVAMMFactory",
  },
  Router: {
    constructorArgs: [],
    contractPath: "contracts/core/Router.sol:Router",
  },
  AutomationFundingManager: {
    constructorArgs: [],
    contractPath:
      "contracts/core/AutomationFundingManager.sol:AutomationFundingManager",
  },
  MetricLimitOrderManager: {
    constructorArgs: [],
    contractPath:
      "contracts/core/MetricLimitOrderManager.sol:MetricLimitOrderManager",
  },
  MetricLimitOrderKeeper: {
    constructorArgs: [],
    contractPath:
      "contracts/core/MetricLimitOrderKeeper.sol:MetricLimitOrderKeeper",
  },
};

/**
 * Log with colors
 */
function log(message, type = "info") {
  const colors = {
    success: "\x1b[32m✅",
    error: "\x1b[31m❌",
    warning: "\x1b[33m⚠️",
    info: "\x1b[36mℹ️",
  };
  const reset = "\x1b[0m";
  console.log(`${colors[type]} ${message}${reset}`);
}

/**
 * Parse constructor arguments from string input
 * @param {string} argsString - Comma-separated constructor arguments
 * @returns {Array} Parsed arguments
 */
function parseConstructorArgs(argsString) {
  if (!argsString) return [];

  try {
    // Try to parse as JSON array first
    const parsed = JSON.parse(argsString);
    if (Array.isArray(parsed)) return parsed;
  } catch (e) {
    // If not JSON, split by comma and trim
    return argsString.split(",").map((arg) => arg.trim());
  }

  return [];
}

/**
 * Quick verify a single contract
 * @param {string} contractAddress - Contract address
 * @param {string} contractName - Contract name
 * @param {Array} constructorArgs - Constructor arguments
 * @param {string} contractPath - Optional contract path
 */
async function quickVerify(
  contractAddress,
  contractName,
  constructorArgs = [],
  contractPath = null
) {
  try {
    log(`🔍 Verifying ${contractName} at ${contractAddress}...`, "info");

    if (constructorArgs.length > 0) {
      log(`📋 Constructor args: ${JSON.stringify(constructorArgs)}`, "info");
    }

    const verifyOptions = {
      address: contractAddress,
      constructorArguments: constructorArgs,
    };

    // Add contract path if specified
    if (contractPath) {
      verifyOptions.contract = contractPath;
    }

    await run("verify:verify", verifyOptions);

    log(`✅ Successfully verified ${contractName}!`, "success");

    // Print explorer link
    const networkName = hre.network.name;
    const explorerUrl = getExplorerUrl(contractAddress, networkName);
    log(`🔗 View on explorer: ${explorerUrl}`, "info");

    return true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      log(`✅ ${contractName} is already verified!`, "success");
      const networkName = hre.network.name;
      const explorerUrl = getExplorerUrl(contractAddress, networkName);
      log(`🔗 View on explorer: ${explorerUrl}`, "info");
      return true;
    }

    log(`❌ Verification failed: ${error.message}`, "error");
    return false;
  }
}

/**
 * Get block explorer URL
 */
function getExplorerUrl(address, network) {
  const explorers = {
    polygon: `https://polygonscan.com/address/${address}#code`,
    sepolia: `https://sepolia.etherscan.io/address/${address}#code`,
    mainnet: `https://etherscan.io/address/${address}#code`,
  };

  return explorers[network] || `https://etherscan.io/address/${address}#code`;
}

/**
 * Interactive prompt for contract details
 */
async function promptForContractDetails() {
  const readline = require("readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) =>
    new Promise((resolve) => {
      rl.question(prompt, resolve);
    });

  try {
    log("📝 Enter contract verification details:", "info");

    const contractAddress = await question("Contract Address: ");
    const contractName = await question("Contract Name: ");
    const argsInput = await question(
      "Constructor Arguments (comma-separated or JSON array, leave empty if none): "
    );

    rl.close();

    const constructorArgs = parseConstructorArgs(argsInput);
    const config = QUICK_VERIFY_CONFIGS[contractName];
    const contractPath = config?.contractPath;

    return { contractAddress, contractName, constructorArgs, contractPath };
  } catch (error) {
    rl.close();
    throw error;
  }
}

/**
 * Main function
 */
async function main() {
  const hre = require("hardhat");
  const networkName = hre.network.name;

  log(`🚀 Quick Contract Verification on ${networkName}`, "info");
  log("=".repeat(50), "info");

  // Check for API key
  const apiKeyVar =
    networkName === "polygon" ? "POLYGONSCAN_API_KEY" : "ETHERSCAN_API_KEY";
  if (!process.env[apiKeyVar]) {
    log(`❌ Missing ${apiKeyVar} environment variable`, "error");
    log("Please add your API key to the .env file", "info");
    process.exit(1);
  }

  try {
    let contractAddress = process.env.CONTRACT_ADDRESS;
    let contractName = process.env.CONTRACT_NAME;
    let constructorArgs = parseConstructorArgs(
      process.env.CONSTRUCTOR_ARGS || ""
    );
    let contractPath = process.env.CONTRACT_PATH;

    // If no environment variables provided, prompt user
    if (!contractAddress || !contractName) {
      const details = await promptForContractDetails();
      contractAddress = details.contractAddress;
      contractName = details.contractName;
      constructorArgs = details.constructorArgs;
      contractPath = details.contractPath;
    }

    // Use predefined config if available
    const config = QUICK_VERIFY_CONFIGS[contractName];
    if (config && !contractPath) {
      contractPath = config.contractPath;

      // Use default constructor args if none provided
      if (constructorArgs.length === 0 && config.constructorArgs.length > 0) {
        log(`⚠️ Using default constructor args for ${contractName}`, "warning");
        constructorArgs = config.constructorArgs;
      }
    }

    // Validate inputs
    if (!contractAddress || !contractName) {
      log("❌ Contract address and name are required", "error");
      process.exit(1);
    }

    // Perform verification
    const success = await quickVerify(
      contractAddress,
      contractName,
      constructorArgs,
      contractPath
    );

    if (success) {
      log("🎉 Verification completed successfully!", "success");
    } else {
      log("💥 Verification failed", "error");
      process.exit(1);
    }
  } catch (error) {
    log(`💥 Error: ${error.message}`, "error");
    process.exit(1);
  }
}

// Export for use in other scripts
module.exports = {
  quickVerify,
  parseConstructorArgs,
  QUICK_VERIFY_CONFIGS,
};

// Run if called directly
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}
