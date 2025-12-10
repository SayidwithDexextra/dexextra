#!/usr/bin/env node

/**
 * resume-wire-hub-existing.js
 *
 * Wire an existing hub stack without deploying a new CollateralHub.
 * - Attaches to existing CoreVault, FuturesMarketFactory, OrderBook.
 * - Optionally sets session registry on OrderBook.
 * - Optionally sets mark price on the market.
 * - Grants EXTERNAL_CREDITOR_ROLE to an existing CollateralHub (if desired).
 * - Registers provided spokes on the existing CollateralHub.
 * - Wires hub inbox/outbox remote apps to existing spoke inbox/outbox addresses.
 * - Saves snapshot to deployments/<network>-resume-wire.json
 *
 * Required env:
 *   CORE_VAULT_ADDRESS
 *   FUTURES_MARKET_FACTORY_ADDRESS
 *   ORDERBOOK_ADDRESS
 *   COLLATERAL_HUB_ADDRESS
 *
 * Optional env:
 *   ALUMINUM_MARKET_ID (or MARKET_ID) for mark price
 *   SESSION_REGISTRY_ADDRESS (or REGISTRY / NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS)
 *
 * Spokes (Arbitrum required for registration; Polygon optional):
 *   SPOKE_ARBITRUM_VAULT_ADDRESS, SPOKE_ARBITRUM_USDC_ADDRESS
 *   SPOKE_POLYGON_VAULT_ADDRESS, SPOKE_POLYGON_USDC_ADDRESS (optional)
 *
 * Hub bridge wiring:
 *   HUB_INBOX_ADDRESS, HUB_OUTBOX_ADDRESS
 *   SPOKE_INBOX_ADDRESS_ARBITRUM / SPOKE_OUTBOX_ADDRESS_ARBITRUM
 *   SPOKE_INBOX_ADDRESS_POLYGON / SPOKE_OUTBOX_ADDRESS_POLYGON (optional)
 *   BRIDGE_DOMAIN_ARBITRUM, BRIDGE_DOMAIN_POLYGON (as applicable)
 */

const { ethers } = require("hardhat");
const minimist = require("minimist");
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
  const argv = minimist(process.argv.slice(2));

  // Optional CLI overrides (flags take precedence over env)
  const ORDERBOOK_OVERRIDE = argv.orderbook || argv.ob;
  const CORE_VAULT_OVERRIDE = argv.coreVault || argv.core || argv.cv;
  const FACTORY_OVERRIDE = argv.factory || argv.fm || argv.fmf;
  const COLLATERAL_HUB_OVERRIDE = argv.collateralHub || argv.hub || argv.ch;
  const MARKET_ID_OVERRIDE = argv.marketId || argv.mid;
  const SESSION_REGISTRY_OVERRIDE =
    argv.sessionRegistry || argv.registry || argv.sr;

  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();
  console.log("═".repeat(80));
  console.log("Resume wiring (existing hub + existing CollateralHub)");
  console.log(`Network: ${network.name} (chainId=${network.chainId})`);
  console.log("Deployer:", deployer.address);

  const contracts = {};
  contracts.CORE_VAULT =
    CORE_VAULT_OVERRIDE || requireEnv("CORE_VAULT_ADDRESS");
  contracts.FUTURES_MARKET_FACTORY =
    FACTORY_OVERRIDE || requireEnv("FUTURES_MARKET_FACTORY_ADDRESS");
  contracts.ALUMINUM_ORDERBOOK =
    ORDERBOOK_OVERRIDE || requireEnv("ORDERBOOK_ADDRESS");
  contracts.COLLATERAL_HUB =
    COLLATERAL_HUB_OVERRIDE || requireEnv("COLLATERAL_HUB_ADDRESS");

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
  const collateralHub = await ethers.getContractAt(
    "CollateralHub",
    contracts.COLLATERAL_HUB
  );

  // Session registry wiring
  const sessionRegistry =
    SESSION_REGISTRY_OVERRIDE ||
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
  const marketId =
    MARKET_ID_OVERRIDE ||
    process.env.ALUMINUM_MARKET_ID ||
    process.env.MARKET_ID;
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

  // Grant role on existing CollateralHub
  try {
    await coreVault.grantRole(
      ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE")),
      contracts.COLLATERAL_HUB
    );
    console.log(
      "   ✅ EXTERNAL_CREDITOR_ROLE granted to existing CollateralHub"
    );
  } catch (e) {
    console.log("   ⚠️ Grant role skipped/failed:", e?.message || e);
  }

  // Register spokes on existing CollateralHub
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
    `../deployments/${network.name || network.chainId}-resume-wire.json`
  );
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(contracts, null, 2));
  console.log(`\n📝 Saved deployment -> ${outPath}`);
  console.log("\n✅ Resume wiring complete (no new CollateralHub deployed).");
}

main().catch((err) => {
  console.error("❌ Resume failed:", err);
  process.exit(1);
});




