const { ethers, network } = require("hardhat");
const { verifyContract } = require("./verifyContracts");
const fs = require("fs");
const path = require("path");

/**
 * Enhanced Deployment Script with Automatic Polygonscan Verification
 *
 * This script:
 * 1. Deploys smart contracts
 * 2. Automatically verifies them on Polygonscan/Etherscan
 * 3. Saves deployment data for future reference
 * 4. Provides comprehensive deployment reporting
 */

// Deployment Configuration
const DEPLOYMENT_CONFIG = {
  // Verification delay after deployment (allows blockchain to index the contract)
  VERIFICATION_DELAY: 30000, // 30 seconds

  // Save deployment artifacts
  SAVE_DEPLOYMENT_DATA: true,

  // Automatically verify after deployment
  AUTO_VERIFY: true,

  // Gas price configuration (optional)
  GAS_PRICE_GWEI: null, // null = auto, or specify like 50 for 50 gwei

  // Contract deployment order (for dependencies)
  DEPLOYMENT_ORDER: [
    "MockUSDC",
    "MockUMAOracle",
    "CentralizedVault",
    "MetricRegistry",
    "MetricVAMMFactory",
    "Router",
    "AutomationFundingManager",
    "MetricLimitOrderManager",
    "MetricLimitOrderKeeper",
  ],
};

// Deployment results tracking
const deploymentResults = {
  contracts: {},
  transactions: [],
  verificationResults: {},
  errors: [],
};

/**
 * Sleep utility function
 * @param {number} ms - Milliseconds to sleep
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Log deployment status with colors
 * @param {string} message - Message to log
 * @param {string} type - success, error, warning, info
 */
function log(message, type = "info") {
  const colors = {
    success: "\x1b[32m✅",
    error: "\x1b[31m❌",
    warning: "\x1b[33m⚠️",
    info: "\x1b[36mℹ️",
    deploy: "\x1b[35m🚀",
  };
  const reset = "\x1b[0m";
  console.log(`${colors[type]} ${message}${reset}`);
}

/**
 * Get network-specific gas configuration
 * @returns {Object} Gas configuration
 */
function getGasConfig() {
  const networkName = network.name;

  const gasConfigs = {
    polygon: {
      gasPrice: DEPLOYMENT_CONFIG.GAS_PRICE_GWEI
        ? ethers.parseUnits(DEPLOYMENT_CONFIG.GAS_PRICE_GWEI.toString(), "gwei")
        : ethers.parseUnits("50", "gwei"), // 50 gwei for Polygon
    },
    sepolia: {
      gasPrice: DEPLOYMENT_CONFIG.GAS_PRICE_GWEI
        ? ethers.parseUnits(DEPLOYMENT_CONFIG.GAS_PRICE_GWEI.toString(), "gwei")
        : undefined, // Let ethers auto-determine
    },
    mainnet: {
      gasPrice: DEPLOYMENT_CONFIG.GAS_PRICE_GWEI
        ? ethers.parseUnits(DEPLOYMENT_CONFIG.GAS_PRICE_GWEI.toString(), "gwei")
        : undefined, // Let ethers auto-determine
    },
  };

  return gasConfigs[networkName] || {};
}

/**
 * Deploy a single contract with automatic verification
 * @param {string} contractName - Name of the contract to deploy
 * @param {Array} constructorArgs - Constructor arguments
 * @param {Object} deployOptions - Additional deployment options
 * @returns {Object} Deployment result
 */
