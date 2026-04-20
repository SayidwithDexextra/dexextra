const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  const newLiqManager = "0x07C7c1A314475d96270ccAB0Ca579361cacf9D08";
  
  console.log("🔧 Updating CoreVault's LiquidationManager...");
  console.log("   Signer:", signer.address);
  console.log("   CoreVault:", process.env.CORE_VAULT_ADDRESS);
  console.log("   New LiquidationManager:", newLiqManager);
  
  const coreVault = await ethers.getContractAt(
    ["function setLiquidationManager(address) external"],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  const tx = await coreVault.setLiquidationManager(newLiqManager);
  console.log("   TX:", tx.hash);
  await tx.wait();
  console.log("   ✅ Updated!");
  
  // Test liquidation
  console.log("\n🧪 Testing liquidation simulation...");
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const testVault = await ethers.getContractAt(
    ["function liquidateDirect(bytes32,address)"],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  try {
    await testVault.liquidateDirect.staticCall(marketId, wallet);
    console.log("   ✅ Liquidation simulation SUCCEEDED!");
  } catch (e) {
    console.log("   ❌ Simulation failed:", e.reason || e.shortMessage || e.message?.slice(0, 150));
    if (e.data && e.data.startsWith("0xe2517d3f")) {
      const decoded = ethers.AbiCoder.defaultAbiCoder().decode(["address", "bytes32"], "0x" + e.data.slice(10));
      console.log("   AccessControlUnauthorizedAccount:", decoded[0], decoded[1]);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
