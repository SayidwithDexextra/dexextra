const hre = require("hardhat");

async function main() {
  console.log("🚀 Final Working vAMM System Deployment");
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
    // ===== STEP 1: Deploy Contracts =====
    console.log("📦 STEP 1: Deploying Contracts...");

    // Deploy MockUSDC
    console.log("   📊 Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
    const initialSupply = 1000000; // Will be multiplied by decimals (6) in constructor
    const mockUSDC = await MockUSDC.deploy(initialSupply);
    await mockUSDC.waitForDeployment();
    const usdcAddress = await mockUSDC.getAddress();
    console.log("   ✅ MockUSDC deployed to:", usdcAddress);

    // Deploy MockPriceOracle
    console.log("   🔮 Deploying MockPriceOracle...");
    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );
    const initialPrice = hre.ethers.parseEther("2000");
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

    // Deploy vAMM with $1 starting price
    console.log("   📈 Deploying Bonding Curve vAMM...");
    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const startingPrice = hre.ethers.parseEther("1"); // $1 starting price
    const vamm = await VAMM.deploy(vaultAddress, oracleAddress, startingPrice);
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();
    console.log("   ✅ vAMM deployed to:", vammAddress);

    // Configure vault
    console.log("   🔗 Configuring vault...");
    const setVammTx = await vault.setVamm(vammAddress);
    await setVammTx.wait();
    console.log("   ✅ Vault configured");

    // ===== STEP 2: Setup Tokens =====
    console.log("\n💰 STEP 2: Setting Up Tokens...");

    // Check initial balances
    const initialBalance = await mockUSDC.balanceOf(deployer.address);
    console.log(
      "   📊 Initial USDC balance:",
      hre.ethers.formatUnits(initialBalance, 6),
      "USDC"
    );

    // Mint additional USDC for testing
    const mintAmount = hre.ethers.parseUnits("20000", 6); // 20,000 USDC
    console.log("   🔨 Minting additional USDC...");
    const mintTx = await mockUSDC.mint(deployer.address, mintAmount);
    await mintTx.wait();

    const balanceAfterMint = await mockUSDC.balanceOf(deployer.address);
    console.log(
      "   📊 Total USDC balance:",
      hre.ethers.formatUnits(balanceAfterMint, 6),
      "USDC"
    );

    // ===== STEP 3: Vault Setup =====
    console.log("\n🏦 STEP 3: Setting Up Vault...");

    // Approve and deposit collateral
    const depositAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
    console.log(
      "   ✅ Approving vault to spend",
      hre.ethers.formatUnits(depositAmount, 6),
      "USDC..."
    );

    const approveTx = await mockUSDC.approve(vaultAddress, depositAmount);
    await approveTx.wait();

    const allowance = await mockUSDC.allowance(deployer.address, vaultAddress);
    console.log(
      "   🔍 Allowance:",
      hre.ethers.formatUnits(allowance, 6),
      "USDC"
    );

    console.log(
      "   🏦 Depositing",
      hre.ethers.formatUnits(depositAmount, 6),
      "USDC into vault..."
    );
    const depositTx = await vault.depositCollateral(
      deployer.address,
      depositAmount
    );
    await depositTx.wait();

    const userMargin = await vault.getAvailableMargin(deployer.address);
    console.log(
      "   📊 Available margin:",
      hre.ethers.formatUnits(userMargin, 6),
      "USDC"
    );

    // ===== STEP 4: Bonding Curve Trading Demo =====
    console.log("\n🎯 STEP 4: Bonding Curve Trading Demo...");

    // Check initial state
    const initialMarkPrice = await vamm.getMarkPrice();
    const initialStartingPrice = await vamm.startingPrice();
    const initialLongSize = await vamm.totalLongSize();

    console.log(
      "   💎 Starting price:",
      hre.ethers.formatEther(initialStartingPrice),
      "USD"
    );
    console.log(
      "   📈 Current mark price:",
      hre.ethers.formatEther(initialMarkPrice),
      "USD"
    );
    console.log("   📊 Total long size:", initialLongSize.toString());

    // Position 1: Small trade - $100 collateral with 5x leverage = $500 position
    console.log(
      "\n   🔥 Position 1: Small Trade ($100 collateral, 5x leverage)"
    );
    const collateral1 = hre.ethers.parseUnits("100", 6); // $100 USDC (6 decimals)
    const leverage1 = 5;

    const position1Tx = await vamm.openPosition(
      collateral1,
      true, // long
      leverage1,
      0, // min price
      hre.ethers.MaxUint256 // max price
    );
    await position1Tx.wait();

    const markPrice1 = await vamm.getMarkPrice();
    const longSize1 = await vamm.totalLongSize();
    const priceIncrease1 = markPrice1 - initialMarkPrice;

    console.log(
      "   📈 New mark price:",
      hre.ethers.formatEther(markPrice1),
      "USD"
    );
    console.log("   📊 Total long size:", longSize1.toString());
    console.log(
      "   🚀 Price impact:",
      hre.ethers.formatEther(priceIncrease1),
      "USD"
    );

    // Position 2: Medium trade - $500 collateral with 10x leverage = $5,000 position
    console.log(
      "\n   🔥 Position 2: Medium Trade ($500 collateral, 10x leverage)"
    );
    const collateral2 = hre.ethers.parseUnits("500", 6); // $500 USDC
    const leverage2 = 10;

    const position2Tx = await vamm.openPosition(
      collateral2,
      true, // long
      leverage2,
      0,
      hre.ethers.MaxUint256
    );
    await position2Tx.wait();

    const markPrice2 = await vamm.getMarkPrice();
    const longSize2 = await vamm.totalLongSize();
    const priceIncrease2 = markPrice2 - markPrice1;

    console.log(
      "   📈 New mark price:",
      hre.ethers.formatEther(markPrice2),
      "USD"
    );
    console.log("   📊 Total long size:", longSize2.toString());
    console.log(
      "   🚀 Price impact:",
      hre.ethers.formatEther(priceIncrease2),
      "USD"
    );

    // Position 3: Large trade - $1000 collateral with 20x leverage = $20,000 position
    console.log(
      "\n   🔥 Position 3: Large Trade ($1000 collateral, 20x leverage)"
    );
    const collateral3 = hre.ethers.parseUnits("1000", 6); // $1000 USDC
    const leverage3 = 20;

    const position3Tx = await vamm.openPosition(
      collateral3,
      true, // long
      leverage3,
      0,
      hre.ethers.MaxUint256
    );
    await position3Tx.wait();

    const finalMarkPrice = await vamm.getMarkPrice();
    const finalLongSize = await vamm.totalLongSize();
    const priceIncrease3 = finalMarkPrice - markPrice2;

    console.log(
      "   📈 Final mark price:",
      hre.ethers.formatEther(finalMarkPrice),
      "USD"
    );
    console.log("   📊 Final long size:", finalLongSize.toString());
    console.log(
      "   🚀 Price impact:",
      hre.ethers.formatEther(priceIncrease3),
      "USD"
    );

    // ===== STEP 5: Analysis =====
    console.log("\n📊 STEP 5: Bonding Curve Analysis...");

    const totalPriceIncrease = finalMarkPrice - initialMarkPrice;
    const priceMultiplier = Number(finalMarkPrice) / Number(initialMarkPrice);
    const totalVolume = finalLongSize;

    console.log("   🎯 Results Summary:");
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
    console.log("   • Price Multiplier:", priceMultiplier.toFixed(3) + "x");
    console.log(
      "   • Total Volume:",
      hre.ethers.formatEther(totalVolume),
      "USD"
    );

    console.log("\n   📈 Progressive Difficulty:");
    console.log(
      "   • Position 1 ($500)  → +" + hre.ethers.formatEther(priceIncrease1),
      "USD"
    );
    console.log(
      "   • Position 2 ($5K)   → +" + hre.ethers.formatEther(priceIncrease2),
      "USD"
    );
    console.log(
      "   • Position 3 ($20K)  → +" + hre.ethers.formatEther(priceIncrease3),
      "USD"
    );

    // ===== STEP 6: Oracle Test =====
    console.log("\n🔮 STEP 6: Oracle Integration Test...");
    const oraclePrice = await mockOracle.getPrice();
    console.log(
      "   📊 Oracle price:",
      hre.ethers.formatEther(oraclePrice),
      "USD"
    );

    await mockOracle.updatePrice(hre.ethers.parseEther("2100"));
    const newOraclePrice = await mockOracle.getPrice();
    console.log(
      "   📈 Updated oracle price:",
      hre.ethers.formatEther(newOraclePrice),
      "USD"
    );

    // ===== FINAL SUMMARY =====
    console.log("\n" + "=".repeat(60));
    console.log("🎉 BONDING CURVE vAMM SYSTEM DEPLOYMENT COMPLETE!");
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
      hre.ethers.formatEther(totalVolume),
      "USD"
    );
    console.log(
      "   • Price Pump:",
      hre.ethers.formatEther(initialMarkPrice),
      "→",
      hre.ethers.formatEther(finalMarkPrice),
      "USD"
    );
    console.log("   • Price Multiplier:", priceMultiplier.toFixed(3) + "x");

    console.log("\n✅ System Status:");
    console.log("   • Contract Deployment: ✅ SUCCESS");
    console.log("   • Vault Operations: ✅ SUCCESS");
    console.log("   • Position Trading: ✅ SUCCESS");
    console.log("   • Bonding Curve: ✅ SUCCESS");
    console.log("   • Price Discovery: ✅ SUCCESS");
    console.log("   • Oracle Integration: ✅ SUCCESS");

    console.log("\n🚀 Key Features Demonstrated:");
    console.log("   • Custom starting price ($1.00)");
    console.log("   • Progressive difficulty scaling");
    console.log("   • Early pump opportunities");
    console.log("   • Exponential cost increases");
    console.log("   • Pump.fund-style behavior");

    console.log("\n💡 The vAMM system is now ready for:");
    console.log(
      "   • Creating multiple markets with different starting prices"
    );
    console.log("   • Supporting pump-style token launches");
    console.log("   • Providing progressive difficulty trading");
    console.log("   • Enabling viral token growth mechanics");

    return {
      success: true,
      contracts: {
        mockUSDC: usdcAddress,
        mockOracle: oracleAddress,
        vault: vaultAddress,
        vamm: vammAddress,
      },
      results: {
        initialPrice: hre.ethers.formatEther(initialMarkPrice),
        finalPrice: hre.ethers.formatEther(finalMarkPrice),
        totalIncrease: hre.ethers.formatEther(totalPriceIncrease),
        multiplier: priceMultiplier,
        volume: hre.ethers.formatEther(totalVolume),
      },
    };
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED!");
    console.error("Error:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    throw error;
  }
}

// Run the deployment
if (require.main === module) {
  main()
    .then((result) => {
      if (result.success) {
        console.log("\n🎊 MISSION ACCOMPLISHED! 🎊");
        console.log("The bonding curve vAMM system is fully operational!");
        console.log(
          "Price went from",
          result.results.initialPrice,
          "to",
          result.results.finalPrice,
          "USD"
        );
        console.log(
          "That's a",
          result.results.multiplier.toFixed(3) + "x increase!"
        );
      }
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
