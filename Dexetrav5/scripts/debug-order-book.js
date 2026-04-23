const { ethers } = require("hardhat");

async function main() {
  const marketAddress = '0xade7a2029881a22479a188Ba24F38686454aA069';
  
  // Get the OBViewFacet attached to the diamond
  const view = await ethers.getContractAt('OBViewFacet', marketAddress);
  
  console.log('Testing OBViewFacet functions:');
  console.log('');
  
  // Call bestBid
  const bestBid = await view.bestBid();
  console.log('bestBid():', ethers.formatUnits(bestBid, 6));
  
  // Call bestAsk
  const bestAsk = await view.bestAsk();
  console.log('bestAsk():', ethers.formatUnits(bestAsk, 6));
  
  // Call getActiveOrdersCount
  const [buyCount, sellCount] = await view.getActiveOrdersCount();
  console.log('getActiveOrdersCount():', 'buy=' + buyCount.toString(), 'sell=' + sellCount.toString());
  
  // Call buyLevels at bestBid
  if (bestBid > 0n) {
    const level = await view.buyLevels(bestBid);
    console.log('');
    console.log('buyLevels(bestBid):');
    console.log('  totalAmount:', ethers.formatUnits(level.totalAmount, 18));
    console.log('  firstOrderId:', level.firstOrderId.toString());
    console.log('  lastOrderId:', level.lastOrderId.toString());
    console.log('  exists:', level.exists);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
