/* eslint-disable no-console */
// Compute hashes exactly like the factory (tagsHash, cutHash, domain, digest)
// without any contract calls or redeploys.
//
// Usage:
//   FUTURES_MARKET_FACTORY_ADDRESS=0x... \
//   SYMBOL=BITCOIN \
//   METRIC_URL=https://coinmarketcap.com/currencies/bitcoin/ \
//   START_PRICE=90336.95 \
//   TAGS="BTC,USD" \
//   INIT_FACET=0x... (optional if /api/orderbook/cut succeeds) \
//   npx hardhat run scripts/inspect-meta-hashes.js --network hyperliquid
//
// Notes:
// - Uses /api/orderbook/cut if reachable at localhost:3000; otherwise falls
//   back to env facets and local artifacts.
// - Prints tagsHash, cutHash, domain separator, structHash, digest, signature
//   (if PRIVATE_KEY_USERD is set to sign).

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

async function fallbackCut() {
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
    getEnvAddr("ORDERBOOK_VAULT_FACET") || getEnvAddr("ORDERBOOK_VALUT_FACET");
  const lifecycleFacet = getEnvAddr("MARKET_LIFECYCLE_FACET");
  const metaTradeFacet = getEnvAddr("META_TRADE_FACET");
  const initFacet = getEnvAddr("ORDER_BOOK_INIT_FACET");
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
  const cutArg = [
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
  return { cutArg, initFacet };
}

async function main() {
  const rpcUrl =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL / JSON_RPC_URL required");
  const factoryAddress = getEnvAddr("FUTURES_MARKET_FACTORY_ADDRESS");
  if (!factoryAddress)
    throw new Error("FUTURES_MARKET_FACTORY_ADDRESS required");

  let { cutArg, initFacet, err } = await loadCut();
  if (!cutArg || !initFacet) {
    ({ cutArg, initFacet } = await fallbackCut());
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

  const provider = new ethers.JsonRpcProvider(rpcUrl);
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
  const creator =
    getEnvAddr("CREATOR_ADDRESS") ||
    (process.env.PRIVATE_KEY_USERD
      ? new ethers.Wallet(process.env.PRIVATE_KEY_USERD).address
      : null);
  if (!creator) throw new Error("Set CREATOR_ADDRESS or PRIVATE_KEY_USERD");
  const nonce = "0";
  const deadline = Math.floor(Date.now() / 1000) + 15 * 60;
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
    nonce,
    deadline: String(deadline),
  };

  const structHash = ethers.TypedDataEncoder.hashStruct(
    "MetaCreate",
    types,
    message
  );
  const digest = ethers.TypedDataEncoder.hash(domain, types, message);

  console.log("tagsHash:", tagsHash);
  console.log("cutHash:", cutHash);
  console.log("domain:", domain);
  console.log("domainSeparator:", ethers.TypedDataEncoder.hashDomain(domain));
  console.log("structHash:", structHash);
  console.log("digest:", digest);
  console.log("message:", message);

  if (process.env.PRIVATE_KEY_USERD) {
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY_USERD, provider);
    const signature = await wallet.signTypedData(domain, types, message);
    console.log("signature:", signature);
    console.log(
      "recovered:",
      ethers.verifyTypedData(domain, types, message, signature)
    );
  } else {
    console.log("Set PRIVATE_KEY_USERD to also sign and recover.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});








