const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  console.log("Market ID:", marketId);
  console.log("Wallet:", wallet);
  console.log("");
  
  const coreVault = await ethers.getContractAt(
    [
      "function marketToOrderBook(bytes32) view returns (address)",
      "function getPositionSummary(address,bytes32) view returns (int256,uint256,uint256)",
      "function getLiquidationPrice(address,bytes32) view returns (uint256,bool)",
      "function liquidateDirect(bytes32,address)",
    ],
    process.env.CORE_VAULT_ADDRESS
  );
  
  console.log("=== Via CoreVault ===");
  const obFromVault = await coreVault.marketToOrderBook(marketId);
  console.log("marketToOrderBook:", obFromVault);
  
  const [size, entry, margin] = await coreVault.getPositionSummary(wallet, marketId);
  console.log("\nPosition Summary:");
  console.log("  Size:", ethers.formatUnits(size, 18), "units");
  console.log("  Entry Price: $" + ethers.formatUnits(entry, 6));
  console.log("  Margin Locked: $" + ethers.formatUnits(margin, 6));
  
  const [liqPrice, hasPos] = await coreVault.getLiquidationPrice(wallet, marketId);
  console.log("\nLiquidation Price: $" + ethers.formatUnits(liqPrice, 6), "| Has Position:", hasPos);
  
  // Simulate via callStatic
  console.log("\n=== Simulating liquidateDirect via callStatic ===");
  try {
    await coreVault.liquidateDirect.staticCall(marketId, wallet);
    console.log("✅ Simulation succeeded!");
  } catch (e) {
    console.log("❌ Simulation failed!");
    console.log("   Reason:", e.reason || e.shortMessage || e.message?.slice(0, 200));
    
    // Try to decode error
    if (e.data) {
      console.log("   Error data:", e.data);
      // Check for AccessControlUnauthorizedAccount
      if (e.data.startsWith("0xe2517d3f")) {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["address", "bytes32"],
          "0x" + e.data.slice(10)
        );
        console.log("\n   🔍 AccessControlUnauthorizedAccount error:");
        console.log("      Account missing role:", decoded[0]);
        console.log("      Required role:", decoded[1]);
      }
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
