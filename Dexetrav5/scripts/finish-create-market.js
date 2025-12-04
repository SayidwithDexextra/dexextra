#!/usr/bin/env node

// finish-create-market.js - Resume and finalize market setup after create script interruption
//
// Use this if create-market.js succeeded in deploying the market but failed while granting roles
// or saving to DB. This script:
// - Resolves CoreVault and the new OrderBook
// - Grants ORDERBOOK_ROLE and SETTLEMENT_ROLE to the OrderBook (idempotent)
// - Optionally re-applies trading params and disables leverage (idempotent)
// - Saves the market via the Next.js API (/api/markets/save) when symbol provided
// - Updates deployments/{network}-deployment.json (upsert)
//
// Examples:
//   npx hardhat --config Dexetrav5/hardhat.config.js \
//     run Dexetrav5/scripts/finish-create-market.js --network hyperliquid -- \
//     --symbol Silver223-USD \
//     --orderbook 0xEF260fd6bf6CC9A3D740913909D043e3f38bAFF4 \
//     --market-id 0xd2a4ab0f58e96328c0b7dc80eeedd11d11cd336f787739ff51663bb1bbc4c09b \
//     --treasury 0x84b1e48e10D6326eD70a1947AaABF49AC8e290C7 \
//     --margin-bps 10000 --fee-bps 0 --disable-leverage
//
// Notes:
// - Robust nonce/fee handling is used to avoid "replacement transaction underpriced".
// - No core contract (vault/factory) redeployments; addresses come from env/deployments/config.

const path = require("path");
const fs = require("fs");
const { ethers } = require("hardhat");

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (
    idx !== -1 &&
    process.argv[idx + 1] &&
    !String(process.argv[idx + 1]).startsWith("--")
  ) {
    return process.argv[idx + 1];
  }
  return fallback;
}

function getBool(flag, fallback = false) {
  return process.argv.includes(flag) ? true : fallback;
}

function toBps(input, defaultValue) {
  if (input === undefined || input === null) return defaultValue;
  const n = Number(input);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : defaultValue;
}

