const hre = require("hardhat");

async function main() {
  // SEI-MARKET-PRICE-USD market address from the screenshot (0xade7...A069)
  const marketAddress = "0xade7a2029881a22479a188Ba24F38686454aA069";
  
  const viewFacetABI = [
    "function isSettled() view returns (bool)",
    "function getBestBid() view returns (uint256)",
    "function getBestAsk() view returns (uint256)",
    "function getOrderBookDepth(uint256 levels) view returns (uint256[] memory bidPrices, uint256[] memory bidSizes, uint256[] memory askPrices, uint256[] memory askSizes)",
  ];
  
  const market = await hre.ethers.getContractAt(viewFacetABI, marketAddress);
  
  console.log("Market:", marketAddress);
  console.log("isSettled:", await market.isSettled());
  console.log("Best Bid:", (await market.getBestBid()).toString());
  console.log("Best Ask:", (await market.getBestAsk()).toString());
  
  try {
    const [bidPrices, bidSizes, askPrices, askSizes] = await market.getOrderBookDepth(5);
    console.log("\nOrder Book Depth (5 levels):");
    console.log("  Bids:", bidPrices.map((p, i) => `${hre.ethers.formatUnits(p, 6)}@${bidSizes[i]}`).join(", "));
    console.log("  Asks:", askPrices.map((p, i) => `${hre.ethers.formatUnits(p, 6)}@${askSizes[i]}`).join(", "));
  } catch (e) {
    console.log("Could not get order book depth:", e.reason || e.message?.slice(0, 100));
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
