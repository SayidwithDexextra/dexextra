#!/usr/bin/env node

/**
 * resume-refactor-hub.js
 *
 * Use this when the hub step partially succeeded (e.g., RPC timeout) and you already
 * have deployed hub contracts. It will:
 *  - Attach to existing CoreVault, FuturesMarketFactory, OrderBook (ALUMINUM)
 *  - Optionally set session registry on the OrderBook
 *  - Optionally set initial mark price on the OrderBook market
 *  - Deploy a fresh CollateralHub, grant EXTERNAL_CREDITOR_ROLE, register spokes
 *  - Wire hub inbox/outbox remote apps using existing spoke inbox/outbox addresses
 *  - Save deployment snapshot to deployments/<network>-resume.json
 *
 * Required env (existing deployments):
 *  - CORE_VAULT_ADDRESS
 *  - FUTURES_MARKET_FACTORY_ADDRESS
 *  - ORDERBOOK_ADDRESS (for the market you want to wire)
 *  - ALUMINUM_MARKET_ID (for mark price update; skip if not set)
 *  - SESSION_REGISTRY_ADDRESS (optional; sets on MetaTradeFacet)
 *
 * Bridge/hub wiring:
 *  - HUB_INBOX_ADDRESS, HUB_OUTBOX_ADDRESS
 *  - SPOKE_INBOX_ADDRESS_ARBITRUM / SPOKE_OUTBOX_ADDRESS_ARBITRUM (bytes32 encoded in script)
 *  - SPOKE_INBOX_ADDRESS_POLYGON / SPOKE_OUTBOX_ADDRESS_POLYGON (optional)
 *
 * Spoke registration on new CollateralHub:
 *  - SPOKE_ARBITRUM_VAULT_ADDRESS, SPOKE_ARBITRUM_USDC_ADDRESS
 *  - SPOKE_POLYGON_VAULT_ADDRESS, SPOKE_POLYGON_USDC_ADDRESS (optional)
 *
 * CollateralHub params:
 *  - COLLATERAL_HUB_ADMIN (optional, default deployer)
 *  - CORE_VAULT_OPERATOR_ADDRESS (optional, default deployer)
 */

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env.local") });
require("dotenv").config();

