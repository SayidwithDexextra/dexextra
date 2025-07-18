const { ethers } = require("hardhat");

async function main() {
  console.log("🚀 Deploying SimpleVAMM System to Polygon Mainnet...\n");

  // Get deployer account
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  const deployerBalance = await deployer.provider.getBalance(deployerAddress);

  console.log("📋 Deploying with account:", deployerAddress);
  console.log(
    "💰 Account balance:",
    ethers.formatEther(deployerBalance),
    "MATIC"
  );

  // Check if we have enough MATIC for deployment (estimate ~0.1 MATIC needed)
  const minBalance = ethers.parseEther("0.1");
  if (deployerBalance < minBalance) {
    throw new Error(
      `Insufficient MATIC balance. Need at least 0.1 MATIC, have ${ethers.formatEther(
        deployerBalance
      )}`
    );
  }

  console.log("✅ Sufficient balance for deployment\n");

  // =================================
  // 1. DEPLOY SIMPLE USDC TOKEN
  // =================================
  console.log("📄 1. Deploying SimpleUSDC...");
  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");

  // Deploy with initial supply of 1B USDC for mainnet
  const initialSupply = 1000000000; // 1 billion USDC
  const usdc = await SimpleUSDC.deploy(initialSupply);
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();

  console.log("✅ SimpleUSDC deployed to:", usdcAddress);
  console.log("💰 Initial supply:", initialSupply.toLocaleString(), "USDC");

  // =================================
  // 2. DEPLOY SIMPLE PRICE ORACLE
  // =================================
  console.log("\n📄 2. Deploying SimplePriceOracle...");
  const initialPrice = ethers.parseEther("100"); // $100 starting price
  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = await SimplePriceOracle.deploy(initialPrice);
  await oracle.waitForDeployment();
  const oracleAddress = await oracle.getAddress();

  console.log("✅ SimplePriceOracle deployed to:", oracleAddress);
  console.log("💰 Initial price: $100");

  // =================================
  // 3. DEPLOY SIMPLE VAULT
  // =================================
  console.log("\n📄 3. Deploying SimpleVault...");
  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = await SimpleVault.deploy(usdcAddress);
  await vault.waitForDeployment();
  const vaultAddress = await vault.getAddress();

  console.log("✅ SimpleVault deployed to:", vaultAddress);

  // =================================
  // 4. DEPLOY SIMPLE VAMM
  // =================================
  console.log("\n📄 4. Deploying SimpleVAMM...");
  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = await SimpleVAMM.deploy(
    vaultAddress,
    oracleAddress,
    initialPrice
  );
  await vamm.waitForDeployment();
  const vammAddress = await vamm.getAddress();

  console.log("✅ SimpleVAMM deployed to:", vammAddress);

  // =================================
  // 5. CONFIGURE SYSTEM
  // =================================
  console.log("\n⚙️  5. Configuring system...");

  // Set VAMM in vault
  const setVammTx = await vault.setVamm(vammAddress);
  await setVammTx.wait();
  console.log("✅ Vault configured with VAMM address");

  // =================================
  // 6. VERIFY DEPLOYMENT
  // =================================
  console.log("\n🔍 6. Verifying deployment...");

  try {
    // Test all contract interactions
    const markPrice = await vamm.getMarkPrice();
    const vaultCollateralToken = await vault.collateralToken();
    const oraclePrice = await oracle.getPrice();
    const usdcTotalSupply = await usdc.totalSupply();

    console.log("✅ Mark Price:", ethers.formatEther(markPrice), "USD");
    console.log("✅ Vault collateral token:", vaultCollateralToken);
    console.log("✅ Oracle price:", ethers.formatEther(oraclePrice), "USD");
    console.log(
      "✅ USDC total supply:",
      ethers.formatUnits(usdcTotalSupply, 6),
      "USDC"
    );

    // Verify addresses match
    if (vaultCollateralToken !== usdcAddress) {
      throw new Error("Vault collateral token mismatch");
    }

    console.log("🎉 All contracts verified and working correctly!");
  } catch (error) {
    console.error("❌ Verification failed:", error);
    throw error;
  }

  // =================================
  // 7. DEPLOYMENT SUMMARY
  // =================================
  console.log("\n🎉 Deployment Summary:");
  console.log("=======================================");
  console.log("📄 SimpleUSDC:", usdcAddress);
  console.log("🔮 SimplePriceOracle:", oracleAddress);
  console.log("🏦 SimpleVault:", vaultAddress);
  console.log("📊 SimpleVAMM:", vammAddress);
  console.log("\n🌐 Network: Polygon Mainnet");
  console.log("👤 Deployer:", deployerAddress);
  console.log(
    "💰 Remaining balance:",
    ethers.formatEther(await deployer.provider.getBalance(deployerAddress)),
    "MATIC"
  );

  // =================================
  // 8. SAVE TO SUPABASE PREPARATION
  // =================================
  const deploymentData = {
    network: "polygon",
    chainId: 137,
    deployer: deployerAddress,
    contracts: {
      SimpleUSDC: usdcAddress,
      SimplePriceOracle: oracleAddress,
      SimpleVault: vaultAddress,
      SimpleVAMM: vammAddress,
    },
    deploymentTime: new Date().toISOString(),
    initialPrice: "100",
    initialSupply: initialSupply.toString(),
    txHashes: {
      usdc: usdc.deploymentTransaction()?.hash,
      oracle: oracle.deploymentTransaction()?.hash,
      vault: vault.deploymentTransaction()?.hash,
      vamm: vamm.deploymentTransaction()?.hash,
    },
  };

  console.log("\n📝 Deployment data prepared for Supabase:");
  console.log(JSON.stringify(deploymentData, null, 2));

  // =================================
  // 9. NEXT STEPS
  // =================================
  console.log("\n📋 Next Steps:");
  console.log("1. Update src/lib/networks.ts with new contract addresses");
  console.log("2. Save deployment data to Supabase");
  console.log("3. Verify contracts on Polygonscan");
  console.log("4. Test frontend integration");
  console.log("5. Update environment variables");

  return deploymentData;
}

// Handle both direct execution and module exports
if (require.main === module) {
  main()
    .then((data) => {
      console.log("\n✅ Deployment completed successfully!");
      console.log("📋 Contract addresses saved for next steps");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Deployment failed:", error);
      process.exit(1);
    });
}

module.exports = main;
