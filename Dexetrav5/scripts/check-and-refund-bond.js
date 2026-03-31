// Check bond status and trigger rollover refund for a market.
//
// Usage:
//   # By order book address (will auto-resolve bytes32 marketId):
//   ORDER_BOOK=0x... npx hardhat run scripts/check-and-refund-bond.js --network hyperliquid
//
//   # By bytes32 market ID + order book address:
//   MARKET_ID=0x... ORDER_BOOK=0x... npx hardhat run scripts/check-and-refund-bond.js --network hyperliquid
//
//   # Check only (no refund attempt):
//   ORDER_BOOK=0x... CHECK_ONLY=true npx hardhat run scripts/check-and-refund-bond.js --network hyperliquid
//
// Env (repo root .env.local / .env):
//   MARKET_BOND_MANAGER_ADDRESS  (required)

const path = require("path");
try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}
try { require("dotenv").config(); } catch (_) {}

const { ethers } = require("hardhat");

async function getAdminSigner() {
  const pk = process.env.ADMIN_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!pk) throw new Error("ADMIN_PRIVATE_KEY not set");
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || process.env.JSON_RPC_URL || "https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-"
  );
  return new ethers.Wallet(pk, provider);
}

const BOND_MANAGER_ABI = [
  "function bondByMarket(bytes32 marketId) external view returns (address creator, uint96 amount, bool refunded)",
  "function owner() external view returns (address)",
  "function factory() external view returns (address)",
  "function onMarketRollover(bytes32 marketId, address orderBook) external",
];

const ORDERBOOK_ABI = [
  "function marketStatic() external view returns (address vault, bytes32 marketId, bool useVWAP, uint256 vwapWindow)",
];

const LIFECYCLE_ABI = [
  "function getLifecycleState() external view returns (uint8)",
  "function getMarketLineage() external view returns (address parent, address child)",
];

const LIFECYCLE_LABELS = ["Unsettled", "Rollover", "ChallengeWindow", "Settled"];

