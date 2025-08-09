const { ethers } = require("hardhat");

async function main() {
  console.log("🔧 Simple Test Script for Debugging...\n");

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("📋 Using account:", await deployer.getAddress());

  // Deploy contracts
  console.log("📄 Deploying contracts...");

  const SimpleUSDC = await ethers.getContractFactory("SimpleUSDC");
  const usdc = await SimpleUSDC.deploy(1000000000);
  await usdc.waitForDeployment();
  console.log("✅ USDC:", await usdc.getAddress());

  const SimplePriceOracle = await ethers.getContractFactory(
    "SimplePriceOracle"
  );
  const oracle = await SimplePriceOracle.deploy(ethers.parseEther("1"));
  await oracle.waitForDeployment();
  console.log("✅ Oracle:", await oracle.getAddress());

  const SimpleVault = await ethers.getContractFactory("SimpleVault");
  const vault = await SimpleVault.deploy(await usdc.getAddress());
  await vault.waitForDeployment();
  console.log("✅ Vault:", await vault.getAddress());

  const SimpleVAMM = await ethers.getContractFactory("SimpleVAMM");
  const vamm = await SimpleVAMM.deploy(
    await vault.getAddress(),
    await oracle.getAddress(),
    ethers.parseEther("1")
  );
  await vamm.waitForDeployment();
  console.log("✅ VAMM:", await vamm.getAddress());

  // Configure system
  await vault.setVamm(await vamm.getAddress());
  console.log("✅ Vault configured with VAMM");

  // Mint USDC to deployer
  const mintAmount = ethers.parseUnits("100000", 6);
  await usdc.mint(await deployer.getAddress(), mintAmount);
  console.log("✅ Minted USDC to deployer");

  // Check balances
  const usdcBalance = await usdc.balanceOf(await deployer.getAddress());
  console.log("💰 USDC balance:", ethers.formatUnits(usdcBalance, 6));

  // Test deposit
  console.log("\n🔧 Testing deposit...");
  const depositAmount = ethers.parseUnits("10000", 6);

  // Check allowance first
  const allowanceBefore = await usdc.allowance(
    await deployer.getAddress(),
    await vault.getAddress()
  );
  console.log("💰 Allowance before:", ethers.formatUnits(allowanceBefore, 6));

  // Approve first
  await usdc.approve(await vault.getAddress(), depositAmount);
  console.log("✅ Approved vault to spend USDC");

  const allowanceAfter = await usdc.allowance(
    await deployer.getAddress(),
    await vault.getAddress()
  );
  console.log("💰 Allowance after:", ethers.formatUnits(allowanceAfter, 6));

  const balanceBefore = await usdc.balanceOf(await deployer.getAddress());
  console.log(
    "💰 User balance before deposit:",
    ethers.formatUnits(balanceBefore, 6)
  );

  const vaultBalanceBefore = await usdc.balanceOf(await vault.getAddress());
  console.log(
    "💰 Vault balance before deposit:",
    ethers.formatUnits(vaultBalanceBefore, 6)
  );

  // Deposit
  try {
    const tx = await vault.depositCollateral(
      await deployer.getAddress(),
      depositAmount
    );
    await tx.wait();
    console.log("✅ Deposited collateral");
  } catch (error) {
    console.log("❌ Deposit failed:", error.message);
    return;
  }

  const balanceAfter = await usdc.balanceOf(await deployer.getAddress());
  console.log(
    "💰 User balance after deposit:",
    ethers.formatUnits(balanceAfter, 6)
  );

  const vaultBalanceAfter = await usdc.balanceOf(await vault.getAddress());
  console.log(
    "💰 Vault balance after deposit:",
    ethers.formatUnits(vaultBalanceAfter, 6)
  );

  // Check vault state
  const collateralBalance = await vault.getCollateralBalance(
    await deployer.getAddress()
  );
  const availableMargin = await vault.getAvailableMargin(
    await deployer.getAddress()
  );
  console.log(
    "💰 Collateral in vault:",
    ethers.formatUnits(collateralBalance, 6)
  );
  console.log("💰 Available margin:", ethers.formatUnits(availableMargin, 6));

  // Test position opening
  console.log("\n🔧 Testing position opening...");
  const positionCollateral = ethers.parseUnits("1000", 6);
  const leverage = 2;
  const minPrice = 0;
  const maxPrice = ethers.parseEther("10");

  try {
    const tx = await vamm.openPosition(
      positionCollateral,
      true, // long
      leverage,
      minPrice,
      maxPrice
    );
    await tx.wait();
    console.log("✅ Position opened successfully!");

    const newPrice = await vamm.getMarkPrice();
    console.log("💰 New price:", ethers.formatEther(newPrice));
  } catch (error) {
    console.log("❌ Position opening failed:", error.message);
  }
}

main()
  .then(() => {
    console.log("\n✅ Test completed!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Test failed:", error);
    process.exit(1);
  });