function requireEnv(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

function toBytes32Address(addr) {
  if (!addr) return "0x" + "00".repeat(32);
  const hex = addr.toLowerCase().replace(/^0x/, "");
  if (hex.length !== 40) throw new Error(`Invalid EVM address: ${addr}`);
  return "0x" + "0".repeat(24) + hex;
}

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("═".repeat(80));
  console.log("Resume hub wiring (existing deployments)");
  console.log(`Network: ${network.name} (chainId=${network.chainId})`);
  console.log("Deployer:", deployer.address);

  const contracts = {};

  // Attach to existing contracts
  contracts.CORE_VAULT = requireEnv("CORE_VAULT_ADDRESS");
  contracts.FUTURES_MARKET_FACTORY = requireEnv(
    "FUTURES_MARKET_FACTORY_ADDRESS"
  );
  contracts.ALUMINUM_ORDERBOOK = requireEnv("ORDERBOOK_ADDRESS");

  const coreVault = await ethers.getContractAt(
    "CoreVault",
    contracts.CORE_VAULT
  );
  const factory = await ethers.getContractAt(
    "FuturesMarketFactory",
    contracts.FUTURES_MARKET_FACTORY
  );
  const orderbook = await ethers.getContractAt(
    "MetaTradeFacet",
    contracts.ALUMINUM_ORDERBOOK
  );

  // Session registry wiring
  const sessionRegistry =
    process.env.SESSION_REGISTRY_ADDRESS ||
    process.env.REGISTRY ||
    process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS;
  if (sessionRegistry) {
    try {
      console.log("🔗 Setting session registry on OrderBook:", sessionRegistry);
      const tx = await orderbook.setSessionRegistry(sessionRegistry);
      await tx.wait();
      console.log("   ✅ Session registry set");
    } catch (e) {
      console.log("   ⚠️ Session registry set failed:", e?.message || e);
    }
  } else {
    console.log("ℹ️  Session registry not provided; skipping");
  }

  // Optional mark price
  const marketId = process.env.ALUMINUM_MARKET_ID || process.env.MARKET_ID;
  if (marketId) {
    try {
      const price = ethers.parseUnits("1", 6);
      const tx = await coreVault.updateMarkPrice(marketId, price);
      await tx.wait();
      console.log("📊 Mark price set to $1 on market:", marketId);
    } catch (e) {
      console.log("⚠️ Mark price update failed:", e?.message || e);
    }
  } else {
    console.log("ℹ️  MARKET_ID not provided; skipping mark price");
  }

  // Deploy new CollateralHub
  console.log("\n🏦 Deploying CollateralHub (fresh)...");
  const CollateralHub = await ethers.getContractFactory("CollateralHub");
  const hubAdmin = process.env.COLLATERAL_HUB_ADMIN || deployer.address;
  const hubOperator =
    process.env.CORE_VAULT_OPERATOR_ADDRESS || deployer.address;
  const collateralHub = await CollateralHub.deploy(
    hubAdmin,
    contracts.CORE_VAULT,
    hubOperator
  );
  await collateralHub.waitForDeployment();
  contracts.COLLATERAL_HUB = await collateralHub.getAddress();
  console.log("   ✅ CollateralHub:", contracts.COLLATERAL_HUB);

  // Grant role
  await coreVault.grantRole(
    ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE")),
    contracts.COLLATERAL_HUB
  );
  console.log("   ✅ EXTERNAL_CREDITOR_ROLE granted to CollateralHub");

  // Register spokes
  const spokePolyVault = process.env.SPOKE_POLYGON_VAULT_ADDRESS;
  const spokePolyUsdc = process.env.SPOKE_POLYGON_USDC_ADDRESS;
  const spokePolyChainId = Number(process.env.SPOKE_POLYGON_CHAIN_ID || 137);
  if (spokePolyVault && spokePolyUsdc) {
    try {
      const tx = await collateralHub.registerSpoke(spokePolyChainId, {
        spokeVault: spokePolyVault,
        usdc: spokePolyUsdc,
        enabled: true,
      });
      await tx.wait();
      console.log(
        `   ✅ Polygon spoke registered: ${spokePolyVault} (chainId=${spokePolyChainId})`
      );
    } catch (e) {
      console.log("   ⚠️ Polygon spoke registration failed:", e?.message || e);
    }
  } else {
    console.log("   ℹ️ Polygon spoke not provided; skipping");
  }

  const spokeArbVault = process.env.SPOKE_ARBITRUM_VAULT_ADDRESS;
  const spokeArbUsdc = process.env.SPOKE_ARBITRUM_USDC_ADDRESS;
  const spokeArbChainId = Number(process.env.SPOKE_ARBITRUM_CHAIN_ID || 42161);
  if (spokeArbVault && spokeArbUsdc) {
    try {
      const tx = await collateralHub.registerSpoke(spokeArbChainId, {
        spokeVault: spokeArbVault,
        usdc: spokeArbUsdc,
        enabled: true,
      });
      await tx.wait();
      console.log(
        `   ✅ Arbitrum spoke registered: ${spokeArbVault} (chainId=${spokeArbChainId})`
      );
    } catch (e) {
      console.log("   ⚠️ Arbitrum spoke registration failed:", e?.message || e);
    }
  } else {
    console.log("   ℹ️ Arbitrum spoke not provided; skipping");
  }

  // Hub remote-app wiring
  const hubInboxAddr = process.env.HUB_INBOX_ADDRESS;
  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS;
  if (hubInboxAddr && hubOutboxAddr) {
    try {
      console.log("\n🔗 Wiring hub inbox/outbox remote apps...");
      const hubInbox = await ethers.getContractAt(
        "HubBridgeInboxWormhole",
        hubInboxAddr
      );
      const hubOutbox = await ethers.getContractAt(
        "HubBridgeOutboxWormhole",
        hubOutboxAddr
      );

      const domainPolygon = process.env.BRIDGE_DOMAIN_POLYGON;
      const remoteAppPolygon =
        process.env.BRIDGE_REMOTE_APP_POLYGON ||
        (process.env.SPOKE_OUTBOX_ADDRESS_POLYGON
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_POLYGON)
          : process.env.SPOKE_OUTBOX_ADDRESS
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS)
          : null);
      if (domainPolygon && remoteAppPolygon) {
        await (
          await hubInbox.setRemoteApp(Number(domainPolygon), remoteAppPolygon)
        ).wait();
        console.log(
          `   ✅ HUB_INBOX: set POLYGON remote app ${remoteAppPolygon}`
        );
      }
      const polygonInbox = process.env.SPOKE_INBOX_ADDRESS_POLYGON
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_POLYGON)
        : process.env.SPOKE_INBOX_ADDRESS
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS)
        : null;
      if (domainPolygon && polygonInbox) {
        await (
          await hubOutbox.setRemoteApp(Number(domainPolygon), polygonInbox)
        ).wait();
        console.log(`   ✅ HUB_OUTBOX: set POLYGON inbox ${polygonInbox}`);
      }

      const domainArbitrum = process.env.BRIDGE_DOMAIN_ARBITRUM;
      const remoteAppArbitrum =
        process.env.BRIDGE_REMOTE_APP_ARBITRUM ||
        (process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM
          ? toBytes32Address(process.env.SPOKE_OUTBOX_ADDRESS_ARBITRUM)
          : null);
      if (domainArbitrum && remoteAppArbitrum) {
        await (
          await hubInbox.setRemoteApp(Number(domainArbitrum), remoteAppArbitrum)
        ).wait();
        console.log(
          `   ✅ HUB_INBOX: set ARBITRUM remote app ${remoteAppArbitrum}`
        );
      }
      const arbitrumInbox = process.env.SPOKE_INBOX_ADDRESS_ARBITRUM
        ? toBytes32Address(process.env.SPOKE_INBOX_ADDRESS_ARBITRUM)
        : null;
      if (domainArbitrum && arbitrumInbox) {
        await (
          await hubOutbox.setRemoteApp(Number(domainArbitrum), arbitrumInbox)
        ).wait();
        console.log(`   ✅ HUB_OUTBOX: set ARBITRUM inbox ${arbitrumInbox}`);
      }
    } catch (e) {
      console.log("   ⚠️ Hub bridge wiring failed:", e?.message || e);
    }
  } else {
    console.log(
      "ℹ️ HUB_INBOX_ADDRESS/HUB_OUTBOX_ADDRESS not provided; skipping wiring"
    );
  }

  // Save snapshot
  const outPath = path.join(
    __dirname,
    `../deployments/${network.name || network.chainId}-resume-deployment.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(contracts, null, 2));
  console.log(`\n📝 Saved deployment -> ${outPath}`);
  console.log("\n✅ Resume hub wiring complete.");
}

main().catch((err) => {
  console.error("❌ Resume failed:", err);
  process.exit(1);
});








