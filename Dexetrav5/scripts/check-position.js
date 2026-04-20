const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const coreVault = await ethers.getContractAt(
    [
      "function getPositionSummary(address,bytes32) view returns (int256,uint256,uint256)",
      "function getLiquidationPrice(address,bytes32) view returns (uint256,bool)",
      "function isLiquidatable(address,bytes32,uint256) view returns (bool)",
    ],
    process.env.CORE_VAULT_ADDRESS
  );
  
  console.log("Checking position for:", wallet);
  console.log("Market:", marketId);
  
  try {
    const [size, entry, margin] = await coreVault.getPositionSummary(wallet, marketId);
    console.log("\nPosition Summary:");
    console.log("  Size:", ethers.formatUnits(size, 18));
    console.log("  Entry:", ethers.formatUnits(entry, 6));
    console.log("  Margin:", ethers.formatUnits(margin, 6));
    
    if (size == 0n) {
      console.log("\n✅ Position is closed (size = 0)");
      console.log("   The position was likely already liquidated or closed.");
    }
  } catch (e) {
    console.log("Error getting position:", e.message?.slice(0, 100));
  }
  
  try {
    const [liqPrice, hasPos] = await coreVault.getLiquidationPrice(wallet, marketId);
    console.log("\nLiquidation Price:", ethers.formatUnits(liqPrice, 6), "| Has Position:", hasPos);
  } catch (e) {
    console.log("Error getting liq price:", e.message?.slice(0, 100));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
