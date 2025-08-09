const { ethers, run, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

/**
 * Comprehensive Contract Verification Script for Polygonscan
 *
 * This script can verify contracts in multiple ways:
 * 1. Verify all contracts from a deployment JSON file
 * 2. Verify specific contracts by address
 * 3. Auto-detect and verify contracts from deployment artifacts
 */

// Configuration
const VERIFICATION_CONFIG = {
  // Delay between verification attempts (to avoid rate limiting)
  VERIFICATION_DELAY: 5000, // 5 seconds

  // Maximum retry attempts for failed verifications
  MAX_RETRIES: 3,

  // Supported networks for verification
  SUPPORTED_NETWORKS: ["polygon", "sepolia", "mainnet"],

  // Contract verification status tracking
  VERIFICATION_RESULTS: {
    success: [],
    failed: [],
    skipped: [],
  },
};

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Log verification status with colors
 * @param {string} message - Message to log
 * @param {string} type - success, error, warning, info
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
 * Get contract constructor arguments from deployment artifacts
 * @param {string} contractName - Name of the contract
 * @param {string} contractAddress - Deployed address
 * @param {Object} deploymentData - Deployment metadata
 * @returns {Array} Constructor arguments
 */
function getConstructorArgs(contractName, contractAddress, deploymentData) {
  // Common constructor argument patterns for DexContractsV2
  const constructorPatterns = {
    CentralizedVault: (data) => [data.usdcAddress || data.baseToken],
    MetricVAMM: (data) => [
      data.vault || data.vaultAddress,
      data.oracle || data.oracleAddress,
      data.metricId || "0",
      data.startingPrice || ethers.parseEther("1"),
    ],
    MetricRegistry: (data) => [data.owner || data.deployer],
    Router: (data) => [
      data.vault || data.vaultAddress,
      data.factory || data.factoryAddress,
    ],
    MetricVAMMFactory: (data) => [
      data.vault || data.vaultAddress,
      data.registry || data.registryAddress,
    ],
    AutomationFundingManager: (data) => [
      data.owner || data.deployer,
      data.keeper || "0x0000000000000000000000000000000000000000",
    ],
    MetricLimitOrderManager: (data) => [
      data.router || data.routerAddress,
      data.vault || data.vaultAddress,
      data.factory || data.factoryAddress,
      data.automationFunding || data.automationFundingAddress,
    ],
    MetricLimitOrderKeeper: (data) => [
      data.orderManager || data.orderManagerAddress,
      data.automationFunding || data.automationFundingAddress,
    ],
    MockUSDC: (data) => [data.initialSupply || 1000000],
    MockUMAOracle: (data) => [],
  };

  if (constructorPatterns[contractName]) {
    try {
      return constructorPatterns[contractName](deploymentData);
    } catch (error) {
      log(
        `Warning: Could not auto-generate constructor args for ${contractName}: ${error.message}`,
        "warning"
      );
      return [];
    }
  }

  log(
    `Warning: No constructor pattern found for ${contractName}, using empty args`,
    "warning"
  );
  return [];
}

/**
 * Verify a single contract on the block explorer
 * @param {string} contractAddress - Address of deployed contract
 * @param {string} contractName - Name of the contract
 * @param {Array} constructorArgs - Constructor arguments
 * @param {number} retryCount - Current retry attempt
 * @returns {Promise<boolean>} Success status
 */
async function verifyContract(
  contractAddress,
  contractName,
  constructorArgs = [],
  retryCount = 0
) {
  try {
    log(`Verifying ${contractName} at ${contractAddress}...`, "info");

    if (constructorArgs.length > 0) {
      log(`Constructor args: ${JSON.stringify(constructorArgs)}`, "info");
    }

    await run("verify:verify", {
      address: contractAddress,
      constructorArguments: constructorArgs,
      contract: `contracts/${getContractPath(contractName)}:${contractName}`,
    });

    log(
      `Successfully verified ${contractName} at ${contractAddress}`,
      "success"
    );
    VERIFICATION_CONFIG.VERIFICATION_RESULTS.success.push({
      name: contractName,
      address: contractAddress,
      args: constructorArgs,
    });

    return true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      log(
        `${contractName} at ${contractAddress} is already verified`,
        "success"
      );
      VERIFICATION_CONFIG.VERIFICATION_RESULTS.success.push({
        name: contractName,
        address: contractAddress,
        status: "already_verified",
      });
      return true;
    }

    if (retryCount < VERIFICATION_CONFIG.MAX_RETRIES) {
      log(
        `Verification failed for ${contractName}, retrying (${retryCount + 1}/${
          VERIFICATION_CONFIG.MAX_RETRIES
        })...`,
        "warning"
      );
      await sleep(VERIFICATION_CONFIG.VERIFICATION_DELAY * 2); // Longer delay for retries
      return verifyContract(
        contractAddress,
        contractName,
        constructorArgs,
        retryCount + 1
      );
    }

    log(
      `Failed to verify ${contractName} at ${contractAddress}: ${error.message}`,
      "error"
    );
    VERIFICATION_CONFIG.VERIFICATION_RESULTS.failed.push({
      name: contractName,
      address: contractAddress,
      error: error.message,
    });

    return false;
  }
}

