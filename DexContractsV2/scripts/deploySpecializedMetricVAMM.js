const { ethers, network } = require("hardhat");
const { verifyContract } = require("./verifyContracts");

/**
 * Deploy SpecializedMetricVAMM with automatic verification
 * 
 * This script deploys a new SpecializedMetricVAMM using existing deployed contracts
 * from your deployment-polygon-startprice-upgrade.json file
 */

// Existing deployed contracts from your deployment file
const EXISTING_CONTRACTS = {
  usdc: "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377",
  metricRegistry: "0x8f5200203c53c5821061D1f29249f10A5b57CA6A", 
  centralVault: "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93",
  factory: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
  router: "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5"
};

// Configuration for the SpecializedMetricVAMM
const VAMM_CONFIG = {
  category: "General Trading", // Category name for the VAMM
  allowedMetrics: [
    ethers.keccak256(ethers.toUtf8Bytes("BTC_PRICE")),
    ethers.keccak256(ethers.toUtf8Bytes("ETH_PRICE")),
    ethers.keccak256(ethers.toUtf8Bytes("MATIC_PRICE"))
  ], // Example metrics - you can modify these
  startPrice: ethers.parseEther("100"), // Starting price: $100
  
  // Template configuration
  template: {
    maxLeverage: ethers.parseEther("10"), // 10x leverage
    tradingFeeRate: 100, // 1% trading fee (100 basis points)
    liquidationFeeRate: 500, // 5% liquidation fee (500 basis points)
    maintenanceMarginRatio: 500, // 5% maintenance margin (500 basis points)
    initialReserves: ethers.parseEther("10000"), // Initial virtual reserves
    volumeScaleFactor: ethers.parseEther("1"), // Volume scale factor
    startPrice: ethers.parseEther("100"), // Starting price
    isActive: true, // Template is active
    description: "General trading template for crypto price metrics"
  }
};

/**
 * Log with colors
 */
function log(message, type = 'info') {
  const colors = {
    success: '\x1b[32m✅',
    error: '\x1b[31m❌', 
    warning: '\x1b[33m⚠️',
    info: '\x1b[36mℹ️',
    deploy: '\x1b[35m🚀'
  };
  const reset = '\x1b[0m';
  console.log(`${colors[type]} ${message}${reset}`);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const networkName = network.name;
  
  log(`🚀 Deploying SpecializedMetricVAMM on ${networkName}`, 'deploy');
  log(`👤 Deployer: ${deployer.address}`, 'info');
  log(`💰 Balance: ${ethers.formatEther(await deployer.provider.getBalance(deployer.address))} ETH`, 'info');
  log('='.repeat(60), 'info');

  try {
    // Verify existing contracts are deployed
    log('🔍 Verifying existing contract addresses...', 'info');
    for (const [name, address] of Object.entries(EXISTING_CONTRACTS)) {
      const code = await ethers.provider.getCode(address);
      if (code === '0x') {
        throw new Error(`Contract ${name} not found at address ${address}`);
      }
      log(`✅ ${name}: ${address}`, 'success');
    }

    // Prepare constructor arguments
    const constructorArgs = [
      EXISTING_CONTRACTS.centralVault,     // _centralVault
      EXISTING_CONTRACTS.metricRegistry,   // _metricRegistry  
      EXISTING_CONTRACTS.factory,          // _factory
      VAMM_CONFIG.category,                // _category
      VAMM_CONFIG.allowedMetrics,          // _allowedMetrics
      VAMM_CONFIG.template,                // _template
      VAMM_CONFIG.startPrice               // _startPrice
    ];

    log('📋 Constructor arguments:', 'info');
    log(`  Central Vault: ${EXISTING_CONTRACTS.centralVault}`, 'info');
    log(`  Metric Registry: ${EXISTING_CONTRACTS.metricRegistry}`, 'info');
    log(`  Factory: ${EXISTING_CONTRACTS.factory}`, 'info');
    log(`  Category: ${VAMM_CONFIG.category}`, 'info');
    log(`  Allowed Metrics: ${VAMM_CONFIG.allowedMetrics.length} metrics`, 'info');
    log(`  Start Price: ${ethers.formatEther(VAMM_CONFIG.startPrice)} ETH`, 'info');
    log(`  Max Leverage: ${ethers.formatEther(VAMM_CONFIG.template.maxLeverage)}x`, 'info');

    // Deploy the contract
    log('🚀 Deploying SpecializedMetricVAMM...', 'deploy');
    
    const SpecializedMetricVAMM = await ethers.getContractFactory("SpecializedMetricVAMM");
    const specializedVAMM = await SpecializedMetricVAMM.deploy(...constructorArgs);
    
    await specializedVAMM.waitForDeployment();
    const vammAddress = await specializedVAMM.getAddress();
    const deploymentTx = specializedVAMM.deploymentTransaction();

    log(`✅ SpecializedMetricVAMM deployed to: ${vammAddress}`, 'success');
    log(`📋 Transaction hash: ${deploymentTx.hash}`, 'info');
    log(`⛽ Gas used: ${deploymentTx.gasLimit?.toString()}`, 'info');

    // Auto-verify if not on localhost/hardhat
    if (networkName !== 'hardhat' && networkName !== 'localhost') {
      log('⏳ Waiting 30 seconds before verification...', 'info');
      await new Promise(resolve => setTimeout(resolve, 30000));
      
      log('🔍 Starting contract verification...', 'info');
      const verificationSuccess = await verifyContract(
        vammAddress, 
        "SpecializedMetricVAMM", 
        constructorArgs
      );

      if (verificationSuccess) {
        log('🎉 Contract verification successful!', 'success');
        const explorerUrl = `https://polygonscan.com/address/${vammAddress}#code`;
        log(`🔗 View on Polygonscan: ${explorerUrl}`, 'info');
      } else {
        log('⚠️ Contract verification failed, but deployment was successful', 'warning');
      }
    }

    // Print deployment summary
    log('\n🎉 Deployment Summary', 'success');
    log('='.repeat(40), 'info');
    log(`Network: ${networkName}`, 'info');
    log(`Contract: SpecializedMetricVAMM`, 'info');
    log(`Address: ${vammAddress}`, 'info');
    log(`Category: ${VAMM_CONFIG.category}`, 'info');
    log(`Allowed Metrics: ${VAMM_CONFIG.allowedMetrics.length}`, 'info');
    log(`Start Price: $${ethers.formatEther(VAMM_CONFIG.startPrice)}`, 'info');
    
    // Save deployment info
    const deploymentInfo = {
      network: networkName,
      timestamp: new Date().toISOString(),
      specializedMetricVAMM: {
        address: vammAddress,
        deploymentTx: deploymentTx.hash,
        constructorArgs: constructorArgs,
        config: VAMM_CONFIG
      },
      existingContracts: EXISTING_CONTRACTS
    };

    console.log('\n📄 Deployment Info (save this):');
    console.log(JSON.stringify(deploymentInfo, null, 2));

  } catch (error) {
    log(`💥 Deployment failed: ${error.message}`, 'error');
    throw error;
  }
}

// Export for use in other scripts
module.exports = {
  EXISTING_CONTRACTS,
  VAMM_CONFIG
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