function readEnvAny(names) {
  for (const n of names) {
    const v = process.env[n];
    if (v && String(v).trim()) return String(v).trim();
  }
  return undefined;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 12000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await (
      await import("node-fetch")
    ).default(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

async function getTxOverrides() {
  try {
    const fee = await ethers.provider.getFeeData();
    const minPriority = ethers.parseUnits("2", "gwei");
    const minMax = ethers.parseUnits("20", "gwei");
    if (fee.maxFeePerGas && fee.maxPriorityFeePerGas) {
      const maxPriority =
        fee.maxPriorityFeePerGas > minPriority
          ? fee.maxPriorityFeePerGas
          : minPriority;
      let maxFee = fee.maxFeePerGas + maxPriority;
      if (maxFee < minMax) maxFee = minMax;
      return { maxFeePerGas: maxFee, maxPriorityFeePerGas: maxPriority };
    }
    const base = fee.gasPrice || ethers.parseUnits("10", "gwei");
    const bumped = (base * 12n) / 10n; // +20%
    const minLegacy = ethers.parseUnits("20", "gwei");
    return { gasPrice: bumped > minLegacy ? bumped : minLegacy };
  } catch (_) {
    return { gasPrice: ethers.parseUnits("20", "gwei") };
  }
}

// Simple nonce manager to avoid accidental nonce reuse and to bump fees between sends
async function createNonceManager(signer) {
  const address = await signer.getAddress();
  let next = await signer.provider.getTransactionCount(address, "pending");
  let lastMaxFee = 0n;
  let lastPriority = 0n;
  return {
    async nextOverrides() {
      const fee = await getTxOverrides();
      let ov = { ...fee, nonce: next };
      // Ensure we always bump fees slightly vs previous send (if EIP-1559)
      if (ov.maxFeePerGas && ov.maxPriorityFeePerGas) {
        let maxFee = ov.maxFeePerGas;
        let maxPr = ov.maxPriorityFeePerGas;
        if (lastMaxFee && maxFee <= lastMaxFee) {
          maxFee = (lastMaxFee * 115n) / 100n; // +15%
        }
        if (lastPriority && maxPr <= lastPriority) {
          maxPr = (lastPriority * 115n) / 100n;
        }
        ov.maxFeePerGas = maxFee;
        ov.maxPriorityFeePerGas = maxPr;
        lastMaxFee = maxFee;
        lastPriority = maxPr;
      } else if (ov.gasPrice) {
        // legacy
        ov.gasPrice = (ov.gasPrice * 115n) / 100n;
      }
      next += 1;
      return ov;
    },
  };
}

function sanitizeSymbolForKey(symbol) {
  try {
    return String(symbol)
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_");
  } catch {
    return "MARKET";
  }
}

async function main() {
  console.log("\n🔚 FINISH CREATE MARKET");
  console.log("═".repeat(80));

  // Inputs
  const symbol = process.env.SYMBOL || getArg("--symbol");
  const explicitOrderBook = process.env.ORDERBOOK || getArg("--orderbook");
  const explicitMarketId = process.env.MARKET_ID || getArg("--market-id");
  const marginBps = toBps(
    process.env.MARGIN_BPS ?? getArg("--margin-bps"),
    10000
  );
  const feeBps = toBps(process.env.FEE_BPS ?? getArg("--fee-bps"), 0);
  const treasury = process.env.TREASURY || getArg("--treasury") || null;
  const disableLeverage =
    (process.env.DISABLE_LEVERAGE ?? null) !== null
      ? String(process.env.DISABLE_LEVERAGE) !== "false"
      : getBool("--disable-leverage", true);
  const switchInteractive =
    (process.env.SWITCH_INTERACTIVE ?? null) !== null
      ? String(process.env.SWITCH_INTERACTIVE) !== "false"
      : getBool("--switch-interactive", true);

  // Market init data for DB save (optional)
  const metricUrl =
    process.env.METRIC_URL || getArg("--metric-url") || "https://example.com";
  const startPriceStr =
    process.env.START_PRICE || getArg("--start-price") || "1";
  const startPrice6 = ethers.parseUnits(String(startPriceStr), 6);
  const settlementDate = Number(
    process.env.SETTLEMENT_DATE ||
      getArg("--settlement-date") ||
      Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60
  );
  const dataSource =
    process.env.DATA_SOURCE || getArg("--data-source") || "User Provided";
  const tagsCsv = process.env.TAGS || getArg("--tags") || "";
  const tags = tagsCsv
    ? tagsCsv
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    : [];

  // Network resolution
  const network = await ethers.provider.getNetwork();
  const rawNetworkName = process.env.HARDHAT_NETWORK || "unknown";
  const normalizedName = (() => {
    const n = String(rawNetworkName || "").toLowerCase();
    if (
      n === "hyperliquid_mainnet" ||
      n === "hyperliquid-mainnet" ||
      n === "hl" ||
      n === "hl_mainnet" ||
      n === "hl-mainnet"
    )
      return "hyperliquid";
    if (n === "hyperliquid-testnet" || n === "hl_testnet" || n === "hl-testnet")
      return "hyperliquid_testnet";
    return n;
  })();
  let effectiveNetworkName = normalizedName;
  if (
    (effectiveNetworkName === "hardhat" ||
      effectiveNetworkName === "unknown") &&
    Number(network.chainId) === 31337
  ) {
    effectiveNetworkName = "localhost";
  } else if (Number(network.chainId) === 999) {
    effectiveNetworkName = "hyperliquid";
  } else if (Number(network.chainId) === 998) {
    effectiveNetworkName = "hyperliquid_testnet";
  }
  console.log(
    `🌐 Network: ${effectiveNetworkName} (Chain ID: ${network.chainId})`
  );
  if (symbol) console.log(`🪙 Symbol: ${symbol}`);

  let signer = (await ethers.getSigners())[0];
  if (!signer) {
    const fallbackPk =
      process.env.PRIVATE_KEY ||
      process.env.PRIVATE_KEY_DEPLOYER ||
      "0x980c05d9a10efe7e226cc7e3c5d132fe5e612eff43c315d26a6f8051ea733746";
    if (!fallbackPk) {
      throw new Error(
        "No signer available. Set PRIVATE_KEY or PRIVATE_KEY_DEPLOYER in env."
      );
    }
    signer = new ethers.Wallet(fallbackPk, ethers.provider);
  }
  const nonceMgr = await createNonceManager(signer);
  console.log("👤 Signer:", await signer.getAddress());

  // Deployment file
  const deploymentPath = path.join(
    __dirname,
    `../deployments/${effectiveNetworkName}-deployment.json`
  );
  console.log(
    "📁 Deployment file:",
    path.relative(process.cwd(), deploymentPath)
  );
  let deployment = {};
  try {
    if (fs.existsSync(deploymentPath))
      deployment = JSON.parse(fs.readFileSync(deploymentPath, "utf8"));
  } catch (_) {}
  deployment.contracts = deployment.contracts || {};
  deployment.markets = Array.isArray(deployment.markets)
    ? deployment.markets
    : [];

  // Resolve core contracts
  let coreVault;
  try {
    const envCoreVault =
      process.env.CORE_VAULT_ADDRESS ||
      process.env.CORE_VAULT ||
      deployment?.contracts?.CORE_VAULT;
    if (envCoreVault) {
      coreVault = await ethers.getContractAt("CoreVault", envCoreVault, signer);
      console.log("🔗 Using CoreVault:", envCoreVault);
    } else {
      const { getContract } = require("../config/contracts");
      coreVault = (await getContract("CORE_VAULT")).connect(signer);
      console.log(
        "🔗 Using CoreVault from config:",
        await coreVault.getAddress()
      );
    }
  } catch (_) {
    const { getContract } = require("../config/contracts");
    coreVault = (await getContract("CORE_VAULT")).connect(signer);
    console.log(
      "🔗 Using CoreVault from config:",
      await coreVault.getAddress()
    );
  }
  const coreVaultAddr = await coreVault.getAddress();

  // Resolve OrderBook + MarketId
  let orderBook = explicitOrderBook || null;
  let marketId = explicitMarketId || null;
  if ((!orderBook || !marketId) && symbol) {
    const entry = deployment.markets.find((m) => m?.symbol === symbol);
    if (entry) {
      orderBook = orderBook || entry.orderBook;
      marketId = marketId || entry.marketId;
    }
  }
  if (!orderBook) orderBook = deployment?.defaultMarket?.orderBook || null;
  if (!marketId) marketId = deployment?.defaultMarket?.marketId || null;

  if (!orderBook || !ethers.isAddress(orderBook)) {
    throw new Error(
      "OrderBook address required. Pass --orderbook or ensure deployments contain it."
    );
  }
  if (!marketId) {
    throw new Error(
      "Market ID required. Pass --market-id or ensure deployments contain it."
    );
  }

  console.log("🏷️  Target Market");
  console.log("  • OrderBook:", orderBook);
  console.log("  • Market ID:", marketId);

  // OB admin tweaks (optional, idempotent)
  try {
    const obAdmin = await ethers.getContractAt(
      "OBAdminFacet",
      orderBook,
      signer
    );
    console.log("\n⚙️  Ensuring OB trading params...");
    try {
      const tx = await obAdmin.updateTradingParameters(
        marginBps,
        feeBps,
        treasury || coreVaultAddr,
        await nonceMgr.nextOverrides()
      );
      console.log("  • updateTradingParameters sent:", tx.hash);
      await tx.wait();
      console.log("  ✅ Trading parameters updated");
    } catch (e) {
      console.log(
        "  ⚠️ updateTradingParameters failed (continuing):",
        e?.message || e
      );
    }
    if (disableLeverage) {
      try {
        const tx2 = await obAdmin.disableLeverage(
          await nonceMgr.nextOverrides()
        );
        console.log("  • disableLeverage sent:", tx2.hash);
        await tx2.wait();
        console.log("  ✅ Leverage disabled (or already off)");
      } catch (e) {
        console.log(
          "  ⚠️ disableLeverage failed (continuing):",
          e?.message || e
        );
      }
    }
  } catch (e) {
    console.log(
      "  ⚠️ OB admin attach failed (skipping admin tweaks):",
      e?.message || e
    );
  }

  // Roles on CoreVault (idempotent, with explicit nonce/fee bumping)
  console.log("\n🔒 Ensuring CoreVault roles...");
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  try {
    const hasOb = await coreVault.hasRole(ORDERBOOK_ROLE, orderBook);
    if (hasOb) {
      console.log("  ✅ ORDERBOOK_ROLE already granted");
    } else {
      const tx1 = await coreVault.grantRole(
        ORDERBOOK_ROLE,
        orderBook,
        await nonceMgr.nextOverrides()
      );
      console.log("  • grant ORDERBOOK_ROLE sent:", tx1.hash);
      await tx1.wait();
      console.log("  ✅ Granted ORDERBOOK_ROLE");
    }
  } catch (e) {
    console.log("  ❌ grant ORDERBOOK_ROLE failed:", e?.message || e);
    throw e;
  }
  try {
    const hasSettle = await coreVault.hasRole(SETTLEMENT_ROLE, orderBook);
    if (hasSettle) {
      console.log("  ✅ SETTLEMENT_ROLE already granted");
    } else {
      const tx2 = await coreVault.grantRole(
        SETTLEMENT_ROLE,
        orderBook,
        await nonceMgr.nextOverrides()
      );
      console.log("  • grant SETTLEMENT_ROLE sent:", tx2.hash);
      await tx2.wait();
      console.log("  ✅ Granted SETTLEMENT_ROLE");
    }
  } catch (e) {
    console.log("  ❌ grant SETTLEMENT_ROLE failed:", e?.message || e);
    throw e;
  }

  // Optional: save market via API if symbol is available
  if (symbol) {
    try {
      const baseUrl = (
        process.env.APP_URL ||
        process.env.NEXT_PUBLIC_APP_URL ||
        "http://localhost:3000"
      ).replace(/\/$/, "");
      console.log("\n🗄️  Saving market via API...");
      const resp = await fetchWithTimeout(
        `${baseUrl}/api/markets/save`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            marketIdentifier: symbol,
            symbol,
            name: `${(symbol.split("-")[0] || symbol).toUpperCase()} Futures`,
            description: `OrderBook market for ${symbol}`,
            category: Array.isArray(tags) && tags.length ? tags[0] : "CUSTOM",
            decimals: Number(process.env.DEFAULT_MARKET_DECIMALS || 8),
            minimumOrderSize: Number(
              process.env.DEFAULT_MINIMUM_ORDER_SIZE || 0.1
            ),
            settlementDate,
            tradingEndDate: null,
            dataRequestWindowSeconds: Number(
              process.env.DEFAULT_DATA_REQUEST_WINDOW_SECONDS || 3600
            ),
            autoSettle: true,
            oracleProvider: null,
            initialOrder: {
              metricUrl,
              startPrice: String(ethers.formatUnits(startPrice6, 6)),
              dataSource,
              tags,
            },
            chainId: Number(network.chainId),
            networkName: effectiveNetworkName,
            creatorWalletAddress: await signer.getAddress(),
            marketAddress: orderBook,
            marketIdBytes32: marketId,
            transactionHash: null,
            blockNumber: null,
            gasUsed: null,
          }),
        },
        12000
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err?.error || `HTTP ${resp.status}`);
      }
      console.log("  ✅ Market saved via API");
    } catch (e) {
      console.log("  ⚠️ Save via API failed (continuing):", e?.message || e);
    }
  } else {
    console.log("\nℹ️  No --symbol provided; skipping API save.");
  }

  // Update deployments file
  console.log("\n📝 Updating deployment file...");
  deployment.network = effectiveNetworkName;
  deployment.chainId = Number(network.chainId);
  deployment.timestamp = new Date().toISOString();
  deployment.contracts = deployment.contracts || {};

  if (symbol) {
    const keyBase = sanitizeSymbolForKey(symbol.split("-")[0] || symbol);
    deployment.contracts[`${keyBase}_ORDERBOOK`] = orderBook;
    deployment.contracts[`${keyBase}_MARKET_ID`] = marketId;
  }

  // Upsert market entry
  if (symbol) {
    const marketEntry = {
      symbol,
      marketId,
      orderBook,
      metricUrl,
      settlementDate,
      startPrice: startPrice6.toString(),
      dataSource,
      tags,
    };
    const idx = deployment.markets.findIndex((m) => m.symbol === symbol);
    if (idx >= 0)
      deployment.markets[idx] = { ...deployment.markets[idx], ...marketEntry };
    else deployment.markets.push(marketEntry);
  }

  if (switchInteractive) {
    deployment.defaultMarket = {
      symbol: symbol || deployment.defaultMarket?.symbol || "",
      marketId,
      orderBook,
    };
    deployment.contracts.ORDERBOOK = orderBook;
    deployment.contracts.MARKET_ID = marketId;
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(deployment, null, 2));
  console.log(
    "  ✅ Deployment updated:",
    path.relative(process.cwd(), deploymentPath)
  );

  // Optional: update config/contracts.js ORDERBOOK pointer
  if (switchInteractive) {
    try {
      const configPath = path.join(__dirname, "../config/contracts.js");
      let content = fs.readFileSync(configPath, "utf8");
      if (/ORDERBOOK:\s*"0x[a-fA-F0-9]+"/.test(content)) {
        content = content.replace(
          /ORDERBOOK:\s*"0x[a-fA-F0-9]+"/g,
          `ORDERBOOK: "${orderBook}"`
        );
      } else {
        content = content.replace(
          /CONTRACT_ADDRESSES\s*=\s*\{([\s\S]*?)\n\s*\};/m,
          (m, inner) =>
            `CONTRACT_ADDRESSES = {${inner}\n  ORDERBOOK: "${orderBook}",\n};`
        );
      }
      fs.writeFileSync(configPath, content);
      console.log("  ✅ Updated config/contracts.js ORDERBOOK →", orderBook);
    } catch (e) {
      console.log(
        "  ⚠️ Could not update config/contracts.js ORDERBOOK:",
        e?.message || e
      );
    }
  }

  console.log("\n✅ Finish complete.");
  console.log("═".repeat(80));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n❌ finish-create-market failed:", e?.message || e);
    process.exit(1);
  });