async function deployContract(
  contractName,
  constructorArgs = [],
  deployOptions = {}
) {
  try {
    log(`Deploying ${contractName}...`, "deploy");

    // Get contract factory
    const ContractFactory = await ethers.getContractFactory(contractName);

    // Prepare deployment options
    const gasConfig = getGasConfig();
    const fullDeployOptions = {
      ...gasConfig,
      ...deployOptions,
    };

    if (constructorArgs.length > 0) {
      log(`Constructor args: ${JSON.stringify(constructorArgs)}`, "info");
    }

    // Deploy contract
    const contract = await ContractFactory.deploy(
      ...constructorArgs,
      fullDeployOptions
    );
    await contract.waitForDeployment();

    const contractAddress = await contract.getAddress();
    const deploymentTx = contract.deploymentTransaction();

    log(`✅ ${contractName} deployed to: ${contractAddress}`, "success");
    log(`📋 Transaction hash: ${deploymentTx.hash}`, "info");

    // Store deployment data
    deploymentResults.contracts[contractName] = {
      address: contractAddress,
      constructorArgs,
      deploymentTx: deploymentTx.hash,
      blockNumber: deploymentTx.blockNumber,
      gasUsed: deploymentTx.gasLimit?.toString(),
      gasPrice: deploymentTx.gasPrice?.toString(),
      timestamp: new Date().toISOString(),
    };

    deploymentResults.transactions.push({
      contract: contractName,
      hash: deploymentTx.hash,
      address: contractAddress,
    });

    // Auto-verify if enabled and not on hardhat/localhost
    if (
      DEPLOYMENT_CONFIG.AUTO_VERIFY &&
      network.name !== "hardhat" &&
      network.name !== "localhost"
    ) {
      log(
        `Waiting ${
          DEPLOYMENT_CONFIG.VERIFICATION_DELAY / 1000
        }s before verification...`,
        "info"
      );
      await sleep(DEPLOYMENT_CONFIG.VERIFICATION_DELAY);

      log(`Starting verification for ${contractName}...`, "info");
      const verificationSuccess = await verifyContract(
        contractAddress,
        contractName,
        constructorArgs
      );

      deploymentResults.verificationResults[contractName] = {
        success: verificationSuccess,
        address: contractAddress,
        timestamp: new Date().toISOString(),
      };
    }

    return {
      contract,
      address: contractAddress,
      deploymentTx,
      success: true,
    };
  } catch (error) {
    log(`Failed to deploy ${contractName}: ${error.message}`, "error");
    deploymentResults.errors.push({
      contract: contractName,
      error: error.message,
      timestamp: new Date().toISOString(),
    });

    return {
      contract: null,
      address: null,
      deploymentTx: null,
      success: false,
      error: error.message,
    };
  }
}

/**
 * Deploy the complete DexContractsV2 system
 * @param {Object} config - Deployment configuration
 */
async function deployCompleteSystem(config = {}) {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;

  log(`🚀 Starting DexContractsV2 deployment on ${networkName}`, "info");
  log(`👤 Deployer: ${deployer.address}`, "info");
  log(
    `💰 Balance: ${ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    )} ETH`,
    "info"
  );
  log("=".repeat(60), "info");

  try {
    // Step 1: Deploy Mock USDC (for testing)
    const mockUSDC = await deployContract("MockUSDC", [1000000]); // 1M USDC
    if (!mockUSDC.success) throw new Error("MockUSDC deployment failed");

    // Step 2: Deploy Mock UMA Oracle (for testing)
    const mockOracle = await deployContract("MockUMAOracle", []);
    if (!mockOracle.success) throw new Error("MockUMAOracle deployment failed");

    // Step 3: Deploy CentralizedVault
    const vault = await deployContract("CentralizedVault", [mockUSDC.address]);
    if (!vault.success) throw new Error("CentralizedVault deployment failed");

    // Step 4: Deploy MetricRegistry
    const registry = await deployContract("MetricRegistry", [deployer.address]);
    if (!registry.success) throw new Error("MetricRegistry deployment failed");

    // Step 5: Deploy MetricVAMMFactory
    const factory = await deployContract("MetricVAMMFactory", [
      vault.address,
      registry.address,
    ]);
    if (!factory.success)
      throw new Error("MetricVAMMFactory deployment failed");

    // Step 6: Deploy Router
    const router = await deployContract("Router", [
      vault.address,
      factory.address,
    ]);
    if (!router.success) throw new Error("Router deployment failed");

    // Step 7: Deploy AutomationFundingManager
    const automationFunding = await deployContract("AutomationFundingManager", [
      deployer.address,
      "0x0000000000000000000000000000000000000000", // keeper address (can be updated later)
    ]);
    if (!automationFunding.success)
      throw new Error("AutomationFundingManager deployment failed");

    // Step 8: Deploy MetricLimitOrderManager
    const orderManager = await deployContract("MetricLimitOrderManager", [
      router.address,
      vault.address,
      factory.address,
      automationFunding.address,
    ]);
    if (!orderManager.success)
      throw new Error("MetricLimitOrderManager deployment failed");

    // Step 9: Deploy MetricLimitOrderKeeper
    const orderKeeper = await deployContract("MetricLimitOrderKeeper", [
      orderManager.address,
      automationFunding.address,
    ]);
    if (!orderKeeper.success)
      throw new Error("MetricLimitOrderKeeper deployment failed");

    log("🎉 All contracts deployed successfully!", "success");

    // Optional: Set up initial configuration
    if (config.setupInitialConfig) {
      await setupInitialConfiguration();
    }
  } catch (error) {
    log(`❌ Deployment failed: ${error.message}`, "error");
    throw error;
  }
}

/**
 * Set up initial configuration for deployed contracts
 */
