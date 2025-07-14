const hre = require("hardhat");

async function main() {
  console.log("🚀 Starting vAMM System Deployment...\n");

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Deploying contracts with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "ETH\n"
  );

  // Deploy MockUSDC (collateral token)
  console.log("📊 Deploying MockUSDC...");
  const MockUSDC = await hre.ethers.getContractFactory("MockUSDC");
  const initialSupply = 1000000; // 1 million USDC
  const mockUSDC = await MockUSDC.deploy(initialSupply);
  await mockUSDC.waitForDeployment();
  console.log("✅ MockUSDC deployed to:", await mockUSDC.getAddress());

  // Deploy MockPriceOracle (price oracle implementation)
  console.log("\n🔮 Deploying MockPriceOracle...");
  const MockPriceOracle = await hre.ethers.getContractFactory(
    "MockPriceOracle"
  );
  const initialPrice = hre.ethers.parseEther("2000"); // $2000 initial price (18 decimals)
  const mockOracle = await MockPriceOracle.deploy(initialPrice);
  await mockOracle.waitForDeployment();
  console.log("✅ MockPriceOracle deployed to:", await mockOracle.getAddress());
  console.log(
    "📈 Initial price set to:",
    hre.ethers.formatEther(initialPrice),
    "USD"
  );

  // Deploy vAMMFactory
  console.log("\n🏭 Deploying vAMMFactory...");
  const VAMMFactory = await hre.ethers.getContractFactory("vAMMFactory");
  const vammFactory = await VAMMFactory.deploy();
  await vammFactory.waitForDeployment();
  console.log("✅ vAMMFactory deployed to:", await vammFactory.getAddress());

  // Display deployment summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(60));
  console.log("📋 Contract Addresses:");
  console.log("   • MockUSDC:", await mockUSDC.getAddress());
  console.log("   • MockPriceOracle:", await mockOracle.getAddress());
  console.log("   • vAMMFactory:", await vammFactory.getAddress());

  console.log("\n📊 Contract Details:");
  console.log(
    "   • MockUSDC Supply:",
    (await mockUSDC.totalSupply()).toString(),
    "tokens"
  );
  console.log(
    "   • Oracle Price:",
    hre.ethers.formatEther(await mockOracle.getPrice()),
    "USD"
  );
  console.log("   • Factory Owner:", await vammFactory.owner());
  console.log(
    "   • Factory Fee:",
    hre.ethers.formatEther(await vammFactory.deploymentFee()),
    "ETH"
  );

  // Test oracle functionality
  console.log("\n🧪 Testing Oracle...");
  console.log("   • Oracle Active:", await mockOracle.isActive());
  console.log(
    "   • Max Price Age:",
    await mockOracle.getMaxPriceAge(),
    "seconds"
  );

  // Test USDC faucet
  console.log("\n💧 Testing USDC Faucet...");
  const faucetAmount = hre.ethers.parseUnits("1000", 6); // 1000 USDC
  await mockUSDC.faucet(faucetAmount);
  console.log("   • Faucet test successful - received 1000 USDC");
  console.log(
    "   • Deployer USDC balance:",
    hre.ethers.formatUnits(await mockUSDC.balanceOf(deployer.address), 6),
    "USDC"
  );

  console.log("\n🔧 Next Steps:");
  console.log("   1. To create a market, call vAMMFactory.createMarket()");
  console.log("   2. Use MockUSDC address as collateral token");
  console.log("   3. Use MockPriceOracle address as price oracle");
  console.log("   4. Markets will deploy their own vAMM and Vault contracts");

  console.log("\n📝 Sample Market Creation Parameters:");
  console.log("   • Symbol: 'ETH/USD'");
  console.log("   • Oracle:", await mockOracle.getAddress());
  console.log("   • Collateral:", await mockUSDC.getAddress());
  console.log(
    "   • Initial Price:",
    hre.ethers.formatEther(initialPrice),
    "USD"
  );
  console.log(
    "   • Deployment Fee:",
    hre.ethers.formatEther(await vammFactory.deploymentFee()),
    "ETH"
  );

  return {
    mockUSDC: await mockUSDC.getAddress(),
    mockOracle: await mockOracle.getAddress(),
    vammFactory: await vammFactory.getAddress(),
  };
}

// Handle script execution
main()
  .then((addresses) => {
    console.log("\n✨ Deployment addresses exported:", addresses);
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
