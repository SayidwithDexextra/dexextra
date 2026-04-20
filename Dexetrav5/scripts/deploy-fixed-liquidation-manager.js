const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  console.log("Deploying with signer:", signer.address);
  
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");
  
  if (balance < ethers.parseEther("0.01")) {
    console.log("\n⚠️ Low balance - deployment may fail");
  }
  
  const collateralToken = process.env.MOCK_USDC_ADDRESS;
  const admin = signer.address;
  
  console.log("\n📦 Deploying new LiquidationManager...");
  console.log("   Collateral token:", collateralToken);
  console.log("   Admin:", admin);
  
  // Link the required libraries
  const positionManagerLib = process.env.POSITION_MANAGER_ADDRESS || "0xd16e71fB31e1ce5958139C9E295b6B5cf30673E8";
  const vaultAnalyticsLib = process.env.VAULT_ANALYTICS_ADDRESS || "0x065b4668B33a7B0CdcC3e552a5945B7601568057";
  
  console.log("   PositionManager lib:", positionManagerLib);
  console.log("   VaultAnalytics lib:", vaultAnalyticsLib);
  
  const LiquidationManager = await ethers.getContractFactory("LiquidationManager", {
    libraries: {
      "src/PositionManager.sol:PositionManager": positionManagerLib,
      "src/VaultAnalytics.sol:VaultAnalytics": vaultAnalyticsLib,
    },
  });
  const liqManager = await LiquidationManager.deploy(collateralToken, admin);
  await liqManager.waitForDeployment();
  
  const liqManagerAddr = await liqManager.getAddress();
  console.log("   ✅ Deployed at:", liqManagerAddr);
  
  // Now update CoreVault to use the new LiquidationManager
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  console.log("\n🔧 Updating CoreVault to use new LiquidationManager...");
  console.log("   CoreVault:", coreVaultAddr);
  
  const coreVault = await ethers.getContractAt(
    [
      "function setLiquidationImpl(address impl) external",
      "function liquidationImpl() view returns (address)",
    ],
    coreVaultAddr,
    signer
  );
  
  const oldImpl = await coreVault.liquidationImpl();
  console.log("   Old LiquidationManager:", oldImpl);
  
  const setTx = await coreVault.setLiquidationImpl(liqManagerAddr);
  console.log("   TX:", setTx.hash);
  await setTx.wait();
  
  const newImpl = await coreVault.liquidationImpl();
  console.log("   New LiquidationManager:", newImpl);
  
  console.log("\n═══════════════════════════════════════");
  console.log("Deployment Summary:");
  console.log("  New LiquidationManager:", liqManagerAddr);
  console.log("  Previous LiquidationManager:", oldImpl);
  console.log("═══════════════════════════════════════");
  
  // Test the liquidation
  console.log("\n🧪 Testing liquidation simulation...");
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const testVault = await ethers.getContractAt(
    ["function liquidateDirect(bytes32,address)"],
    coreVaultAddr,
    signer
  );
  
  try {
    await testVault.liquidateDirect.staticCall(marketId, wallet);
    console.log("   ✅ Liquidation simulation SUCCEEDED!");
  } catch (e) {
    console.log("   ❌ Liquidation simulation failed:", e.reason || e.shortMessage || e.message?.slice(0, 150));
    
    if (e.data && e.data.startsWith("0xe2517d3f")) {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
        ["address", "bytes32"],
        "0x" + e.data.slice(10)
      );
      console.log("   AccessControlUnauthorizedAccount:");
      console.log("     Account:", decoded[0]);
      console.log("     Role:", decoded[1]);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
