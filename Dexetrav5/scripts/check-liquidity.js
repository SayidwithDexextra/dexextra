const { ethers } = require("hardhat");

async function main() {
  const BTC_OB = "0xB6Ca359d31582BBa368a890Ed60e6e0E81937AA2";

  const ob = await ethers.getContractAt(
    [
      "function bestBid() view returns (uint256)",
      "function bestAsk() view returns (uint256)",
      "function getActiveBuyPrices() view returns (uint256[])",
      "function getActiveSellPrices() view returns (uint256[])",
      "function buyLevels(uint256) view returns (uint256 totalAmount, uint256 firstOrderId, uint256 lastOrderId, bool exists)",
      "function sellLevels(uint256) view returns (uint256 totalAmount, uint256 firstOrderId, uint256 lastOrderId, bool exists)",
      "function getOrder(uint256) view returns (uint256 orderId, address trader, uint256 price, uint256 amount, bool isBuy, uint256 timestamp, uint256 nextOrderId, uint256 marginRequired, bool isMarginOrder)",
    ],
    BTC_OB
  );

  const bestBid = await ob.bestBid();
  const bestAsk = await ob.bestAsk();
  console.log("bestBid:", bestBid.toString());
  console.log("bestAsk:", bestAsk.toString());

  if (bestBid > 0n) {
    const lvl = await ob.buyLevels(bestBid);
    console.log("\nBuy level at bestBid:", {
      totalAmount: lvl.totalAmount.toString(),
      firstOrderId: lvl.firstOrderId.toString(),
      exists: lvl.exists,
    });
    if (lvl.firstOrderId > 0n) {
      const order = await ob.getOrder(lvl.firstOrderId);
      console.log("Top buy order:", {
        orderId: order.orderId.toString(),
        trader: order.trader,
        price: order.price.toString(),
        amount: order.amount.toString(),
        isBuy: order.isBuy,
        isMarginOrder: order.isMarginOrder,
      });
    }
  } else {
    console.log("\nNo buy-side liquidity (bestBid = 0)");
  }

  if (bestAsk > 0n) {
    const lvl = await ob.sellLevels(bestAsk);
    console.log("\nSell level at bestAsk:", {
      totalAmount: lvl.totalAmount.toString(),
      firstOrderId: lvl.firstOrderId.toString(),
      exists: lvl.exists,
    });
  } else {
    console.log("\nNo sell-side liquidity (bestAsk = 0)");
  }

  try {
    const buys = await ob.getActiveBuyPrices();
    console.log("\nAll active buy prices:", buys.map((p) => p.toString()));
  } catch (e) {
    console.log("\ngetActiveBuyPrices failed:", e.message?.slice(0, 100));
  }
  try {
    const sells = await ob.getActiveSellPrices();
    console.log("All active sell prices:", sells.map((p) => p.toString()));
  } catch (e) {
    console.log("getActiveSellPrices failed:", e.message?.slice(0, 100));
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
