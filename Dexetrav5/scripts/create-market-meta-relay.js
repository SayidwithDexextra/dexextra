/* eslint-disable no-console */
// End-to-end metaCreate: builds typed data, signs with creator key, and submits
// metaCreateFuturesMarketDiamond directly (relayer pays gas).
//
// Required env:
//  - RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL)
//  - LEGACY_ADMIN (private key; used as creator and relayer)
//  - FUTURES_MARKET_FACTORY_ADDRESS
//  - ORDER_BOOK_INIT_FACET
//  - OB_ADMIN_FACET
//  - OB_PRICING_FACET
//  - OB_ORDER_PLACEMENT_FACET
//  - OB_TRADE_EXECUTION_FACET
//  - OB_LIQUIDATION_FACET
//  - OB_VIEW_FACET
//  - OB_SETTLEMENT_FACET
//  - ORDERBOOK_VAULT_FACET (or ORDERBOOK_VALUT_FACET)
//  - MARKET_LIFECYCLE_FACET
//  - META_TRADE_FACET
//
// Usage example:
// SYMBOL=BITCOIN METRIC_URL=https://coinmarketcap.com/currencies/bitcoin/ START_PRICE=90336.95 \
// TAGS="BTC,USD" DATA_SOURCE="User Provided" \
// npx hardhat run scripts/create-market-meta-relay.js --network hyperliquid

const { ethers } = require("hardhat");
const fetch = require("node-fetch");

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

async function loadCut() {
  try {
    const res = await fetch("http://localhost:3000/api/orderbook/cut");
    if (!res.ok) throw new Error(`cut API ${res.status}`);
    const data = await res.json();
    const cut = Array.isArray(data?.cut) ? data.cut : [];
    const initFacet = data?.initFacet || null;
    const cutArg = cut.map((c) => [
      c.facetAddress,
      c.action,
      c.functionSelectors,
    ]);
    return { cutArg, initFacet };
  } catch (e) {
    return { cutArg: null, initFacet: null, err: e };
  }
}

