const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Starting Limit Order System Deployment...");
  console.log("========================================");

  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);
  console.log(
    "Account balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployer.address))
  );

  // Contract addresses from previous deployments (update these as needed)
  const EXISTING_CONTRACTS = {
    FACTORY:
      process.env.FACTORY_ADDRESS ||
      "0x0000000000000000000000000000000000000000",
    VAULT:
      process.env.VAULT_ADDRESS || "0x0000000000000000000000000000000000000000",
    ROUTER:
      process.env.ROUTER_ADDRESS ||
      "0x0000000000000000000000000000000000000000",
    USDC:
      process.env.USDC_ADDRESS || "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // Polygon USDC
  };

  // Deployment configuration
  const DEPLOYMENT_CONFIG = {
    AUTOMATION_FEES: {
      AUTOMATION_FEE_USDC: ethers.parseUnits("2", 6), // $2 USDC
      EXECUTION_FEE_USDC: ethers.parseUnits("3", 6), // $3 USDC
      MIN_KEEPER_FEE: ethers.parseUnits("1", 6), // $1 USDC
    },
    FUNDING_CONFIG: {
      MIN_LINK_BALANCE: ethers.parseEther("5"), // 5 LINK minimum
      REFILL_AMOUNT: ethers.parseEther("20"), // 20 LINK refill
      LINK_BUFFER: ethers.parseEther("50"), // 50 LINK treasury buffer
      TREASURY_SHARE: 7000, // 70% for LINK funding (basis points)
      PROTOCOL_SHARE: 3000, // 30% for protocol revenue
    },
    KEEPER_CONFIG: {
      MAX_ORDERS_PER_CHECK: 20,
      MAX_ORDERS_PER_EXECUTION: 10,
      MIN_EXECUTION_INTERVAL: 30, // seconds
      ESTIMATED_GAS_PER_ORDER: 200000,
      MAX_GAS_LIMIT: 2000000,
    },
  };

  // External contract addresses (Polygon mainnet)
  const EXTERNAL_CONTRACTS = {
    LINK_TOKEN: "0x53E0bca35eC356BD5ddDFebbD1Fc0fD03FaBad39",
    AUTOMATION_REGISTRY: "0x02777053d6764996e594c3E88AF1D58D5363a2e6",
    SWAP_ROUTER: "0xE592427A0AEce92De3Edee1F18E0157C05861564", // Uniswap V3
    WETH: "0x7ceB23fD6bC0adD59E62ac25578270cFf1b9f619",
  };

  let deployedContracts = {};

  try {
    // Step 1: Deploy AutomationFundingManager
    console.log("\n📋 Step 1: Deploying AutomationFundingManager...");
    const AutomationFundingManager = await ethers.getContractFactory(
      "AutomationFundingManager"
    );
    const automationFunding = await AutomationFundingManager.deploy(
      deployer.address, // treasury (initially deployer)
      "0x0000000000000000000000000000000000000000" // limitOrderManager (will be updated)
    );
    await automationFunding.waitForDeployment();
    deployedContracts.automationFunding = await automationFunding.getAddress();
    console.log(
      "✅ AutomationFundingManager deployed to:",
      deployedContracts.automationFunding
    );

    // Step 2: Deploy MetricLimitOrderManager
    console.log("\n📋 Step 2: Deploying MetricLimitOrderManager...");
    const MetricLimitOrderManager = await ethers.getContractFactory(
      "MetricLimitOrderManager"
    );
    const limitOrderManager = await MetricLimitOrderManager.deploy(
      EXISTING_CONTRACTS.ROUTER,
      EXISTING_CONTRACTS.VAULT,
      EXISTING_CONTRACTS.FACTORY,
      deployedContracts.automationFunding
    );
    await limitOrderManager.waitForDeployment();
    deployedContracts.limitOrderManager = await limitOrderManager.getAddress();
    console.log(
      "✅ MetricLimitOrderManager deployed to:",
      deployedContracts.limitOrderManager
    );

    // Step 3: Update AutomationFundingManager with LimitOrderManager address
    console.log("\n📋 Step 3: Configuring AutomationFundingManager...");
    await automationFunding.setLimitOrderManager(
      deployedContracts.limitOrderManager
    );
    console.log(
      "✅ AutomationFundingManager configured with LimitOrderManager"
    );

    // Step 4: Deploy MetricLimitOrderKeeper
    console.log("\n📋 Step 4: Deploying MetricLimitOrderKeeper...");
    const MetricLimitOrderKeeper = await ethers.getContractFactory(
      "MetricLimitOrderKeeper"
    );
    const limitOrderKeeper = await MetricLimitOrderKeeper.deploy(
      deployedContracts.limitOrderManager,
      EXISTING_CONTRACTS.FACTORY
    );
    await limitOrderKeeper.waitForDeployment();
    deployedContracts.limitOrderKeeper = await limitOrderKeeper.getAddress();
    console.log(
      "✅ MetricLimitOrderKeeper deployed to:",
      deployedContracts.limitOrderKeeper
    );

    // Step 5: Update Router with LimitOrderManager (if router supports it)
    if (
      EXISTING_CONTRACTS.ROUTER !== "0x0000000000000000000000000000000000000000"
    ) {
      console.log("\n📋 Step 5: Updating Router with LimitOrderManager...");
      try {
        const router = await ethers.getContractAt(
          "MetricVAMMRouter",
          EXISTING_CONTRACTS.ROUTER
        );
        await router.setLimitOrderManager(deployedContracts.limitOrderManager);
        console.log("✅ Router updated with LimitOrderManager");
      } catch (error) {
        console.log(
          "⚠️  Could not update router (may not support limit orders yet):",
          error.message
        );
      }
    }

    // Step 6: Configure Keeper Authorization
    console.log("\n📋 Step 6: Configuring Keeper Authorization...");
    await limitOrderManager.addKeeper(deployedContracts.limitOrderKeeper);
    await limitOrderManager.addKeeper(deployer.address); // Add deployer as emergency keeper
    console.log("✅ Keeper authorization configured");

    // Step 7: Configure Automation Funding
    console.log("\n📋 Step 7: Configuring Automation Parameters...");
    await limitOrderKeeper.updateKeeperConfig(
      DEPLOYMENT_CONFIG.KEEPER_CONFIG.MIN_EXECUTION_INTERVAL,
      DEPLOYMENT_CONFIG.KEEPER_CONFIG.ESTIMATED_GAS_PER_ORDER,
      DEPLOYMENT_CONFIG.KEEPER_CONFIG.MAX_GAS_LIMIT
    );
    console.log("✅ Keeper configuration updated");

    // Step 8: Initial USDC Approval (if USDC is available)
    if (
      EXISTING_CONTRACTS.USDC !== "0x0000000000000000000000000000000000000000"
    ) {
      console.log("\n📋 Step 8: Setting up USDC approvals...");
      try {
        const usdc = await ethers.getContractAt(
          "IERC20",
          EXISTING_CONTRACTS.USDC
        );

        // Approve LimitOrderManager to spend USDC for fees
        const approvalAmount = ethers.parseUnits("10000", 6); // $10,000 approval
        await usdc.approve(deployedContracts.limitOrderManager, approvalAmount);
        console.log("✅ USDC approval set for LimitOrderManager");

        // Approve AutomationFunding to spend USDC
        await usdc.approve(deployedContracts.automationFunding, approvalAmount);
        console.log("✅ USDC approval set for AutomationFunding");
      } catch (error) {
        console.log("⚠️  Could not set USDC approvals:", error.message);
      }
    }

    // Step 9: Register Chainlink Automation Upkeep (optional)
    console.log("\n📋 Step 9: Chainlink Automation Setup...");
    console.log(
      "⚠️  Manual step required: Register upkeep at https://automation.chain.link/"
    );
    console.log("   Target Contract:", deployedContracts.limitOrderKeeper);
    console.log(
      "   Recommended Gas Limit:",
      DEPLOYMENT_CONFIG.KEEPER_CONFIG.MAX_GAS_LIMIT
    );
    console.log("   Check Data: Encode array of metric IDs to monitor");

    // Step 10: Verification
    console.log("\n📋 Step 10: Deployment Verification...");
    const deploymentSummary = {
      network: (await ethers.provider.getNetwork()).name,
      chainId: (await ethers.provider.getNetwork()).chainId,
      deployer: deployer.address,
      timestamp: new Date().toISOString(),
      contracts: deployedContracts,
      existingContracts: EXISTING_CONTRACTS,
      configuration: DEPLOYMENT_CONFIG,
    };

    console.log("\n🎉 DEPLOYMENT COMPLETED SUCCESSFULLY!");
    console.log("=====================================");
    console.table(deployedContracts);

    // Environment variables for frontend
    console.log("\n🔧 Environment Variables for Frontend (.env.local):");
    console.log("================================================");
    console.log(
      `NEXT_PUBLIC_LIMIT_ORDER_MANAGER=${deployedContracts.limitOrderManager}`
    );
    console.log(
      `NEXT_PUBLIC_AUTOMATION_FUNDING=${deployedContracts.automationFunding}`
    );
    console.log(
      `NEXT_PUBLIC_LIMIT_ORDER_KEEPER=${deployedContracts.limitOrderKeeper}`
    );
    console.log(`NEXT_PUBLIC_ROUTER=${EXISTING_CONTRACTS.ROUTER}`);
    console.log(`NEXT_PUBLIC_VAULT=${EXISTING_CONTRACTS.VAULT}`);
    console.log(`NEXT_PUBLIC_FACTORY=${EXISTING_CONTRACTS.FACTORY}`);
    console.log(`NEXT_PUBLIC_USDC=${EXISTING_CONTRACTS.USDC}`);

    // Contract verification commands
    console.log("\n🔍 Contract Verification Commands:");
    console.log("==================================");
    console.log(
      `npx hardhat verify --network polygon ${deployedContracts.automationFunding} "${deployer.address}" "0x0000000000000000000000000000000000000000"`
    );
    console.log(
      `npx hardhat verify --network polygon ${deployedContracts.limitOrderManager} "${EXISTING_CONTRACTS.ROUTER}" "${EXISTING_CONTRACTS.VAULT}" "${EXISTING_CONTRACTS.FACTORY}" "${deployedContracts.automationFunding}"`
    );
    console.log(
      `npx hardhat verify --network polygon ${deployedContracts.limitOrderKeeper} "${deployedContracts.limitOrderManager}" "${EXISTING_CONTRACTS.FACTORY}"`
    );

    // Usage guide
    console.log("\n📚 Next Steps:");
    console.log("===============");
    console.log(
      "1. Update frontend environment variables with deployed addresses"
    );
    console.log(
      "2. Register Chainlink Automation upkeep at https://automation.chain.link/"
    );
    console.log(
      "3. Fund the AutomationFundingManager with USDC for operations"
    );
    console.log("4. Test limit order creation and execution");
    console.log(
      "5. Monitor keeper performance and adjust gas settings as needed"
    );

    // Save deployment info to file
    const fs = require("fs");
    const deploymentFile = `deployments/limitOrder-${Date.now()}.json`;
    fs.writeFileSync(
      deploymentFile,
      JSON.stringify(deploymentSummary, null, 2)
    );
    console.log(`\n💾 Deployment info saved to: ${deploymentFile}`);

    return deploymentSummary;
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED:");
    console.error("====================");
    console.error("Error:", error.message);
    console.error("Stack:", error.stack);

    // Cleanup any partially deployed contracts if needed
    console.log("\n🧹 Cleanup Information:");
    console.log("Deployed contracts that may need cleanup:");
    console.table(deployedContracts);

    throw error;
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => {
      console.log("\n✅ Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\n❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { main };
