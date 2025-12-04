#!/usr/bin/env node

/**
 * Repair missing Order Placement selectors on an existing OrderBook Diamond.
 *
 * Usage:
 *   npx hardhat --config Dexetrav5/hardhat.config.js run Dexetrav5/scripts/repair-orderbook-selectors.js --network <network> -- --orderbook 0x... [--placement-facet 0x...]
 *
 * Notes:
 * - Requires the caller to be the Diamond owner (set during market creation).
 * - If --placement-facet is not provided, a new OBOrderPlacementFacet will be deployed and used.
 * - Reads .env and .env.local from project root and Dexetrav5/ for convenience.
 */

const path = require("path");
try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
  require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
} catch (_) {}

const { ethers } = require("hardhat");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function extractError(error) {
  try {
    return (
      error?.shortMessage ||
      error?.reason ||
      error?.error?.message ||
      (typeof error?.data === "string" ? error.data : undefined) ||
      error?.message ||
      String(error)
    );
  } catch (_) {
    return String(error);
  }
}

async function main() {
  let orderBook =
    getArg("--orderbook", null) ||
    process.env.ORDERBOOK_ADDRESS ||
    process.env.NEXT_PUBLIC_DEFAULT_ORDERBOOK_ADDRESS ||
    null;
  let placementFacet = getArg("--placement-facet", null);
  if (!placementFacet) {
    placementFacet =
      process.env.OB_ORDER_PLACEMENT_FACET ||
      process.env.NEXT_PUBLIC_OB_ORDER_PLACEMENT_FACET ||
      null;
  }
  if (!orderBook || !ethers.isAddress(orderBook)) {
    throw new Error(`--orderbook is required and must be a valid address`);
  }

  console.log("🔧 Repairing OrderBook selectors");
  console.log("  • OrderBook:", orderBook);

  // Required placement function signatures used by the UI
  const placementSignatures = [
    "placeLimitOrder(uint256,uint256,bool)",
    "placeMarginLimitOrder(uint256,uint256,bool)",
    "placeMarketOrder(uint256,bool)",
    "placeMarginMarketOrder(uint256,bool)",
    "placeMarketOrderWithSlippage(uint256,bool,uint256)",
    "placeMarginMarketOrderWithSlippage(uint256,bool,uint256)",
    "cancelOrder(uint256)",
  ];
  const requiredSelectors = placementSignatures.map((sig) =>
    ethers.id(sig).slice(0, 10)
  );

  // Show selector for diagnostic parity with frontend error
  const targetSig = "placeMarginMarketOrderWithSlippage(uint256,bool,uint256)";
  const targetSel = ethers.id(targetSig).slice(0, 10);
  console.log(`  • ${targetSig} selector => ${targetSel}`);

  // Loupe + Cut minimal ABIs
  const loupeAbi = ["function facetAddress(bytes4) view returns (address)"];
  const cutAbi = [
    "function diamondCut((address facetAddress,uint8 action,bytes4[] functionSelectors)[] _diamondCut,address _init,bytes _calldata)",
  ];
  const loupe = await ethers.getContractAt(loupeAbi, orderBook);
  const diamondCut = await ethers.getContractAt(cutAbi, orderBook);

  // Determine which selectors are missing
  const missing = [];
  for (const sel of requiredSelectors) {
    try {
      const addr = await loupe.facetAddress(sel);
      if (!addr || String(addr).toLowerCase() === ethers.ZeroAddress) {
        missing.push(sel);
      }
    } catch {
      missing.push(sel);
    }
  }

  if (missing.length === 0) {
    console.log("✅ Diamond already exposes all placement selectors");
    return;
  }

  console.log(`⚠️  Missing ${missing.length} placement selector(s):`, missing);

  // Resolve or deploy placement facet
  if (!placementFacet) {
    console.log(
      "  • No placement facet provided via args/env; deploying a new OBOrderPlacementFacet..."
    );
    const OBOrderPlacementFacet = await ethers.getContractFactory(
      "OBOrderPlacementFacet"
    );
    const deployed = await OBOrderPlacementFacet.deploy();
    await deployed.waitForDeployment();
    placementFacet = await deployed.getAddress();
    console.log("  • Deployed OBOrderPlacementFacet at:", placementFacet);
  } else {
    console.log("  • Using provided OBOrderPlacementFacet:", placementFacet);
  }

  if (!ethers.isAddress(placementFacet)) {
    throw new Error(
      `Invalid placement facet address: ${placementFacet} (provide --placement-facet 0x...)`
    );
  }

  // Apply diamond cut
  console.log("🧩 Applying diamondCut(Add) for missing selectors...");
  const cut = [
    {
      facetAddress: placementFacet,
      action: 0, // Add
      functionSelectors: missing,
    },
  ];
  const tx = await diamondCut.diamondCut(cut, ethers.ZeroAddress, "0x");
  console.log("  • diamondCut tx:", tx.hash);
  const rc = await tx.wait();
  console.log("  ✅ diamondCut mined:", rc?.hash || tx.hash);

  // Re-verify
  const stillMissing = [];
  for (const sel of requiredSelectors) {
    try {
      const addr = await loupe.facetAddress(sel);
      if (!addr || String(addr).toLowerCase() === ethers.ZeroAddress) {
        stillMissing.push(sel);
      }
    } catch {
      stillMissing.push(sel);
    }
  }
  if (stillMissing.length) {
    console.log("  ❌ Verification failure - still missing:", stillMissing);
    process.exitCode = 1;
  } else {
    console.log("  ✅ Verification OK - all placement selectors present");
  }
}

main().catch((e) => {
  console.error("repair-orderbook-selectors failed:", extractError(e));
  process.exitCode = 1;
});