async function main() {
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL / JSON_RPC_URL required");
  const pk = process.env.LEGACY_ADMIN;
  if (!pk) throw new Error("LEGACY_ADMIN private key required");
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const creator = await wallet.getAddress();

  const factoryAddress = getEnvAddr("FUTURES_MARKET_FACTORY_ADDRESS");
  if (!factoryAddress)
    throw new Error("FUTURES_MARKET_FACTORY_ADDRESS required");

  // Load cut from API; fall back to env if needed
  let { cutArg, initFacet, err } = await loadCut();
  if (!cutArg || !initFacet) {
    if (err)
      console.warn("[cut] fetch failed, fallback to env:", err.message || err);
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

    const adminFacet = getEnvAddr("OB_ADMIN_FACET");
    const pricingFacet = getEnvAddr("OB_PRICING_FACET");
    const placementFacet = getEnvAddr("OB_ORDER_PLACEMENT_FACET");
    const execFacet = getEnvAddr("OB_TRADE_EXECUTION_FACET");
    const liqFacet = getEnvAddr("OB_LIQUIDATION_FACET");
    const viewFacet = getEnvAddr("OB_VIEW_FACET");
    const settleFacet = getEnvAddr("OB_SETTLEMENT_FACET");
    const vaultFacet =
      getEnvAddr("ORDERBOOK_VAULT_FACET") ||
      getEnvAddr("ORDERBOOK_VALUT_FACET");
    const lifecycleFacet = getEnvAddr("MARKET_LIFECYCLE_FACET");
    const metaTradeFacet = getEnvAddr("META_TRADE_FACET");
    initFacet = getEnvAddr("ORDER_BOOK_INIT_FACET");
    const missing = [
      ["initFacet", initFacet],
      ["adminFacet", adminFacet],
      ["pricingFacet", pricingFacet],
      ["placementFacet", placementFacet],
      ["execFacet", execFacet],
      ["liqFacet", liqFacet],
      ["viewFacet", viewFacet],
      ["settleFacet", settleFacet],
      ["vaultFacet", vaultFacet],
      ["lifecycleFacet", lifecycleFacet],
      ["metaTradeFacet", metaTradeFacet],
    ].filter(([, v]) => !v);
    if (missing.length) {
      throw new Error(
        `Missing facet addresses: ${missing.map((m) => m[0]).join(", ")}`
      );
    }
    cutArg = [
      [adminFacet, 0, selectorsFromAbi(OBAdminFacetArtifact.abi)],
      [pricingFacet, 0, selectorsFromAbi(OBPricingFacetArtifact.abi)],
      [placementFacet, 0, selectorsFromAbi(OBOrderPlacementFacetArtifact.abi)],
      [execFacet, 0, selectorsFromAbi(OBTradeExecutionFacetArtifact.abi)],
      [liqFacet, 0, selectorsFromAbi(OBLiquidationFacetArtifact.abi)],
      [viewFacet, 0, selectorsFromAbi(OBViewFacetArtifact.abi)],
      [settleFacet, 0, selectorsFromAbi(OBSettlementFacetArtifact.abi)],
      [
        vaultFacet,
        0,
        selectorsFromAbi(OrderBookVaultAdminFacetArtifact?.abi || []),
      ],
      [lifecycleFacet, 0, selectorsFromAbi(MarketLifecycleFacetArtifact.abi)],
      [metaTradeFacet, 0, selectorsFromAbi(MetaTradeFacetArtifact.abi)],
    ];
  }

  // Params
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

  const factoryAbi = [
    "function metaCreateNonce(address) view returns (uint256)",
    "function metaCreateFuturesMarketDiamond(string,string,uint256,uint256,string,string[],address,(address,uint8,bytes4[])[],address,address,uint256,uint256,bytes) returns (address,bytes32)",
  ];
  const factory = new ethers.Contract(factoryAddress, factoryAbi, wallet);
  const nonce = await factory.metaCreateNonce(creator);

  // Hash tags and cut
  const tagsHash = ethers.keccak256(
    ethers.solidityPacked(new Array(tags.length).fill("string"), tags)
  );
  const perCut = [];
  for (const c of cutArg) {
    const selectorsHash = ethers.keccak256(
      ethers.solidityPacked(new Array((c[2] || []).length).fill("bytes4"), c[2])
    );
    const enc = ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint8", "bytes32"],
      [c[0], c[1], selectorsHash]
    );
    perCut.push(ethers.keccak256(enc));
  }
  const cutHash = ethers.keccak256(
    ethers.solidityPacked(new Array(perCut.length).fill("bytes32"), perCut)
  );

  const net = await provider.getNetwork();
  const domain = {
    name: process.env.EIP712_FACTORY_DOMAIN_NAME || "DexeteraFactory",
    version: process.env.EIP712_FACTORY_DOMAIN_VERSION || "1",
    chainId: Number(net.chainId),
    verifyingContract: factoryAddress,
  };
  const types = {
    MetaCreate: [
      { name: "marketSymbol", type: "string" },
      { name: "metricUrl", type: "string" },
      { name: "settlementDate", type: "uint256" },
      { name: "startPrice", type: "uint256" },
      { name: "dataSource", type: "string" },
      { name: "tagsHash", type: "bytes32" },
      { name: "diamondOwner", type: "address" },
      { name: "cutHash", type: "bytes32" },
      { name: "initFacet", type: "address" },
      { name: "creator", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "deadline", type: "uint256" },
    ],
  };
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 15 * 60); // 15m
  const message = {
    marketSymbol: symbol,
    metricUrl,
    settlementDate: settlementTs,
    startPrice: startPrice6.toString(),
    dataSource,
    tagsHash,
    diamondOwner: creator,
    cutHash,
    initFacet,
    creator,
    nonce: nonce.toString(),
    deadline: deadline.toString(),
  };
  const signature = await wallet.signTypedData(domain, types, message);

  console.log("Domain:", domain);
  console.log("Message:", message);
  console.log("cutHash:", cutHash);
  console.log("nonce:", nonce.toString());
  console.log("signature:", signature);

  // Submit metaCreate (relayer pays gas)
  const tx = await factory.metaCreateFuturesMarketDiamond(
    symbol,
    metricUrl,
    settlementTs,
    startPrice6,
    dataSource,
    tags,
    creator, // diamondOwner = creator
    cutArg,
    initFacet,
    creator,
    nonce,
    deadline,
    signature
  );
  console.log("tx hash:", tx.hash);
  const receipt = await tx.wait();
  console.log("mined in block:", receipt.blockNumber);
  console.log("gasUsed:", receipt.gasUsed?.toString());

  // Parse event
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