/**
 * Get the contract file path based on contract name
 * @param {string} contractName - Name of the contract
 * @returns {string} File path relative to contracts directory
 */
function getContractPath(contractName) {
  const contractPaths = {
    CentralizedVault: "core/CentralizedVault.sol",
    MetricVAMM: "core/MetricVAMM.sol",
    MetricRegistry: "metrics/MetricRegistry.sol",
    Router: "core/Router.sol",
    MetricVAMMFactory: "core/MetricVAMMFactory.sol",
    AutomationFundingManager: "core/AutomationFundingManager.sol",
    MetricLimitOrderManager: "core/MetricLimitOrderManager.sol",
    MetricLimitOrderKeeper: "core/MetricLimitOrderKeeper.sol",
    MockUSDC: "mocks/MockUSDC.sol",
    MockUMAOracle: "mocks/MockUMAOracle.sol",
  };

  return contractPaths[contractName] || `${contractName}.sol`;
}

/**
 * Load deployment data from various sources
 * @param {string} source - Path to deployment file or contract list
 * @returns {Object} Deployment data
 */
function loadDeploymentData(source) {
  try {
    if (fs.existsSync(source)) {
      const data = fs.readFileSync(source, "utf8");
      return JSON.parse(data);
    }
  } catch (error) {
    log(
      `Could not load deployment data from ${source}: ${error.message}`,
      "warning"
    );
  }

  return {};
}

/**
 * Verify contracts from deployment JSON
 * @param {string} deploymentFilePath - Path to deployment JSON file
 */
async function verifyFromDeploymentFile(deploymentFilePath) {
  log(`Loading deployment data from: ${deploymentFilePath}`, "info");

  const deploymentData = loadDeploymentData(deploymentFilePath);

  if (!deploymentData || Object.keys(deploymentData).length === 0) {
    log("No deployment data found", "error");
    return;
  }

  log(
    `Found ${Object.keys(deploymentData).length} contracts to verify`,
    "info"
  );

  for (const [contractName, contractInfo] of Object.entries(deploymentData)) {
    if (typeof contractInfo === "object" && contractInfo.address) {
      const constructorArgs = getConstructorArgs(
        contractName,
        contractInfo.address,
        deploymentData
      );
      await verifyContract(contractInfo.address, contractName, constructorArgs);
      await sleep(VERIFICATION_CONFIG.VERIFICATION_DELAY);
    } else if (typeof contractInfo === "string") {
      // Simple address mapping
      const constructorArgs = getConstructorArgs(
        contractName,
        contractInfo,
        deploymentData
      );
      await verifyContract(contractInfo, contractName, constructorArgs);
      await sleep(VERIFICATION_CONFIG.VERIFICATION_DELAY);
    }
  }
}

/**
 * Verify specific contracts by address
 * @param {Array} contracts - Array of {name, address, args} objects
 */
async function verifySpecificContracts(contracts) {
  log(`Verifying ${contracts.length} specific contracts`, "info");

  for (const contract of contracts) {
    const { name, address, args = [] } = contract;
    await verifyContract(address, name, args);
    await sleep(VERIFICATION_CONFIG.VERIFICATION_DELAY);
  }
}

/**
 * Main verification function
 */
