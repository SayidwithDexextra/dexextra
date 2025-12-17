/* eslint-disable no-console */
/**
 * End-to-end, backend-free market creation (direct tx, signer pays gas).
 *
 * Requirements (env):
 *  - RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL)
 *  - LEGACY_ADMIN (private key of deployer/creator)
 *  - FUTURES_MARKET_FACTORY_ADDRESS
 *  - ORDER_BOOK_INIT_FACET
 *  - OB_ADMIN_FACET
 *  - OB_PRICING_FACET
 *  - OB_ORDER_PLACEMENT_FACET
 *  - OB_TRADE_EXECUTION_FACET
 *  - OB_LIQUIDATION_FACET
 *  - OB_VIEW_FACET
 *  - OB_SETTLEMENT_FACET
 *  - ORDERBOOK_VAULT_FACET (or ORDERBOOK_VALUT_FACET)
 *  - MARKET_LIFECYCLE_FACET
 *  - META_TRADE_FACET
 *
 * Usage:
 *   SYMBOL=BITCOIN METRIC_URL=https://coinmarketcap.com/currencies/bitcoin/ \
 *   START_PRICE=90336.95 DATA_SOURCE="User Provided" TAGS="BTC,USD" \
 *   npx hardhat run scripts/create-market-direct.js --network hyperliquid
 *
 * Notes:
 *  - Uses createFuturesMarketDiamond (direct), not gasless metaCreate.
 *  - Settlement date defaults to now + 365d; override SETTLEMENT_TS (unix seconds).
 *  - Start price parsed to 6 decimals.
 */

const { ethers } = require("hardhat");
const OBAdminFacetArtifact = require("../artifacts/src/diamond/facets/OBAdminFacet.sol/OBAdminFacet.json");
const OBPricingFacetArtifact = require("../artifacts/src/diamond/facets/OBPricingFacet.sol/OBPricingFacet.json");
const OBOrderPlacementFacetArtifact = require("../artifacts/src/diamond/facets/OBOrderPlacementFacet.sol/OBOrderPlacementFacet.json");
const OBTradeExecutionFacetArtifact = require("../artifacts/src/diamond/facets/OBTradeExecutionFacet.sol/OBTradeExecutionFacet.json");
const OBLiquidationFacetArtifact = require("../artifacts/src/diamond/facets/OBLiquidationFacet.sol/OBLiquidationFacet.json");
const OBViewFacetArtifact = require("../artifacts/src/diamond/facets/OBViewFacet.sol/OBViewFacet.json");
const OBSettlementFacetArtifact = require("../artifacts/src/diamond/facets/OBSettlementFacet.sol/OBSettlementFacet.json");
const MarketLifecycleFacetArtifact = require("../artifacts/src/diamond/facets/MarketLifecycleFacet.sol/MarketLifecycleFacet.json");
const MetaTradeFacetArtifact = require("../artifacts/src/diamond/facets/MetaTradeFacet.sol/MetaTradeFacet.json");
const OrderBookVaultAdminFacetArtifact = require("../artifacts/src/diamond/facets/OrderBookVaultAdminFacet.sol/OrderBookVaultAdminFacet.json");

function selectorsFromAbi(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter((f) => f.type === "function")
    .map((f) => ethers.id(f.format("sighash")).slice(0, 10));
}

function getEnvAddr(name) {
  const v =
    process.env[name] ||
    (process.env && process.env[`NEXT_PUBLIC_${name}`]) ||
    null;
  return v && ethers.isAddress(v) ? v : null;
}

