const hre = require("hardhat");

async function main() {
  console.log("🏪 Creating Sample vAMM Market...\n");

  // Contract addresses from deployment
  const addresses = {
    mockUSDC: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
    mockOracle: "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    vammFactory: "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
  };

  // Get deployer account
  const [deployer] = await hre.ethers.getSigners();
  console.log("👤 Creating market with account:", deployer.address);
  console.log(
    "💰 Account balance:",
    hre.ethers.formatEther(
      await deployer.provider.getBalance(deployer.address)
    ),
    "ETH\n"
  );

  // Get contract instances
  const vammFactory = await hre.ethers.getContractAt(
    "vAMMFactory",
    addresses.vammFactory
  );
  const mockOracle = await hre.ethers.getContractAt(
    "MockPriceOracle",
    addresses.mockOracle
  );
  const mockUSDC = await hre.ethers.getContractAt(
    "MockUSDC",
    addresses.mockUSDC
  );

  // Market parameters
  const marketParams = {
    symbol: "ETH/USD",
    oracle: addresses.mockOracle,
    collateralToken: addresses.mockUSDC,
    initialPrice: hre.ethers.parseEther("2000"), // $2000 USD
  };

  console.log("📊 Market Parameters:");
  console.log("   • Symbol:", marketParams.symbol);
  console.log("   • Oracle:", marketParams.oracle);
  console.log("   • Collateral:", marketParams.collateralToken);
  console.log(
    "   • Initial Price:",
    hre.ethers.formatEther(marketParams.initialPrice),
    "USD"
  );

  // Get deployment fee
  const deploymentFee = await vammFactory.deploymentFee();
  console.log(
    "   • Deployment Fee:",
    hre.ethers.formatEther(deploymentFee),
    "ETH\n"
  );

  console.log("🚀 Creating market...");

  try {
    // Create the market
    const tx = await vammFactory.createMarket(
      marketParams.symbol,
      marketParams.oracle,
      marketParams.collateralToken,
      marketParams.initialPrice,
      { value: deploymentFee }
    );

    console.log("⏳ Transaction submitted:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Market created successfully!");

    // Parse the MarketCreated event
    const marketCreatedEvent = receipt.logs.find((log) => {
      try {
        const parsed = vammFactory.interface.parseLog(log);
        return parsed.name === "MarketCreated";
      } catch (e) {
        return false;
      }
    });

    if (marketCreatedEvent) {
      const parsed = vammFactory.interface.parseLog(marketCreatedEvent);
      console.log("\n🎯 Market Details:");
      console.log("   • Market ID:", parsed.args.marketId);
      console.log("   • Symbol:", parsed.args.symbol);
      console.log("   • vAMM Address:", parsed.args.vamm);
      console.log("   • Vault Address:", parsed.args.vault);
      console.log("   • Oracle:", parsed.args.oracle);
      console.log("   • Collateral:", parsed.args.collateralToken);

      // Get market info from factory
      const marketInfo = await vammFactory.getMarket(parsed.args.marketId);
      console.log("\n📈 Market Status:");
      console.log("   • Active:", marketInfo.isActive);
      console.log(
        "   • Created At:",
        new Date(Number(marketInfo.createdAt) * 1000).toLocaleString()
      );

      // Check total markets
      const totalMarkets = await vammFactory.marketCount();
      console.log("   • Total Markets:", totalMarkets.toString());

      return {
        marketId: parsed.args.marketId,
        vamm: parsed.args.vamm,
        vault: parsed.args.vault,
        symbol: parsed.args.symbol,
      };
    }
  } catch (error) {
    console.error("❌ Market creation failed:", error.message);
    throw error;
  }
}

// Handle script execution
main()
  .then((result) => {
    if (result) {
      console.log("\n✨ Market created successfully:", result);
    }
    console.log("\n🔧 You can now:");
    console.log("   • Trade on the vAMM using the vAMM address");
    console.log("   • Deposit collateral using the Vault address");
    console.log("   • Update oracle prices using MockPriceOracle");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Script failed:", error);
    process.exit(1);
  });
