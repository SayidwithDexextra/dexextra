const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  const coreVault = await ethers.getContractAt(
    [
      "function userPositions(address,uint256) view returns (bytes32,int256,uint256,uint256,uint256,uint256)",
      "function userPositionIndex(address,bytes32) view returns (uint256)",
      "function isLiquidatable(address,bytes32,uint256) view returns (bool)",
    ],
    process.env.CORE_VAULT_ADDRESS
  );
  
  console.log("Checking position arrays for:", wallet);
  
  // Check position index
  try {
    const idx = await coreVault.userPositionIndex(wallet, marketId);
    console.log("Position index:", idx.toString());
    
    if (idx > 0n) {
      // Index is 1-based (0 means no position)
      const arrayIdx = idx - 1n;
      console.log("Array index:", arrayIdx.toString());
      
      const pos = await coreVault.userPositions(wallet, arrayIdx);
      console.log("Position at index:", pos);
    }
  } catch (e) {
    console.log("Error checking position index:", e.message?.slice(0, 150));
  }
  
  // Check isLiquidatable directly
  console.log("\nChecking isLiquidatable...");
  try {
    const mark = 3000000n; // $3
    const isLiq = await coreVault.isLiquidatable(wallet, marketId, mark);
    console.log("isLiquidatable($3):", isLiq);
  } catch (e) {
    console.log("Error:", e.message?.slice(0, 150));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
