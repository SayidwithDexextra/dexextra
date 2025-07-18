const hre = require("hardhat");

async function main() {
  console.log("🔧 Step-by-Step Contract Deployment Debugging");
  console.log("=".repeat(60));

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "ETH\n"
  );

  try {
    // ===== STEP 1: Deploy MockUSDC =====
    console.log("📊 STEP 1: Deploying MockUSDC...");
    const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");

    // MockUSDC constructor: constructor(uint256 _initialSupply)
    const initialSupply = 1000000; // 1 million tokens
    console.log("   Constructor args: initialSupply =", initialSupply);

    const mockUSDC = await MockUSDC.deploy(initialSupply);
    await mockUSDC.waitForDeployment();
    const usdcAddress = await mockUSDC.getAddress();
    console.log("✅ MockUSDC deployed to:", usdcAddress);
    console.log("   Initial supply:", await mockUSDC.totalSupply());

    // ===== STEP 2: Deploy MockPriceOracle =====
    console.log("\n🔮 STEP 2: Deploying MockPriceOracle...");
    const MockPriceOracle = await hre.ethers.getContractFactory(
      "MockPriceOracle"
    );

    // MockPriceOracle constructor: constructor(uint256 _initialPrice)
    const initialPrice = hre.ethers.parseEther("2000"); // $2000
    console.log(
      "   Constructor args: initialPrice =",
      hre.ethers.formatEther(initialPrice),
      "ETH"
    );

    const mockOracle = await MockPriceOracle.deploy(initialPrice);
    await mockOracle.waitForDeployment();
    const oracleAddress = await mockOracle.getAddress();
    console.log("✅ MockPriceOracle deployed to:", oracleAddress);
    console.log(
      "   Initial price:",
      hre.ethers.formatEther(await mockOracle.getPrice()),
      "USD"
    );

    // ===== STEP 3: Deploy Vault (This is where the issue likely occurs) =====
    console.log("\n🏦 STEP 3: Deploying Vault...");
    const Vault = await hre.ethers.getContractFactory("Vault");

    // Vault constructor: constructor(address _collateralToken)
    console.log("   Constructor args: collateralToken =", usdcAddress);

    const vault = await Vault.deploy(usdcAddress);
    await vault.waitForDeployment();
    const vaultAddress = await vault.getAddress();
    console.log("✅ Vault deployed to:", vaultAddress);
    console.log("   Collateral token:", await vault.collateralToken());
    console.log("   Owner:", await vault.owner());

    // ===== STEP 4: Deploy vAMM =====
    console.log("\n📈 STEP 4: Deploying vAMM...");
    const VAMM = await hre.ethers.getContractFactory("vAMM");

    // vAMM constructor: constructor(address _vault, address _oracle, uint256 _startingPrice)
    const startingPrice = hre.ethers.parseEther("1"); // $1 starting price
    console.log("   Constructor args:");
    console.log("     vault =", vaultAddress);
    console.log("     oracle =", oracleAddress);
    console.log(
      "     startingPrice =",
      hre.ethers.formatEther(startingPrice),
      "USD"
    );

    const vamm = await VAMM.deploy(vaultAddress, oracleAddress, startingPrice);
    await vamm.waitForDeployment();
    const vammAddress = await vamm.getAddress();
    console.log("✅ vAMM deployed to:", vammAddress);
    console.log(
      "   Starting price:",
      hre.ethers.formatEther(await vamm.startingPrice()),
      "USD"
    );
    console.log(
      "   Current mark price:",
      hre.ethers.formatEther(await vamm.getMarkPrice()),
      "USD"
    );

    // ===== STEP 5: Configure Vault-vAMM Connection =====
    console.log("\n🔗 STEP 5: Configuring Vault-vAMM connection...");

    console.log("   Setting vAMM in Vault...");
    const setVammTx = await vault.setVamm(vammAddress);
    await setVammTx.wait();
    console.log("✅ Vault configured with vAMM");

    console.log("   Verifying vault connection in vAMM...");
    const vammVaultAddress = await vamm.vault();
    console.log("   vAMM vault address:", vammVaultAddress);
    console.log("   Match:", vammVaultAddress === vaultAddress ? "✅" : "❌");

    // ===== STEP 6: Test Basic Functionality =====
    console.log("\n🧪 STEP 6: Testing Basic Functionality...");

    // Test MockUSDC minting
    console.log("   Testing MockUSDC mint...");
    const mintAmount = hre.ethers.parseUnits("1000", 6); // 1000 USDC (6 decimals)
    const mintTx = await mockUSDC.mint(deployer.address, mintAmount);
    await mintTx.wait();
    const balance = await mockUSDC.balanceOf(deployer.address);
    console.log(
      "✅ Minted USDC balance:",
      hre.ethers.formatUnits(balance, 6),
      "USDC"
    );

    // Test price oracle
    console.log("   Testing price oracle update...");
    const newPrice = hre.ethers.parseEther("2100");
    const updatePriceTx = await mockOracle.setPrice(newPrice);
    await updatePriceTx.wait();
    const updatedPrice = await mockOracle.getPrice();
    console.log(
      "✅ Updated oracle price:",
      hre.ethers.formatEther(updatedPrice),
      "USD"
    );

    // ===== DEPLOYMENT SUMMARY =====
    console.log("\n" + "=".repeat(60));
    console.log("🎉 DEPLOYMENT SUCCESSFUL!");
    console.log("=".repeat(60));
    console.log("📋 Contract Addresses:");
    console.log("   • MockUSDC:", usdcAddress);
    console.log("   • MockPriceOracle:", oracleAddress);
    console.log("   • Vault:", vaultAddress);
    console.log("   • vAMM:", vammAddress);
    console.log("\n📊 Contract Status:");
    console.log(
      "   • MockUSDC Supply:",
      hre.ethers.formatUnits(await mockUSDC.totalSupply(), 6),
      "USDC"
    );
    console.log(
      "   • Oracle Price:",
      hre.ethers.formatEther(await mockOracle.getPrice()),
      "USD"
    );
    console.log(
      "   • vAMM Starting Price:",
      hre.ethers.formatEther(await vamm.startingPrice()),
      "USD"
    );
    console.log(
      "   • vAMM Current Price:",
      hre.ethers.formatEther(await vamm.getMarkPrice()),
      "USD"
    );

    return {
      mockUSDC: usdcAddress,
      mockOracle: oracleAddress,
      vault: vaultAddress,
      vamm: vammAddress,
    };
  } catch (error) {
    console.error("\n❌ DEPLOYMENT FAILED!");
    console.error("Error:", error.message);

    if (error.reason) {
      console.error("Reason:", error.reason);
    }

    if (error.transaction) {
      console.error("Transaction data:", error.transaction);
    }

    if (error.data) {
      console.error("Error data:", error.data);
    }

    throw error;
  }
}

// Run the deployment
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

module.exports = main;
