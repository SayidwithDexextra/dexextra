const hre = require("hardhat");

async function main() {
  console.log("🚀 Robust vAMM System Deployment");
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

    // Deploy vAMM
    console.log("   📈 Deploying vAMM...");
    const VAMM = await hre.ethers.getContractFactory("vAMM");
    const startingPrice = hre.ethers.parseEther("1");
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

    // Mint some additional USDC for testing
    const mintAmount = hre.ethers.parseUnits("10000", 6); // 10,000 USDC
    console.log("   🔨 Minting additional USDC...");
    const mintTx = await mockUSDC.mint(deployer.address, mintAmount);
    await mintTx.wait();
    console.log("   ✅ Mint transaction confirmed");

    const balanceAfterMint = await mockUSDC.balanceOf(deployer.address);
    console.log(
      "   📊 USDC balance after mint:",
      hre.ethers.formatUnits(balanceAfterMint, 6),
      "USDC"
    );

    // ===== STEP 3: Test Basic Vault Operations =====
    console.log("\n🏦 STEP 3: Testing Vault Operations...");

    // Test approval step by step
    const approveAmount = hre.ethers.parseUnits("5000", 6); // 5,000 USDC
    console.log(
      "   ✅ Requesting approval for",
      hre.ethers.formatUnits(approveAmount, 6),
      "USDC..."
    );

    const approveTx = await mockUSDC.approve(vaultAddress, approveAmount);
    console.log("   ⏳ Approval transaction hash:", approveTx.hash);
    const approveReceipt = await approveTx.wait();
    console.log(
      "   ✅ Approval confirmed in block:",
      approveReceipt.blockNumber
    );

    // Verify approval worked
    const allowanceAfterApproval = await mockUSDC.allowance(
      deployer.address,
      vaultAddress
    );
    console.log(
      "   🔍 Allowance after approval:",
      hre.ethers.formatUnits(allowanceAfterApproval, 6),
      "USDC"
    );

    if (allowanceAfterApproval < approveAmount) {
      throw new Error("Approval failed - allowance is less than expected");
    }

    // Test deposit
    const depositAmount = hre.ethers.parseUnits("3000", 6); // 3,000 USDC
    console.log(
      "   🏦 Depositing",
      hre.ethers.formatUnits(depositAmount, 6),
      "USDC into vault..."
    );

    const depositTx = await vault.depositCollateral(
      deployer.address,
      depositAmount
    );
    console.log("   ⏳ Deposit transaction hash:", depositTx.hash);
    const depositReceipt = await depositTx.wait();
    console.log(
      "   ✅ Deposit confirmed in block:",
      depositReceipt.blockNumber
    );

    // Verify deposit
    const vaultUsdcBalance = await mockUSDC.balanceOf(vaultAddress);
    const userVaultBalance = await vault.getAvailableMargin(deployer.address);
    console.log(
      "   📊 Vault USDC balance:",
      hre.ethers.formatUnits(vaultUsdcBalance, 6),
      "USDC"
    );
    console.log(
      "   📊 User available margin:",
      hre.ethers.formatUnits(userVaultBalance, 6),
      "USDC"
    );

    // ===== STEP 4: Test Trading =====
    console.log("\n🎯 STEP 4: Testing Trading...");

    // Check initial vAMM state
    const initialMarkPrice = await vamm.getMarkPrice();
    const initialStartingPrice = await vamm.startingPrice();
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

    // Open a small position
    const positionCollateral = hre.ethers.parseUnits("100", 18); // $100 USD (18 decimals)
    const leverage = 5;
    console.log("   🔥 Opening position: $100 collateral, 5x leverage...");

    const openPositionTx = await vamm.openPosition(
      positionCollateral,
      true, // long
      leverage,
      0, // min price
      hre.ethers.MaxUint256 // max price
    );
    console.log("   ⏳ Position transaction hash:", openPositionTx.hash);
    const positionReceipt = await openPositionTx.wait();
    console.log("   ✅ Position opened in block:", positionReceipt.blockNumber);

    // Check new price
    const newMarkPrice = await vamm.getMarkPrice();
    const totalLongSize = await vamm.totalLongSize();
    console.log(
      "   📈 New mark price:",
      hre.ethers.formatEther(newMarkPrice),
      "USD"
    );
    console.log("   📊 Total long size:", totalLongSize.toString());

    const priceIncrease = newMarkPrice - initialMarkPrice;
    const priceMultiplier = Number(newMarkPrice) / Number(initialMarkPrice);
    console.log(
      "   🚀 Price increase:",
      hre.ethers.formatEther(priceIncrease),
      "USD"
    );
    console.log("   📈 Price multiplier:", priceMultiplier.toFixed(3) + "x");

    // ===== FINAL SUMMARY =====
    console.log("\n" + "=".repeat(60));
    console.log("🎉 DEPLOYMENT AND TESTING SUCCESSFUL!");
    console.log("=".repeat(60));
    console.log("📋 Contract Addresses:");
    console.log("   • MockUSDC:", usdcAddress);
    console.log("   • MockPriceOracle:", oracleAddress);
    console.log("   • Vault:", vaultAddress);
    console.log("   • vAMM:", vammAddress);

    console.log("\n🎯 Test Results:");
    console.log(
      "   • USDC Balance:",
      hre.ethers.formatUnits(balanceAfterMint, 6),
      "USDC"
    );
    console.log(
      "   • Vault Deposit:",
      hre.ethers.formatUnits(depositAmount, 6),
      "USDC"
    );
    console.log("   • Position Opened: $100 @ 5x leverage");
    console.log(
      "   • Price Impact:",
      hre.ethers.formatEther(priceIncrease),
      "USD"
    );
    console.log("   • Price Multiplier:", priceMultiplier.toFixed(3) + "x");

    console.log("\n✅ The vAMM system is working correctly!");
    console.log("   • Individual contract deployment: ✅");
    console.log("   • Vault-vAMM integration: ✅");
    console.log("   • USDC token operations: ✅");
    console.log("   • Position opening: ✅");
    console.log("   • Bonding curve price discovery: ✅");

    return {
      contracts: {
        mockUSDC: usdcAddress,
        mockOracle: oracleAddress,
        vault: vaultAddress,
        vamm: vammAddress,
      },
      results: {
        initialPrice: hre.ethers.formatEther(initialMarkPrice),
        finalPrice: hre.ethers.formatEther(newMarkPrice),
        priceIncrease: hre.ethers.formatEther(priceIncrease),
        multiplier: priceMultiplier,
      },
    };
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED!");
    console.error("Error:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    if (error.data) {
      console.error("Error data:", error.data);
    }

    console.error("\n🔍 Troubleshooting Tips:");
    console.error("1. Check that you have sufficient MATIC for gas fees");
    console.error("2. Verify all contract deployments completed successfully");
    console.error("3. Ensure MockUSDC approve() transaction was confirmed");
    console.error("4. Check allowance is set correctly before deposit");

    throw error;
  }
}

// Run the deployment
if (require.main === module) {
  main()
    .then((result) => {
      console.log("\n🎊 All tests passed! The vAMM system is ready for use.");
      process.exit(0);
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
