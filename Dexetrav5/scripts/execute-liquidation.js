const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  const marketId = "0x385f306b03d718570a850d4d785c69dfe2961d44e2a80bd2cb2cb9ab2bf9df63";
  const wallet = "0x724cbe7b515dab1ce4b0e262990d2e3c47c6ca36";
  
  console.log("🔥 Executing REAL liquidation on-chain");
  console.log("   Market:", marketId.slice(0, 18) + "...");
  console.log("   Wallet:", wallet);
  console.log("   Signer:", signer.address);
  
  // Check position before
  const coreVault = await ethers.getContractAt(
    [
      "function liquidateDirect(bytes32,address)",
      "function getPositionSummary(address,bytes32) view returns (int256,uint256,uint256)",
    ],
    process.env.CORE_VAULT_ADDRESS,
    signer
  );
  
  console.log("\n📊 Position BEFORE liquidation:");
  const [sizeBefore, entryBefore, marginBefore] = await coreVault.getPositionSummary(wallet, marketId);
  console.log("   Size:", ethers.formatUnits(sizeBefore, 18));
  console.log("   Entry:", ethers.formatUnits(entryBefore, 6));
  console.log("   Margin:", ethers.formatUnits(marginBefore, 6));
  
  if (sizeBefore === 0n) {
    console.log("\n⚠️ No position to liquidate!");
    return;
  }
  
  console.log("\n⚡ Calling liquidateDirect...");
  const tx = await coreVault.liquidateDirect(marketId, wallet);
  console.log("   TX:", tx.hash);
  
  const receipt = await tx.wait();
  console.log("   ✅ Confirmed in block:", receipt.blockNumber);
  console.log("   Gas used:", receipt.gasUsed.toString());
  
  // Check position after
  console.log("\n📊 Position AFTER liquidation:");
  const [sizeAfter, entryAfter, marginAfter] = await coreVault.getPositionSummary(wallet, marketId);
  console.log("   Size:", ethers.formatUnits(sizeAfter, 18));
  console.log("   Entry:", ethers.formatUnits(entryAfter, 6));
  console.log("   Margin:", ethers.formatUnits(marginAfter, 6));
  
  if (sizeAfter === 0n) {
    console.log("\n🎉 Position fully liquidated!");
  } else {
    console.log("\n⚠️ Position partially liquidated. Remaining size:", ethers.formatUnits(sizeAfter, 18));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
