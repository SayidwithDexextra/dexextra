const hre = require("hardhat");

async function main() {
  console.log("🚀 Complete vAMM Deployment & Trading Demo");
  console.log("=".repeat(60));

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "MATIC\n"
  );

  try {
    // ===== STEP 1: Deploy Core Contracts =====
    console.log("📦 STEP 1: Deploying Core Contracts...");

    // Deploy MockUSDC
    console.log("   📊 Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const initialSupply = 1000000; // 1 million tokens
    const mockUSDC = await MockUSDC.deploy(initialSupply);
    await mockUSDC.waitForDeployment();
    const usdcAddress = await mockUSDC.getAddress();
    console.log("   ✅ MockUSDC deployed to:", usdcAddress);

    // Deploy MockPriceOracle
    console.log("   🔮 Deploying MockPriceOracle...");
    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const initialPrice = hre.ethers.parseEther("2000"); // $2000 reference price
    const mockOracle = await MockPriceOracle.deploy(initialPrice);
    await mockOracle.waitForDeployment();
    const oracleAddress = await mockOracle.getAddress();
    console.log("   ✅ MockPriceOracle deployed to:", oracleAddress);

    // Deploy Vault
    console.log("   🏦 Deploying Vault...");
    const Vault = await hre.ethers.getContractFactory("Vault");
    const vault = await Vault.deploy(usdcAddress);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("   ✅ Vault deployed to:", vaultAddress);

    // Deploy vAMM with bonding curve starting at $1
    console.log("   📈 Deploying Bonding Curve vAMM...");
    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const startingPrice = hre.ethers.parseEther("1"); // $1 starting price
    const vamm = await VAMM.deploy(vaultAddress, oracleAddress, startingPrice);
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();
    console.log("   ✅ vAMM deployed to:", vammAddress);

    // Configure vault-vAMM connection
    console.log("   🔗 Configuring vault-vAMM connection...");
    await vault.setVamm(vammAddress);
    console.log("   ✅ Vault configured with vAMM");

    // ===== STEP 2: Prepare Trading Environment =====
    console.log("\n💰 STEP 2: Preparing Trading Environment...");

    // Mint USDC for trading
    const tradingAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
    await mockUSDC.mint(deployer.address, tradingAmount);
    const balance = await mockUSDC.balanceOf(deployer.address);
    console.log(
      "   📊 USDC Balance:",
      hre.ethers.formatUnits(balance, 6),
      "USDC"
    );

    // Approve vault to spend USDC
    const approvalAmount = hre.ethers.parseUnits("10000", 6);
    await mockUSDC.approve(vaultAddress, approvalAmount);
    console.log(
      "   ✅ Approved Vault to spend",
      hre.ethers.formatUnits(approvalAmount, 6),
      "USDC"
    );

    // Deposit collateral into vault
    const depositAmount = hre.ethers.parseUnits("5000", 6); // 5,000 USDC
    await vault.depositCollateral(deployer.address, depositAmount);
    console.log(
      "   🏦 Deposited",
      hre.ethers.formatUnits(depositAmount, 6),
      "USDC into Vault"
    );

    // ===== STEP 3: Display Initial State =====
    console.log("\n📊 STEP 3: Initial Market State...");
    const initialMarkPrice = await vamm.getMarkPrice();
    const totalLongSize = await vamm.totalLongSize();
    const totalShortSize = await vamm.totalShortSize();

    console.log(
      "   💎 Starting Price:",
      hre.ethers.formatEther(await vamm.startingPrice()),
      "USD"
    );
    console.log(
      "   📈 Current Mark Price:",
      hre.ethers.formatEther(initialMarkPrice),
      "USD"
    );
    console.log("   📊 Total Long Size:", totalLongSize.toString());
    console.log("   📊 Total Short Size:", totalShortSize.toString());

    // ===== STEP 4: Demonstrate Bonding Curve Trading =====
    console.log("\n🎯 STEP 4: Bonding Curve Trading Demo...");

    // Position 1: Small long position ($100, 5x leverage)
    console.log("\n   🔥 Opening Position 1: Small Long ($100, 5x leverage)");
    const collateral1 = hre.ethers.parseUnits("100", 18); // $100 collateral
    const leverage1 = 5;
    const minPrice = 0;
    const maxPrice = hre.ethers.MaxUint256;

    const position1Tx = await vamm.openPosition(
      collateral1,
      true, // long
      leverage1,
      minPrice,
      maxPrice
    );
    await position1Tx.wait();

    const newMarkPrice1 = await vamm.getMarkPrice();
    const newLongSize1 = await vamm.totalLongSize();
    console.log(
      "   📈 New Mark Price:",
      hre.ethers.formatEther(newMarkPrice1),
      "USD"
    );
    console.log("   📊 New Long Size:", newLongSize1.toString());
    console.log(
      "   🚀 Price Impact:",
      hre.ethers.formatEther(newMarkPrice1 - initialMarkPrice),
      "USD"
    );

    // Position 2: Medium long position ($500, 10x leverage)
    console.log("\n   🔥 Opening Position 2: Medium Long ($500, 10x leverage)");
    const collateral2 = hre.ethers.parseUnits("500", 18); // $500 collateral
    const leverage2 = 10;

    const position2Tx = await vamm.openPosition(
      collateral2,
      true, // long
      leverage2,
      minPrice,
      maxPrice
    );
    await position2Tx.wait();

    const newMarkPrice2 = await vamm.getMarkPrice();
    const newLongSize2 = await vamm.totalLongSize();
    console.log(
      "   📈 New Mark Price:",
      hre.ethers.formatEther(newMarkPrice2),
      "USD"
    );
    console.log("   📊 New Long Size:", newLongSize2.toString());
    console.log(
      "   🚀 Price Impact:",
      hre.ethers.formatEther(newMarkPrice2 - newMarkPrice1),
      "USD"
    );

    // Position 3: Large long position ($1000, 20x leverage)
    console.log("\n   🔥 Opening Position 3: Large Long ($1000, 20x leverage)");
    const collateral3 = hre.ethers.parseUnits("1000", 18); // $1000 collateral
    const leverage3 = 20;

    const position3Tx = await vamm.openPosition(
      collateral3,
      true, // long
      leverage3,
      minPrice,
      maxPrice
    );
    await position3Tx.wait();

    const finalMarkPrice = await vamm.getMarkPrice();
    const finalLongSize = await vamm.totalLongSize();
    console.log(
      "   📈 Final Mark Price:",
      hre.ethers.formatEther(finalMarkPrice),
      "USD"
    );
    console.log("   📊 Final Long Size:", finalLongSize.toString());
    console.log(
      "   🚀 Price Impact:",
      hre.ethers.formatEther(finalMarkPrice - newMarkPrice2),
      "USD"
    );

    // ===== STEP 5: Demonstrate Progressive Difficulty =====
    console.log("\n📈 STEP 5: Bonding Curve Analysis...");

    const totalPriceIncrease = finalMarkPrice - initialMarkPrice;
    const priceMultiplier = Number(finalMarkPrice) / Number(initialMarkPrice);

    console.log("   🎯 Bonding Curve Results:");
    console.log(
      "   • Starting Price:",
      hre.ethers.formatEther(initialMarkPrice),
      "USD"
    );
    console.log(
      "   • Final Price:",
      hre.ethers.formatEther(finalMarkPrice),
      "USD"
    );
    console.log(
      "   • Total Increase:",
      hre.ethers.formatEther(totalPriceIncrease),
      "USD"
    );
    console.log("   • Price Multiplier:", priceMultiplier.toFixed(2) + "x");
    console.log(
      "   • Total Volume:",
      hre.ethers.formatEther(finalLongSize),
      "USD"
    );

    // ===== STEP 6: Test Price Oracle Update =====
    console.log("\n🔮 STEP 6: Testing Price Oracle...");
    const currentOraclePrice = await mockOracle.getPrice();
    console.log(
      "   📊 Current Oracle Price:",
      hre.ethers.formatEther(currentOraclePrice),
      "USD"
    );

    const newOraclePrice = hre.ethers.parseEther("2100"); // $2100
    await mockOracle.updatePrice(newOraclePrice);
    const updatedOraclePrice = await mockOracle.getPrice();
    console.log(
      "   📈 Updated Oracle Price:",
      hre.ethers.formatEther(updatedOraclePrice),
      "USD"
    );

    // ===== DEPLOYMENT SUMMARY =====
    console.log("\n" + "=".repeat(60));
    console.log("🎉 DEPLOYMENT & TRADING DEMO COMPLETE!");
    console.log("=".repeat(60));
    console.log("📋 Contract Addresses:");
    console.log("   • MockUSDC:", usdcAddress);
    console.log("   • MockPriceOracle:", oracleAddress);
    console.log("   • Vault:", vaultAddress);
    console.log("   • Bonding Curve vAMM:", vammAddress);

    console.log("\n🎯 Trading Results:");
    console.log("   • Positions Opened: 3");
    console.log(
      "   • Total Volume:",
      hre.ethers.formatEther(finalLongSize),
      "USD"
    );
    console.log(
      "   • Price Pump:",
      hre.ethers.formatEther(initialMarkPrice),
      "→",
      hre.ethers.formatEther(finalMarkPrice),
      "USD"
    );
    console.log("   • Multiplier:", priceMultiplier.toFixed(2) + "x");

    console.log("\n💡 Next Steps:");
    console.log("   • Use these contracts for further testing");
    console.log("   • Open more positions to see progressive difficulty");
    console.log("   • Test short positions to see price decrease");
    console.log("   • Test position closing and PnL calculations");

    return {
      mockUSDC: usdcAddress,
      mockOracle: oracleAddress,
      vault: vaultAddress,
      vamm: vammAddress,
      results: {
        startPrice: hre.ethers.formatEther(initialMarkPrice),
        finalPrice: hre.ethers.formatEther(finalMarkPrice),
        multiplier: priceMultiplier,
        volume: hre.ethers.formatEther(finalLongSize),
      },
    };
  } catch (error) {
    console.error("\n❌ DEPLOYMENT/TRADING FAILED!");
    console.error("Error:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    if (error.data) {
      console.error("Error data:", error.data);
    }

    throw error;
  }
}

// Run the deployment and trading demo
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
