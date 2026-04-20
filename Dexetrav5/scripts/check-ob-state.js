const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  
  const ob = await ethers.getContractAt(
    [
      "function bestBid() view returns (uint256)",
      "function bestAsk() view returns (uint256)",
      "function getAllTraders() view returns (address[])",
      "function calculateMarkPrice() view returns (uint256)",
    ],
    orderBook
  );
  
  console.log("OrderBook:", orderBook);
  
  try {
    const bestBid = await ob.bestBid();
    console.log("Best Bid:", ethers.formatUnits(bestBid, 6));
  } catch (e) {
    console.log("Best Bid: error -", e.message?.slice(0, 80));
  }
  
  try {
    const bestAsk = await ob.bestAsk();
    console.log("Best Ask:", ethers.formatUnits(bestAsk, 6));
  } catch (e) {
    console.log("Best Ask: error -", e.message?.slice(0, 80));
  }
  
  try {
    const traders = await ob.getAllTraders();
    console.log("Traders count:", traders.length);
  } catch (e) {
    console.log("Traders: error -", e.message?.slice(0, 80));
  }
  
  try {
    const mark = await ob.calculateMarkPrice();
    console.log("Mark Price:", ethers.formatUnits(mark, 6));
  } catch (e) {
    console.log("Mark Price: error -", e.message?.slice(0, 80));
  }
}

main().catch(e => { console.error(e); process.exit(1); });
