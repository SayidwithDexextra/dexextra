// Redeploy CoreVault + FuturesMarketFactory and rewire roles using env values.
// Env alignment follows existing deploy scripts (.env.local preferred):
//  - Collateral token: MOCK_USDC_ADDRESS (falls back to USDC_TOKEN_ADDRESS)
//  - Liquidation manager: LIQUIDATION_MANAGER_ADDRESS
//  - Existing orderbooks/markets: ORDERBOOKS, MARKET_IDS (comma-separated) OR fallback to ALUMINUM_ORDERBOOK_ADDRESS / ALUMINUM_MARKET_ID
//  - Settlement operator (optional): SETTLEMENT_WALLET_ADDRESS
//  - CollateralHub (optional): COLLATERAL_HUB_ADDRESS
//  - Factory admin/fee recipient default to deployer unless FACTORY_ADMIN_ADDRESS / FACTORY_FEE_RECIPIENT set

const path = require("path");
// Prefer .env.local at repo root, then .env (same pattern as deploy.js)
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");

function required(name) {
  const v = process.env[name];
  if (!v || v.trim() === "") throw new Error(`Missing env ${name}`);
  return v.trim();
}

function parseList(name) {
  const v = process.env[name];
  if (!v) return [];
  return v
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function pickCollateralToken() {
  return (
    process.env.MOCK_USDC_ADDRESS?.trim() ||
    process.env.USDC_TOKEN_ADDRESS?.trim() ||
    ""
  );
}

function resolveOrderbooksAndMarkets() {
  const obs = parseList("ORDERBOOKS");
  const mids = parseList("MARKET_IDS");
  if (obs.length && obs.length === mids.length) return { obs, mids };
  // fallback to legacy ALUMINUM envs
  const aluOb = process.env.ALUMINUM_ORDERBOOK_ADDRESS?.trim();
  const aluMid = process.env.ALUMINUM_MARKET_ID?.trim();
  if (aluOb && aluMid) return { obs: [aluOb], mids: [aluMid] };
  return { obs: [], mids: [] };
}

async function main() {
  console.log("--- Redeploy CoreVault + FuturesMarketFactory ---");
  const collateralToken = pickCollateralToken();
  if (!collateralToken)
    throw new Error("Missing MOCK_USDC_ADDRESS or USDC_TOKEN_ADDRESS");

  const liqManager = required("LIQUIDATION_MANAGER_ADDRESS");
  const collateralHub = process.env.COLLATERAL_HUB_ADDRESS?.trim();
  const settlementWallet = process.env.SETTLEMENT_WALLET_ADDRESS?.trim();

  const { obs: orderBooks, mids: marketIds } = resolveOrderbooksAndMarkets();
  if (orderBooks.length !== marketIds.length) {
    throw new Error(
      "ORDERBOOKS and MARKET_IDS must have equal length (or provide ALUMINUM_* fallback)"
    );
  }

  const [deployer] = await ethers.getSigners();
  const factoryAdmin =
    process.env.FACTORY_ADMIN_ADDRESS?.trim() || deployer.address;
  const factoryFeeRecipient =
    process.env.FACTORY_FEE_RECIPIENT?.trim() || deployer.address;
  const coreVaultAdmin =
    process.env.CORE_VAULT_ADMIN_ADDRESS?.trim() || deployer.address;

  console.log("Deployer:", deployer.address);
  console.log("Collateral token:", collateralToken);
  console.log("CoreVault admin:", coreVaultAdmin);
  console.log(
    "Factory admin:",
    factoryAdmin,
    "feeRecipient:",
    factoryFeeRecipient
  );

  // Required libraries for CoreVault
  const VAULT_ANALYTICS = required("VAULT_ANALYTICS_ADDRESS");
  const POSITION_MANAGER = required("POSITION_MANAGER_ADDRESS");
  console.log("VaultAnalytics lib:", VAULT_ANALYTICS);
  console.log("PositionManager lib:", POSITION_MANAGER);

  // Deploy CoreVault
  const CoreVault = await ethers.getContractFactory("CoreVault", {
    libraries: {
      VaultAnalytics: VAULT_ANALYTICS,
      PositionManager: POSITION_MANAGER,
    },
  });
  const coreVault = await CoreVault.deploy(collateralToken, coreVaultAdmin);
  await coreVault.waitForDeployment();
  console.log("CoreVault deployed:", coreVault.target);

  // Set liquidation manager
  const txLiq = await coreVault.setLiquidationManager(liqManager);
  await txLiq.wait();
  console.log("Set liquidation manager:", liqManager);

  // Deploy FuturesMarketFactory with new vault
  const FuturesMarketFactory = await ethers.getContractFactory(
    "FuturesMarketFactory"
  );
  const factory = await FuturesMarketFactory.deploy(
    coreVault.target,
    factoryAdmin,
    factoryFeeRecipient
  );
  await factory.waitForDeployment();
  console.log("FuturesMarketFactory deployed:", factory.target);

  // Deploy OrderBookVaultAdminFacet for retargeting OB vaults (diamond cut)
  const OrderBookVaultAdminFacet = await ethers.getContractFactory(
    "OrderBookVaultAdminFacet"
  );
  const obVaultFacet = await OrderBookVaultAdminFacet.deploy();
  await obVaultFacet.waitForDeployment();
  console.log("OrderBookVaultAdminFacet deployed:", obVaultFacet.target);

  // Grant roles on vault
  const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
  const ORDERBOOK_ROLE = await coreVault.ORDERBOOK_ROLE();
  const SETTLEMENT_ROLE = await coreVault.SETTLEMENT_ROLE();
  const EXTERNAL_CREDITOR_ROLE = await coreVault.EXTERNAL_CREDITOR_ROLE();

  const roleTxs = [];
  roleTxs.push(await coreVault.grantRole(FACTORY_ROLE, factory.target));
  if (collateralHub) {
    roleTxs.push(
      await coreVault.grantRole(EXTERNAL_CREDITOR_ROLE, collateralHub)
    );
  }
  if (settlementWallet) {
    roleTxs.push(await coreVault.grantRole(SETTLEMENT_ROLE, settlementWallet));
  }
  for (const orderBook of orderBooks) {
    roleTxs.push(await coreVault.grantRole(ORDERBOOK_ROLE, orderBook));
  }
  for (const tx of roleTxs) await tx.wait();

  // Register and map markets to orderbooks
  for (let i = 0; i < orderBooks.length; i++) {
    const ob = orderBooks[i];
    const mid = marketIds[i];
    const tx1 = await coreVault.registerOrderBook(ob);
    await tx1.wait();
    const tx2 = await coreVault.assignMarketToOrderBook(mid, ob);
    await tx2.wait();
    console.log("Mapped market", mid, "->", ob);
  }

  console.log("Done.");
  console.log("CoreVault:", coreVault.target);
  console.log("Factory :", factory.target);
  console.log("OB Vault Facet:", obVaultFacet.target);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