async function main() {
  const signer = await getAdminSigner();
  console.log(`\nSigner (admin): ${signer.address}`);

  const bondManagerAddr = process.env.MARKET_BOND_MANAGER_ADDRESS;
  if (!bondManagerAddr) {
    console.error("MARKET_BOND_MANAGER_ADDRESS not set");
    process.exit(1);
  }

  const orderBookAddr = process.env.ORDER_BOOK;
  if (!orderBookAddr) {
    console.error("ORDER_BOOK env var required (parent market order book address)");
    process.exit(1);
  }

  const checkOnly = process.env.CHECK_ONLY === "true";
  console.log(`Bond Manager: ${bondManagerAddr}`);
  console.log(`Order Book:   ${orderBookAddr}`);
  console.log(`Mode:         ${checkOnly ? "CHECK ONLY" : "CHECK + REFUND"}\n`);

  const bondManager = new ethers.Contract(bondManagerAddr, BOND_MANAGER_ABI, signer);
  const orderBook = new ethers.Contract(orderBookAddr, ORDERBOOK_ABI, signer);
  const lifecycle = new ethers.Contract(orderBookAddr, LIFECYCLE_ABI, signer);

  // 1. Resolve bytes32 marketId from order book
  let marketId = process.env.MARKET_ID;
  console.log("── Order Book Info ──");
  try {
    const [vault, obMarketId, useVWAP, vwapWindow] = await orderBook.marketStatic();
    console.log(`  vault:      ${vault}`);
    console.log(`  marketId:   ${obMarketId}`);
    console.log(`  useVWAP:    ${useVWAP}`);
    if (!marketId) marketId = obMarketId;
  } catch (e) {
    console.error(`  Failed to read marketStatic(): ${e.message}`);
    if (!marketId) {
      console.error("  Cannot proceed without MARKET_ID");
      process.exit(1);
    }
  }

  // 2. Check lifecycle state
  console.log("\n── Lifecycle State ──");
  let lifecycleState, childMarket;
  try {
    lifecycleState = Number(await lifecycle.getLifecycleState());
    const [parent, child] = await lifecycle.getMarketLineage();
    childMarket = child;
    console.log(`  state:       ${lifecycleState} (${LIFECYCLE_LABELS[lifecycleState] || "Unknown"})`);
    console.log(`  parent:      ${parent}`);
    console.log(`  child:       ${child}`);
    const hasChild = child !== ethers.ZeroAddress;
    console.log(`  rollover?    ${lifecycleState >= 1 && hasChild ? "YES ✅" : "NO ❌"}`);
  } catch (e) {
    console.error(`  Failed to read lifecycle: ${e.message}`);
  }

  // 3. Check bond status
  console.log("\n── Bond Info ──");
  let bondCreator, bondAmount, bondRefunded;
  try {
    [bondCreator, bondAmount, bondRefunded] = await bondManager.bondByMarket(marketId);
    const amountFormatted = ethers.formatUnits(bondAmount, 6);
    console.log(`  creator:     ${bondCreator}`);
    console.log(`  amount:      ${bondAmount} (${amountFormatted} USDC)`);
    console.log(`  refunded:    ${bondRefunded}`);

    if (bondCreator === ethers.ZeroAddress) {
      console.log("\n⚠️  No bond recorded for this market on the current bond manager.");
      console.log("   This market was likely created before the V2 bond manager deployment,");
      console.log("   or the creator was bond-exempt.");
      return;
    }

    if (bondRefunded) {
      console.log("\n✅ Bond already refunded. Nothing to do.");
      return;
    }
  } catch (e) {
    console.error(`  Failed to read bondByMarket: ${e.message}`);
    return;
  }

  // 4. Check authorization
  console.log("\n── Authorization ──");
  try {
    const bmOwner = await bondManager.owner();
    const bmFactory = await bondManager.factory();
    console.log(`  BM owner:    ${bmOwner}`);
    console.log(`  BM factory:  ${bmFactory}`);
    const isOwner = signer.address.toLowerCase() === bmOwner.toLowerCase();
    const isFactory = signer.address.toLowerCase() === bmFactory.toLowerCase();
    console.log(`  Signer is owner?   ${isOwner ? "YES ✅" : "NO"}`);
    console.log(`  Signer is factory? ${isFactory ? "YES" : "NO"}`);
    if (!isOwner && !isFactory) {
      console.error("\n❌ Signer is neither the owner nor the factory. Cannot call onMarketRollover.");
      return;
    }
  } catch (e) {
    console.error(`  Failed to check authorization: ${e.message}`);
  }

  if (checkOnly) {
    console.log("\n── CHECK_ONLY mode — skipping refund ──");
    return;
  }

  // 5. Attempt rollover refund
  console.log("\n── Attempting Bond Refund ──");
  try {
    console.log(`  Calling onMarketRollover(${marketId}, ${orderBookAddr})...`);
    const tx = await bondManager.onMarketRollover(marketId, orderBookAddr);
    console.log(`  → tx: ${tx.hash}`);
    const receipt = await tx.wait();
    console.log(`  ✅ Bond refunded! Gas used: ${receipt.gasUsed}`);
    console.log(`  Amount returned to ${bondCreator}: ${ethers.formatUnits(bondAmount, 6)} USDC`);
  } catch (e) {
    const reason = e.reason || e.shortMessage || e.message;
    console.error(`  ❌ Refund failed: ${reason}`);

    if (reason?.includes("BondNotFound")) {
      console.log("     → No bond recorded for this marketId on the bond manager.");
    } else if (reason?.includes("BondAlreadyRefunded")) {
      console.log("     → Bond was already refunded.");
    } else if (reason?.includes("RolloverNotConfirmed")) {
      console.log("     → Market is not in rollover state or has no child linked.");
    } else if (reason?.includes("MarketMismatch")) {
      console.log("     → Order book marketId doesn't match the provided marketId.");
    } else if (reason?.includes("OnlyFactory")) {
      console.log("     → Signer is not authorized (not owner or factory).");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