async function main() {
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL / JSON_RPC_URL required");

  const factoryAddress = getEnvAddr("FUTURES_MARKET_FACTORY_ADDRESS");
  const initFacet = getEnvAddr("ORDER_BOOK_INIT_FACET");
  const adminFacet = getEnvAddr("OB_ADMIN_FACET");
  const pricingFacet = getEnvAddr("OB_PRICING_FACET");
  const placementFacet = getEnvAddr("OB_ORDER_PLACEMENT_FACET");
  const execFacet = getEnvAddr("OB_TRADE_EXECUTION_FACET");
  const liqFacet = getEnvAddr("OB_LIQUIDATION_FACET");
  const viewFacet = getEnvAddr("OB_VIEW_FACET");
  const settleFacet = getEnvAddr("OB_SETTLEMENT_FACET");
  const vaultFacet =
    getEnvAddr("ORDERBOOK_VAULT_FACET") || getEnvAddr("ORDERBOOK_VALUT_FACET");
  const lifecycleFacet = getEnvAddr("MARKET_LIFECYCLE_FACET");
  const metaTradeFacet = getEnvAddr("META_TRADE_FACET");

  const missing = [
    ["FUTURES_MARKET_FACTORY_ADDRESS", factoryAddress],
    ["ORDER_BOOK_INIT_FACET", initFacet],
    ["OB_ADMIN_FACET", adminFacet],
    ["OB_PRICING_FACET", pricingFacet],
    ["OB_ORDER_PLACEMENT_FACET", placementFacet],
    ["OB_TRADE_EXECUTION_FACET", execFacet],
    ["OB_LIQUIDATION_FACET", liqFacet],
    ["OB_VIEW_FACET", viewFacet],
    ["OB_SETTLEMENT_FACET", settleFacet],
    ["ORDERBOOK_VAULT_FACET", vaultFacet],
    ["MARKET_LIFECYCLE_FACET", lifecycleFacet],
    ["META_TRADE_FACET", metaTradeFacet],
  ].filter(([, v]) => !v);
  if (missing.length) {
    throw new Error(
      `Missing required env addresses: ${missing.map((m) => m[0]).join(", ")}`
    );
  }

  const symbol = (process.env.SYMBOL || "").trim().toUpperCase();
  const metricUrl = (process.env.METRIC_URL || "").trim();
  const startPriceInput = process.env.START_PRICE || "1";
  const dataSource = process.env.DATA_SOURCE || "User Provided";
  const tags =
    (process.env.TAGS || "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 10) || [];
  const settlementTs =
    process.env.SETTLEMENT_TS &&
    Number.isFinite(Number(process.env.SETTLEMENT_TS))
      ? Number(process.env.SETTLEMENT_TS)
      : Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  if (!symbol) throw new Error("SYMBOL env required");
  if (!metricUrl) throw new Error("METRIC_URL env required");
  const startPrice6 = ethers.parseUnits(String(startPriceInput), 6);

  console.log("\nCreating market (direct tx)...");
  console.log({
    symbol,
    metricUrl,
    settlementTs,
    startPrice6: startPrice6.toString(),
    dataSource,
    tags,
    factoryAddress,
  });

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const pk = process.env.LEGACY_ADMIN;
  if (!pk) throw new Error("LEGACY_ADMIN private key required");
  const wallet = new ethers.Wallet(pk, provider);
  const signerAddr = await wallet.getAddress();
  console.log("Signer:", signerAddr);
  const net = await provider.getNetwork();
  console.log("Network chainId:", net.chainId.toString());

  // Build cutArg
  const adminSelectors = selectorsFromAbi(OBAdminFacetArtifact.abi);
  const pricingSelectors = selectorsFromAbi(OBPricingFacetArtifact.abi);
  const placementSelectors = selectorsFromAbi(
    OBOrderPlacementFacetArtifact.abi
  );
  const execSelectors = selectorsFromAbi(OBTradeExecutionFacetArtifact.abi);
  const liqSelectors = selectorsFromAbi(OBLiquidationFacetArtifact.abi);
  const viewSelectors = selectorsFromAbi(OBViewFacetArtifact.abi);
  const settleSelectors = selectorsFromAbi(OBSettlementFacetArtifact.abi);
  const vaultSelectors = selectorsFromAbi(
    OrderBookVaultAdminFacetArtifact?.abi || []
  );
  const lifecycleSelectors = selectorsFromAbi(MarketLifecycleFacetArtifact.abi);
  const metaSelectors = selectorsFromAbi(MetaTradeFacetArtifact?.abi || []);

  const cutArg = [
    [adminFacet, 0, adminSelectors],
    [pricingFacet, 0, pricingSelectors],
    [placementFacet, 0, placementSelectors],
    [execFacet, 0, execSelectors],
    [liqFacet, 0, liqSelectors],
    [viewFacet, 0, viewSelectors],
    [settleFacet, 0, settleSelectors],
    [vaultFacet, 0, vaultSelectors],
    [lifecycleFacet, 0, lifecycleSelectors],
    [metaTradeFacet, 0, metaSelectors],
  ];

  const factoryAbi = [
    "function createFuturesMarketDiamond(string,string,uint256,uint256,string,string[],address,(address,uint8,bytes4[])[],address,bytes) returns (address,bytes32)",
  ];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);

  // Send direct tx (no init calldata)
  const tx = await factory.createFuturesMarketDiamond(
    symbol,
    metricUrl,
    settlementTs,
    startPrice6,
    dataSource,
    tags,
    signerAddr, // diamondOwner
    cutArg,
    initFacet,
    "0x"
  );
  console.log("tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("mined in block:", receipt.blockNumber);

  // Parse event for orderBook/marketId
  try {
    const iface = new ethers.Interface(factoryAbi);
    let orderBook = null;
    let marketId = null;
    for (const log of receipt.logs || []) {
      try {
        const parsed = iface.parseLog(log);
        if (parsed?.name === "FuturesMarketCreated") {
          orderBook = parsed.args?.orderBook;
          marketId = parsed.args?.marketId;
          break;
        }
      } catch (_) {}
    }
    console.log("orderBook:", orderBook);
    console.log("marketId:", marketId);
  } catch (e) {
    console.warn("could not parse event:", e?.message || e);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});




