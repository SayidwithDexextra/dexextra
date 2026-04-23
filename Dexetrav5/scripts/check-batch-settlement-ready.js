const { ethers } = require("hardhat");

async function main() {
  const marketAddress = "0xade7a2029881a22479a188Ba24F38686454aA069";
  
  const batch = await ethers.getContractAt("OBBatchSettlementFacet", marketAddress);
  const view = await ethers.getContractAt("OBViewFacet", marketAddress);
  
  console.log("Batch Settlement Readiness Check");
  console.log("================================");
  console.log("");
  
  // Get settlement progress (includes orders remaining)
  try {
    const [buyRemaining, sellRemaining, vaultPhase, cursor, totalPositions] = await batch.getSettlementProgress();
    console.log("getSettlementProgress:");
    console.log("  Buy orders remaining:", buyRemaining.toString());
    console.log("  Sell orders remaining:", sellRemaining.toString());
    console.log("  Vault phase:", vaultPhase.toString());
    console.log("  Cursor:", cursor.toString());
    console.log("  Total positions:", totalPositions.toString());
  } catch (e) {
    console.log("getSettlementProgress error:", e.reason || e.message?.substring(0, 80));
  }
  
  // Check price levels directly
  console.log("");
  console.log("Checking buyLevels directly:");
  const bestBid = await view.bestBid();
  const level = await view.buyLevels(bestBid);
  console.log("  Best bid level ($" + ethers.formatUnits(bestBid, 6) + "):");
  console.log("    exists:", level.exists);
  console.log("    firstOrderId:", level.firstOrderId.toString());
  console.log("    lastOrderId:", level.lastOrderId.toString());
  console.log("    totalAmount:", ethers.formatUnits(level.totalAmount, 18));
  
  if (level.firstOrderId > 0n && level.lastOrderId > 0n) {
    const orderCount = Number(level.lastOrderId - level.firstOrderId + 1n);
    console.log("");
    console.log("CONCLUSION: ~" + orderCount + " orders exist at bestBid price level");
    console.log("Batch settlement WILL find and cancel these orders.");
  }
}

main()
  .then(() => process.exit(0))
  .catch(console.error);
