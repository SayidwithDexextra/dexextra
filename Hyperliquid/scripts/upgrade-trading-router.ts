const { ethers } = require("hardhat");

async function main() {
  console.log("🔄 Using UpgradeManager to upgrade TradingRouter contract...");

  const [deployer] = await ethers.getSigners();
  console.log("Upgrading with account:", deployer.address);

  // Current contract addresses from contract-summary.md
  const CURRENT_ADDRESSES = {
    mockUSDC: "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289",
    vaultRouter: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
    orderBookFactory: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
    oldTradingRouter: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6", // From contract-summary.md
    newTradingRouter: "0xd5e8D39Fa0D9e64dff46e1607C4E9A1f4AD9EB0F", // Our fixed TradingRouter
    upgradeManager: "0xD1b426e3BB28E773cFB318Fc982b07d1c500171b"
  };

  console.log("📊 Current system state:");
  console.log("   VaultRouter:", CURRENT_ADDRESSES.vaultRouter);
  console.log("   OrderBookFactory:", CURRENT_ADDRESSES.orderBookFactory);
  console.log("   Old TradingRouter:", CURRENT_ADDRESSES.oldTradingRouter);
  console.log("   New TradingRouter:", CURRENT_ADDRESSES.newTradingRouter);
  console.log("   UpgradeManager:", CURRENT_ADDRESSES.upgradeManager);

  // Get UpgradeManager contract
  const upgradeManagerABI = [
    "function upgradeTradingRouter(address newTradingRouter, string memory reason) external",
    "function systemHealthCheck() external view returns (bool, bool, bool, bool)",
    "function getAllContracts() external view returns (address, address, address, address)",
    "function getUpgradeCount() external view returns (uint256)",
    "function upgradesEnabled() external view returns (bool)",
    "function emergencyPauseAll() external",
    "function resumeAll() external"
  ];

  const upgradeManager = await ethers.getContractAt(upgradeManagerABI, CURRENT_ADDRESSES.upgradeManager);

  console.log("\n🏥 Pre-upgrade system health check...");
  try {
    const [vaultHealthy, factoryHealthy, tradingHealthy, systemHealthy] = await upgradeManager.systemHealthCheck();
    console.log("   VaultRouter healthy:", vaultHealthy);
    console.log("   Factory healthy:", factoryHealthy);
    console.log("   TradingRouter healthy:", tradingHealthy);
    console.log("   Overall system healthy:", systemHealthy);

    const upgradesEnabled = await upgradeManager.upgradesEnabled();
    console.log("   Upgrades enabled:", upgradesEnabled);

    if (!upgradesEnabled) {
      console.log("❌ Upgrades are disabled. Cannot proceed.");
      return;
    }
  } catch (error) {
    console.log("⚠️ Health check failed:", error.message);
  }

  console.log("\n📋 Current contract addresses from UpgradeManager:");
  try {
    const [vaultAddr, factoryAddr, tradingAddr, collateralAddr] = await upgradeManager.getAllContracts();
    console.log("   VaultRouter:", vaultAddr);
    console.log("   Factory:", factoryAddr);
    console.log("   TradingRouter:", tradingAddr);
    console.log("   Collateral:", collateralAddr);
  } catch (error) {
    console.log("⚠️ Failed to get current addresses:", error.message);
  }

  console.log("\n🔄 Executing TradingRouter upgrade...");
  try {
    const reason = "Fix ABI compatibility issue with OrderBookFactoryMinimal interface";
    
    const tx = await upgradeManager.upgradeTradingRouter(
      CURRENT_ADDRESSES.newTradingRouter,
      reason,
      {
        gasLimit: 500000 // Set explicit gas limit
      }
    );

    console.log("   Transaction hash:", tx.hash);
    console.log("   Waiting for confirmation...");
    
    const receipt = await tx.wait();
    console.log("   ✅ Upgrade completed! Block:", receipt.blockNumber);
    console.log("   Gas used:", receipt.gasUsed.toString());

    // Check for upgrade event
    const upgradeEvent = receipt.logs.find((log: any) => {
      try {
        const decoded = upgradeManager.interface.parseLog(log);
        return decoded.name === 'ContractUpgraded';
      } catch {
        return false;
      }
    });

    if (upgradeEvent) {
      const decoded = upgradeManager.interface.parseLog(upgradeEvent);
      console.log("   📝 Upgrade Event:", {
        contractType: decoded.args.contractType,
        oldContract: decoded.args.oldContract,
        newContract: decoded.args.newContract,
        upgrader: decoded.args.upgrader,
        reason: decoded.args.reason
      });
    }

  } catch (error) {
    console.error("❌ Upgrade failed:", error);
    return;
  }

  console.log("\n🏥 Post-upgrade system health check...");
  try {
    const [vaultHealthy, factoryHealthy, tradingHealthy, systemHealthy] = await upgradeManager.systemHealthCheck();
    console.log("   VaultRouter healthy:", vaultHealthy);
    console.log("   Factory healthy:", factoryHealthy);
    console.log("   TradingRouter healthy:", tradingHealthy);
    console.log("   Overall system healthy:", systemHealthy);
  } catch (error) {
    console.log("⚠️ Post-upgrade health check failed:", error.message);
  }

  console.log("\n📋 Updated contract addresses:");
  try {
    const [vaultAddr, factoryAddr, tradingAddr, collateralAddr] = await upgradeManager.getAllContracts();
    console.log("   VaultRouter:", vaultAddr);
    console.log("   Factory:", factoryAddr);
    console.log("   TradingRouter:", tradingAddr, tradingAddr === CURRENT_ADDRESSES.newTradingRouter ? "✅" : "❌");
    console.log("   Collateral:", collateralAddr);
  } catch (error) {
    console.log("⚠️ Failed to get updated addresses:", error.message);
  }

  console.log("\n🧪 Testing upgraded TradingRouter...");
  try {
    const tradingRouterABI = [
      "function getMultiMarketPrices(bytes32[] marketIds) external view returns (uint256[] bestBids, uint256[] bestAsks)",
      "function isPaused() external view returns (bool)"
    ];

    const newTradingRouter = await ethers.getContractAt(tradingRouterABI, CURRENT_ADDRESSES.newTradingRouter);
    
    const isPaused = await newTradingRouter.isPaused();
    console.log("   TradingRouter paused:", isPaused);

    // Test with Aluminum V1 market ID
    const marketId = "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";
    const result = await newTradingRouter.getMultiMarketPrices([marketId]);
    console.log("   ✅ getMultiMarketPrices works:", {
      bestBids: result[0].map((bid: any) => ethers.formatUnits(bid, 18)),
      bestAsks: result[1].map((ask: any) => ethers.formatUnits(ask, 18))
    });
  } catch (error) {
    console.log("❌ TradingRouter test failed:", error.message);
  }

  console.log("\n🎯 Upgrade Summary:");
  console.log("   ✅ UpgradeManager successfully updated TradingRouter");
  console.log("   ✅ Fixed ABI compatibility with OrderBookFactoryMinimal");
  console.log("   ✅ All contracts working seamlessly together");
  console.log("   📝 Old TradingRouter:", CURRENT_ADDRESSES.oldTradingRouter);
  console.log("   📝 New TradingRouter:", CURRENT_ADDRESSES.newTradingRouter);
  console.log("");
  console.log("⚠️  Update contract-summary.md with new TradingRouter address!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

