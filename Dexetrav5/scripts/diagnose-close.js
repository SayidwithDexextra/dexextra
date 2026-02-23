const { ethers } = require("hardhat");

async function main() {
  const BTC_OB = "0xB6Ca359d31582BBa368a890Ed60e6e0E81937AA2";
  const VAULT = "0x7bfFc6cEd5466925Aa45F0936De367a96376eAAd";
  const TRADER = "0xdda468df398ddeecc7d589ef3195c828df4812b4";
  const MARKET_ID = "0x1bd88f7ba4e2ae4db04a3ad8cdf3b9fa1acbf20e008a51a7dda9158a77bb1453";
  const AMOUNT = "100000000000000000"; // 0.1 token (18 dec)

  const ob = await ethers.getContractAt(
    [
      "function bestBid() view returns (uint256)",
      "function bestAsk() view returns (uint256)",
      "function getMaxSlippageBps() view returns (uint256)",
    ],
    BTC_OB
  );

  const vault = await ethers.getContractAt(
    [
      "function getPositionSummary(address,bytes32) view returns (int256,uint256,uint256)",
      "function getAvailableCollateral(address) view returns (uint256)",
    ],
    VAULT
  );

  console.log("=== On-chain state ===");
  const bestBid = await ob.bestBid();
  const bestAsk = await ob.bestAsk();
  console.log("bestBid:", bestBid.toString());
  console.log("bestAsk:", bestAsk.toString());
  try {
    const slippage = await ob.getMaxSlippageBps();
    console.log("maxSlippageBps:", slippage.toString());
  } catch { console.log("maxSlippageBps: (not available)"); }

  const [posSize, entryPrice, marginLocked] = await vault.getPositionSummary(TRADER, MARKET_ID);
  console.log("\n=== Trader position ===");
  console.log("size:", posSize.toString());
  console.log("entryPrice:", entryPrice.toString());
  console.log("marginLocked:", marginLocked.toString());

  const avail = await vault.getAvailableCollateral(TRADER);
  console.log("availableCollateral:", avail.toString());

  const isBuy = false;
  const refPrice = isBuy ? bestAsk : bestBid;
  console.log("\n=== Simulating close (sell to close long) ===");
  console.log("refPrice (bestBid):", refPrice.toString());

  if (refPrice === 0n) {
    console.log("WOULD REVERT: no buy-side liquidity");
    return;
  }

  // Try static call through the full session path (like the API does)
  // Use the MetaTradeFacet sessionPlaceMarginMarket function
  const SESSION_ID = "0x44a206c866bcb105f6f276d015593abdf979f0a301c65d5e75e2541d5ac6eeb6";
  const meta = await ethers.getContractAt(
    [
      "function sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[]) returns (uint256)",
      "function placeMarginMarketOrder(uint256,bool) returns (uint256)",
    ],
    BTC_OB
  );

  // First try the direct placeMarginMarketOrder (bypasses session/MetaTradeFacet)
  console.log("\n=== Static call: placeMarginMarketOrder (direct) ===");
  try {
    const result = await meta.placeMarginMarketOrder.staticCall(AMOUNT, isBuy);
    console.log("SUCCESS - filled:", result.toString());
  } catch (e) {
    console.log("REVERTED:", e.reason || e.shortMessage || e.message);
  }

  // Then try through session path
  console.log("\n=== Static call: sessionPlaceMarginMarket (gasless path) ===");
  try {
    const result2 = await meta.sessionPlaceMarginMarket.staticCall(SESSION_ID, TRADER, AMOUNT, isBuy, []);
    console.log("SUCCESS - filled:", result2.toString());
  } catch (e) {
    console.log("REVERTED:", e.reason || e.shortMessage || e.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("Error:", e.message);
    process.exit(1);
  });
