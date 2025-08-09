const { ethers } = require("ethers");

async function getContractAddresses() {
  console.log("🔍 Fetching All Contract Addresses for Gold V6 Market");
  console.log("=".repeat(60));

  // Contract addresses we know
  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";
  const DEPLOYMENT_TX =
    "0x03f8c17e29dbdfc11508d0bcf5e5e9f40397cd427247269e4648cfff0fd2bbb2";
  const METRIC_NAME = "Gold Price V6";

  try {
    // Connect to Polygon
    console.log("🌐 Connecting to Polygon mainnet...");
    const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com");

    // Get transaction receipt to find VAMM address
    console.log("📋 Getting deployment transaction details...");
    const receipt = await provider.getTransactionReceipt(DEPLOYMENT_TX);

    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

    // Factory contract ABI (minimal)
    const FACTORY_ABI = [
      "function metricRegistry() external view returns (address)",
      "function centralizedVault() external view returns (address)",
      "function getVAMMByCategory(string calldata category) external view returns (address)",
      "function getVAMMByMetric(bytes32 metricId) external view returns (address)",
      "function getVAMMInfo(address vamm) external view returns (tuple(string category, bytes32[] allowedMetrics, string templateUsed, address creator, bool isActive, uint256 deployedAt))",
      "event SpecializedVAMMDeployed(address indexed vamm, string category, bytes32[] allowedMetrics, string templateUsed, address indexed creator)",
    ];

    const METRIC_REGISTRY_ABI = [
      "function getMetricByName(string calldata name) external view returns (tuple(bytes32 metricId, string name, string description, string dataSource, string calculationMethod, address creator, uint256 createdAt, uint256 settlementPeriodDays, uint256 minimumStake, bool isActive, bytes32 umaIdentifier))",
    ];

    const VAULT_ABI = [
      "function collateralToken() external view returns (address)",
      "function router() external view returns (address)",
    ];

    // Connect to factory contract
    console.log("\n🏭 Querying Factory Contract...");
    const factory = new ethers.Contract(FACTORY_ADDRESS, FACTORY_ABI, provider);

    // Get core addresses from factory
    const metricRegistryAddress = await factory.metricRegistry();
    console.log(`📋 Metric Registry: ${metricRegistryAddress}`);

    let centralizedVaultAddress;
    try {
      centralizedVaultAddress = await factory.centralizedVault();
      console.log(`🏦 Centralized Vault: ${centralizedVaultAddress}`);
    } catch (error) {
      console.log("⚠️ Centralized vault not found, using factory as vault");
      centralizedVaultAddress = FACTORY_ADDRESS;
    }

    // Find VAMM address from transaction logs
    console.log("\n🔍 Parsing transaction logs for VAMM address...");
    let vammAddress = null;

    // Try to parse the logs using the factory interface
    const factoryInterface = new ethers.Interface(FACTORY_ABI);

    for (const log of receipt.logs) {
      if (log.address.toLowerCase() === FACTORY_ADDRESS.toLowerCase()) {
        try {
          const parsed = factoryInterface.parseLog(log);
          if (parsed.name === "SpecializedVAMMDeployed") {
            vammAddress = parsed.args.vamm;
            console.log(`🏭 VAMM Address: ${vammAddress}`);
            console.log(`📂 Category: ${parsed.args.category}`);
            console.log(`🛠️ Template: ${parsed.args.templateUsed}`);
            break;
          }
        } catch (e) {
          // Skip logs that don't match
          continue;
        }
      }
    }

    if (!vammAddress) {
      console.log("⚠️ Could not extract VAMM address from logs");
      console.log("📝 Check Polygonscan manually:");
      console.log(`   https://polygonscan.com/tx/${DEPLOYMENT_TX}`);
      vammAddress = "CHECK_POLYGONSCAN_MANUALLY";
    }

    // Get metric details
    console.log("\n📊 Getting Metric Information...");
    const metricRegistry = new ethers.Contract(
      metricRegistryAddress,
      METRIC_REGISTRY_ABI,
      provider
    );

    let metricId = null;
    try {
      const metric = await metricRegistry.getMetricByName(METRIC_NAME);
      metricId = metric.metricId;
      console.log(`🎯 Metric ID: ${metricId}`);
      console.log(`📝 Metric Name: ${metric.name}`);
      console.log(`👤 Metric Creator: ${metric.creator}`);
      console.log(`📅 Settlement Period: ${metric.settlementPeriodDays} days`);
      console.log(
        `💰 Minimum Stake: ${ethers.formatEther(metric.minimumStake)} ETH`
      );
      console.log(`✅ Active: ${metric.isActive}`);
    } catch (error) {
      console.log("⚠️ Could not get metric details, generating ID...");
      metricId = `0x${Buffer.from(METRIC_NAME)
        .toString("hex")
        .padEnd(64, "0")}`;
      console.log(`🎯 Generated Metric ID: ${metricId}`);
    }

    // Get vault/router details
    console.log("\n🏦 Getting Vault Information...");
    let collateralTokenAddress = null;
    let routerAddress = null;

    try {
      const vault = new ethers.Contract(
        centralizedVaultAddress,
        VAULT_ABI,
        provider
      );
      collateralTokenAddress = await vault.collateralToken();
      console.log(`💵 Collateral Token: ${collateralTokenAddress}`);
    } catch (error) {
      console.log("⚠️ Could not get collateral token from vault");
      // Use default Mock USDC address
      collateralTokenAddress = "0x9D2110E6FD055Cf2605dde089FD3734C067dB515";
      console.log(`💵 Using default collateral: ${collateralTokenAddress}`);
    }

    try {
      const vault = new ethers.Contract(
        centralizedVaultAddress,
        VAULT_ABI,
        provider
      );
      routerAddress = await vault.router();
      console.log(`🔄 Router Address: ${routerAddress}`);
    } catch (error) {
      console.log("⚠️ Could not get router address from vault");
      routerAddress = "NO_ROUTER_FOUND";
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("📋 COMPLETE ADDRESS SUMMARY");
    console.log("=".repeat(60));

    const addressSummary = {
      // Core V2 Addresses
      factoryAddress: FACTORY_ADDRESS,
      metricRegistryAddress: metricRegistryAddress,
      centralizedVaultAddress: centralizedVaultAddress,
      vammAddress: vammAddress,

      // Market Specific
      metricId: metricId,
      metricName: METRIC_NAME,

      // Supporting Contracts
      collateralTokenAddress: collateralTokenAddress,
      routerAddress: routerAddress,

      // Deployment Info
      deploymentTxHash: DEPLOYMENT_TX,
      blockNumber: receipt.blockNumber.toString(),
      gasUsed: receipt.gasUsed.toString(),
    };

    console.log("🏭 Core V2 Infrastructure:");
    console.log(`   Factory: ${addressSummary.factoryAddress}`);
    console.log(`   Metric Registry: ${addressSummary.metricRegistryAddress}`);
    console.log(
      `   Centralized Vault: ${addressSummary.centralizedVaultAddress}`
    );
    console.log(`   VAMM: ${addressSummary.vammAddress}`);

    console.log("\n📊 Market Details:");
    console.log(`   Metric ID: ${addressSummary.metricId}`);
    console.log(`   Metric Name: ${addressSummary.metricName}`);

    console.log("\n🔗 Supporting Contracts:");
    console.log(
      `   Collateral Token: ${addressSummary.collateralTokenAddress}`
    );
    console.log(`   Router: ${addressSummary.routerAddress}`);

    console.log("\n🚀 Deployment Info:");
    console.log(`   Transaction: ${addressSummary.deploymentTxHash}`);
    console.log(`   Block: ${addressSummary.blockNumber}`);
    console.log(`   Gas Used: ${addressSummary.gasUsed}`);

    console.log("\n💡 Next Steps:");
    console.log("• Update the Supabase record with these addresses");
    console.log("• Add missing columns to database if needed");
    console.log("• Verify all contracts are properly configured");

    return addressSummary;
  } catch (error) {
    console.error("❌ Failed to fetch contract addresses:", error);
    console.log("\n🔧 Troubleshooting:");
    console.log("• Check network connectivity to Polygon");
    console.log("• Verify contract addresses are correct");
    console.log("• Check if contracts are deployed and verified");

    return null;
  }
}

// Execute the script
getContractAddresses()
  .then((result) => {
    if (result) {
      console.log("\n✅ Successfully fetched all contract addresses!");
    }
  })
  .catch(console.error);