async function setupInitialConfiguration() {
  log("⚙️ Setting up initial configuration...", "info");

  try {
    // Add any initial setup logic here
    // For example: setting up roles, initial parameters, etc.

    log("✅ Initial configuration completed", "success");
  } catch (error) {
    log(`⚠️ Initial configuration failed: ${error.message}`, "warning");
  }
}

/**
 * Save deployment data to file
 * @param {string} filename - Output filename
 */
function saveDeploymentData(filename = null) {
  if (!DEPLOYMENT_CONFIG.SAVE_DEPLOYMENT_DATA) return;

  const networkName = network.name;
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const defaultFilename = `deployment-${networkName}-${timestamp}.json`;

  const outputFile = filename || defaultFilename;
  const outputPath = path.join(__dirname, "..", "deployments", outputFile);

  // Ensure deployments directory exists
  const deploymentsDir = path.dirname(outputPath);
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }

  // Prepare deployment data
  const deploymentData = {
    network: networkName,
    chainId: network.config.chainId,
    timestamp: new Date().toISOString(),
    deployer: deploymentResults.transactions[0]?.deployer || "unknown",
    contracts: deploymentResults.contracts,
    transactions: deploymentResults.transactions,
    verificationResults: deploymentResults.verificationResults,
    errors: deploymentResults.errors,
  };

  try {
    fs.writeFileSync(outputPath, JSON.stringify(deploymentData, null, 2));
    log(`💾 Deployment data saved to: ${outputPath}`, "success");

    // Also save a "latest" file for easy reference
    const latestPath = path.join(deploymentsDir, `${networkName}-latest.json`);
    fs.writeFileSync(latestPath, JSON.stringify(deploymentData, null, 2));
  } catch (error) {
    log(`⚠️ Failed to save deployment data: ${error.message}`, "warning");
  }
}

/**
 * Print deployment summary
 */
function printDeploymentSummary() {
  const networkName = network.name;

  log("\n🎉 Deployment Summary", "success");
  log("=".repeat(50), "info");
  log(`Network: ${networkName}`, "info");
  log(
    `Contracts deployed: ${Object.keys(deploymentResults.contracts).length}`,
    "info"
  );
  log(
    `Verification attempts: ${
      Object.keys(deploymentResults.verificationResults).length
    }`,
    "info"
  );
  log(
    `Errors: ${deploymentResults.errors.length}`,
    deploymentResults.errors.length > 0 ? "error" : "info"
  );

  if (Object.keys(deploymentResults.contracts).length > 0) {
    log("\n📋 Deployed Contracts:", "info");
    Object.entries(deploymentResults.contracts).forEach(([name, data]) => {
      const explorerUrl = getExplorerUrl(data.address, networkName);
      log(`  ${name}: ${explorerUrl}`, "success");
    });
  }

  if (Object.keys(deploymentResults.verificationResults).length > 0) {
    log("\n🔍 Verification Results:", "info");
    Object.entries(deploymentResults.verificationResults).forEach(
      ([name, result]) => {
        const status = result.success ? "✅ Verified" : "❌ Failed";
        log(`  ${name}: ${status}`, result.success ? "success" : "error");
      }
    );
  }

  if (deploymentResults.errors.length > 0) {
    log("\n❌ Errors:", "error");
    deploymentResults.errors.forEach((error) => {
      log(`  ${error.contract}: ${error.error}`, "error");
    });
  }
}

/**
 * Get block explorer URL
 * @param {string} address - Contract address
 * @param {string} network - Network name
 * @returns {string} Explorer URL
 */
function getExplorerUrl(address, network) {
  const explorers = {
    polygon: `https://polygonscan.com/address/${address}`,
    sepolia: `https://sepolia.etherscan.io/address/${address}`,
    mainnet: `https://etherscan.io/address/${address}`,
  };

  return explorers[network] || `https://etherscan.io/address/${address}`;
}

/**
 * Main deployment function
 */
async function main() {
  try {
    await deployCompleteSystem({
      setupInitialConfig: false, // Set to true if you want initial configuration
    });

    // Save deployment data
    saveDeploymentData();

    // Print summary
    printDeploymentSummary();
  } catch (error) {
    log(`💥 Deployment process failed: ${error.message}`, "error");

    // Still save partial deployment data for debugging
    saveDeploymentData(`failed-deployment-${Date.now()}.json`);
    printDeploymentSummary();

    process.exit(1);
  }
}

// Export functions for use in other scripts
module.exports = {
  deployContract,
  deployCompleteSystem,
  saveDeploymentData,
  printDeploymentSummary,
  DEPLOYMENT_CONFIG,
  deploymentResults,
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