async function main() {
  const networkName = network.name;

  log(`🔍 Starting contract verification on ${networkName}`, "info");
  log("=".repeat(60), "info");

  // Check if network is supported
  if (!VERIFICATION_CONFIG.SUPPORTED_NETWORKS.includes(networkName)) {
    log(`Network ${networkName} is not configured for verification`, "error");
    log(
      `Supported networks: ${VERIFICATION_CONFIG.SUPPORTED_NETWORKS.join(
        ", "
      )}`,
      "info"
    );
    return;
  }

  // Check for API key
  const apiKeyVar =
    networkName === "polygon" ? "POLYGONSCAN_API_KEY" : "ETHERSCAN_API_KEY";
  if (!process.env[apiKeyVar]) {
    log(`Missing ${apiKeyVar} environment variable`, "error");
    return;
  }

  try {
    // Method 1: Try to verify from deployment files
    const deploymentFiles = [
      "deployed_contracts.json",
      "deployment.json",
      "deployments/latest.json",
      `deployments/${networkName}.json`,
    ];

    let deploymentFound = false;
    for (const file of deploymentFiles) {
      const fullPath = path.join(__dirname, "..", file);
      if (fs.existsSync(fullPath)) {
        await verifyFromDeploymentFile(fullPath);
        deploymentFound = true;
        break;
      }
    }

    // Method 2: Manual contract list (fallback)
    if (!deploymentFound) {
      log(
        "No deployment file found, using manual verification mode",
        "warning"
      );

      // Example manual contracts - modify as needed
      const manualContracts = [
        // Add your deployed contracts here:
        // { name: 'CentralizedVault', address: '0x...', args: ['0xUSDC_ADDRESS'] },
        // { name: 'MetricRegistry', address: '0x...', args: ['0xOWNER_ADDRESS'] },
      ];

      if (manualContracts.length > 0) {
        await verifySpecificContracts(manualContracts);
      } else {
        log("No contracts configured for manual verification", "warning");
        log("Please either:", "info");
        log("1. Create a deployment file (deployed_contracts.json)", "info");
        log(
          "2. Add contracts to the manualContracts array in this script",
          "info"
        );
      }
    }
  } catch (error) {
    log(`Verification process failed: ${error.message}`, "error");
  }

  // Print summary
  log("\n🎉 Verification Summary", "info");
  log("=".repeat(40), "info");
  log(
    `✅ Successfully verified: ${VERIFICATION_CONFIG.VERIFICATION_RESULTS.success.length}`,
    "success"
  );
  log(
    `❌ Failed to verify: ${VERIFICATION_CONFIG.VERIFICATION_RESULTS.failed.length}`,
    "error"
  );
  log(
    `⏭️ Skipped: ${VERIFICATION_CONFIG.VERIFICATION_RESULTS.skipped.length}`,
    "warning"
  );

  if (VERIFICATION_CONFIG.VERIFICATION_RESULTS.failed.length > 0) {
    log("\nFailed contracts:", "error");
    VERIFICATION_CONFIG.VERIFICATION_RESULTS.failed.forEach((contract) => {
      log(
        `- ${contract.name} (${contract.address}): ${contract.error}`,
        "error"
      );
    });
  }

  if (VERIFICATION_CONFIG.VERIFICATION_RESULTS.success.length > 0) {
    log("\nSuccessfully verified contracts:", "success");
    VERIFICATION_CONFIG.VERIFICATION_RESULTS.success.forEach((contract) => {
      const explorerUrl = getExplorerUrl(contract.address, networkName);
      log(`- ${contract.name}: ${explorerUrl}`, "success");
    });
  }
}

/**
 * Get block explorer URL for verified contract
 * @param {string} address - Contract address
 * @param {string} network - Network name
 * @returns {string} Explorer URL
 */
function getExplorerUrl(address, network) {
  const explorers = {
    polygon: `https://polygonscan.com/address/${address}#code`,
    sepolia: `https://sepolia.etherscan.io/address/${address}#code`,
    mainnet: `https://etherscan.io/address/${address}#code`,
  };

  return explorers[network] || `https://etherscan.io/address/${address}#code`;
}

// Export functions for use in other scripts
module.exports = {
  verifyContract,
  verifyFromDeploymentFile,
  verifySpecificContracts,
  getConstructorArgs,
  VERIFICATION_CONFIG,
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
