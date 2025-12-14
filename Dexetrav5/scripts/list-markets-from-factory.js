/* eslint-disable no-console */
// Lists marketIds and orderBooks using FuturesMarketFactory getters (getAllMarkets + getOrderBookForMarket).
// Usage:
//   FUTURES_MARKET_FACTORY_ADDRESS=0x... npx hardhat run scripts/list-markets-from-factory.js --network hyperliquid

const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
  if (!factoryAddress)
    throw new Error("FUTURES_MARKET_FACTORY_ADDRESS required");

  const [signer] = await ethers.getSigners();
  const provider = signer.provider;
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    factoryAddress,
    signer
  );

  const marketIds = await factory.getAllMarkets();
  console.log(`Found ${marketIds.length} markets from getAllMarkets():\n`);
  const results = [];
  for (const m of marketIds) {
    const orderBook = await factory.getOrderBookForMarket(m);
    const symbol = await factory.getMarketSymbol(m);
    results.push({ marketId: m, orderBook, symbol });
  }
  console.log(results);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

