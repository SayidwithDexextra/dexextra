#!/usr/bin/env node

/**
 * liquidation-events-monitor.js
 *
 * Lightweight event monitor for OBLiquidationFacet.
 * Shows all liquidation pipeline events with readable colors so you can keep
 * this running next to the interactive trader and watch activity live.
 *
 * Usage:
 *   npx hardhat run scripts/liquidation-events-monitor.js --network <network>
 *
 * Address resolution:
 *   1) LIQUIDATION_FACET_ADDRESS (or ORDERBOOK_ADDRESS) from .env.local/.env
 *   2) Falls back to ORDERBOOK in deployments via config/contracts.js
 */

// Prefer .env.local but allow .env fallback
try {
  const path = require("path");
  const fs = require("fs");
  const dotenv = require("dotenv");
  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.join(__dirname, "..", ".env.local"),
    path.resolve(process.cwd(), ".env"),
    path.join(__dirname, "..", ".env"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      dotenv.config({ path: p });
      break;
    }
  }
} catch (_) {
  // ignore env load issues
}

const { ethers, network } = require("hardhat");
const {
  getAddress,
  getContract,
  ADDRESSES: CONFIG_ADDRESSES,
  MARKET_INFO,
} = require("../config/contracts");

// Minimal ABI containing only events (no functions required for monitoring)
const LIQUIDATION_EVENTS_ABI = [
  "event LiquidationCheckStarted(uint256 markPrice,uint256 tradersLength,uint256 startIndex,uint256 endIndex)",
  "event LiquidationRecursionGuardSet(bool inProgress)",
  "event LiquidationTraderBeingChecked(address indexed trader,uint256 index,uint256 totalTraders)",
  "event LiquidationLiquidatableCheck(address indexed trader,bool isLiquidatable,uint256 markPrice)",
  "event AutoLiquidationTriggered(address indexed user,bytes32 indexed marketId,int256 positionSize,uint256 markPrice)",
  "event LiquidationCompleted(address indexed trader,uint256 liquidationsTriggered,string method)",
  "event LiquidationIndexUpdated(uint256 oldIndex,uint256 newIndex,uint256 tradersLength)",
  "event LiquidationCheckFinished(uint256 tradersChecked,uint256 liquidationsTriggered,uint256 nextStartIndex)",
  "event LiquidationCheckTriggered(uint256 currentMark,uint256 lastMarkPrice)",
  "event LiquidationLiquidityCheck(bool isBuy,uint256 bestOppositePrice,bool hasLiquidity)",
  "event LiquidationPriceBounds(uint256 maxPrice,uint256 minPrice)",
  "event LiquidationResync(uint256 bestBidPrice,uint256 bestAskPrice)",
  "event LiquidationMarketOrderAttempt(address indexed trader,uint256 amount,bool isBuy,uint256 markPrice)",
  "event LiquidationMarketOrderResult(address indexed trader,bool success,string reason)",
  "event LiquidationMarketOrderDiagnostics(address indexed trader,uint256 requestedAmount,uint256 filledAmount,uint256 remainingAmount,uint256 averageExecutionPrice,uint256 worstExecutionPrice,uint256 totalExecutions,bool success)",
  "event LiquidationPositionRetrieved(address indexed trader,int256 size,uint256 marginLocked,int256 unrealizedPnL)",
  "event LiquidationConfigUpdated(bool scanOnTrade,bool debug)",
  "event LiquidationSocializedLossAttempt(address indexed trader,bool isLong,string method)",
  "event LiquidationSocializedLossResult(address indexed trader,bool success,string method)",
  "event LiquidationMarginConfiscated(address indexed trader,uint256 marginAmount,uint256 penalty,address indexed liquidator)",
  "event DebugMakerContributionAdded(address indexed maker,uint256 notionalScaled,uint256 totalScaledAfter)",
  "event DebugRewardComputation(address indexed liquidatedUser,uint256 expectedPenalty,uint256 obBalance,uint256 rewardPool,uint256 makerCount,uint256 totalScaled)",
  "event DebugRewardDistributionStart(address indexed liquidatedUser,uint256 rewardAmount)",
  "event DebugMakerRewardPayOutcome(address indexed liquidatedUser,address indexed maker,uint256 amount,bool success,bytes errorData)",
  "event DebugRewardDistributionEnd(address indexed liquidatedUser)",
  "event LiquidationMarketGapDetected(address indexed trader,uint256 liquidationPrice,uint256 actualExecutionPrice,int256 positionSize,uint256 gapLoss)",
  "event LiquidationScanParamsUpdated(uint256 maxChecksPerPoke,uint256 maxLiquidationsPerPoke)",
];

// Color helpers (ANSI)
const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  blue: "\x1b[94m",
  magenta: "\x1b[95m",
  cyan: "\x1b[96m",
};

const eventColor = (name) => {
  const map = {
    AutoLiquidationTriggered: colors.red,
    LiquidationCompleted: colors.green,
    LiquidationMarketGapDetected: colors.yellow,
    LiquidationMarginConfiscated: colors.yellow,
    LiquidationMarketOrderAttempt: colors.magenta,
    LiquidationMarketOrderResult: colors.cyan,
    LiquidationMarketOrderDiagnostics: colors.yellow,
    LiquidationResync: colors.blue,
    LiquidationCheckTriggered: colors.blue,
    LiquidationCheckStarted: colors.blue,
    LiquidationCheckFinished: colors.green,
    LiquidationIndexUpdated: colors.gray,
    LiquidationRecursionGuardSet: colors.yellow,
    LiquidationConfigUpdated: colors.magenta,
    LiquidationSocializedLossAttempt: colors.magenta,
    LiquidationSocializedLossResult: colors.cyan,
    DebugMakerContributionAdded: colors.gray,
    DebugRewardComputation: colors.gray,
    DebugRewardDistributionStart: colors.gray,
    DebugRewardDistributionEnd: colors.gray,
    DebugMakerRewardPayOutcome: colors.gray,
  };
  return map[name] || colors.cyan;
};

function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

function shorten(addr = "") {
  if (typeof addr !== "string") return String(addr);
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

function formatValue(v) {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return `[${v.map(formatValue).join(", ")}]`;
  if (ethers.isAddress?.(v)) return shorten(v);
  if (v?.hash) return shorten(v.hash); // tx/event hash objects
  return String(v);
}

function logEvent(name, args, eventMeta) {
  logEvent.counter = (logEvent.counter || 0) + 1;
  const sequenceLabel = `${colors.bold}${colors.reset}${String(logEvent.counter).padStart(4, "0")}`;
  const accent = eventColor(name);
  const now = new Date().toISOString();
  const separator = `${accent}════════════════════════════════════════════════════════${colors.reset}`;
  const header = `${colorize("┌", accent)} ${colorize(name, accent)} ${colors.dim}@ ${now}${colors.reset} ${colors.bold}[#${String(logEvent.counter).padStart(4, "0")}]${colors.reset}`;
  const metaLine = `${colorize("│", accent)} tx ${shorten(eventMeta?.log?.transactionHash || eventMeta?.transactionHash || "")}  block ${eventMeta?.log?.blockNumber ?? eventMeta?.blockNumber ?? "?"}  idx ${eventMeta?.log?.logIndex ?? eventMeta?.logIndex ?? "?"}`;
  const body =
    args && Object.keys(args).length
      ? Object.entries(args)
          .map(
            ([k, v]) =>
              `${colorize("│", accent)} ${colors.bold}${k.padEnd(28)}${colors.reset} ${formatValue(v)}`
          )
          .join("\n")
      : `${colorize("│", accent)} (no args)`;
  const footer = `${colorize("└", accent)}────────────────────────────────────────────────────`;
  console.log([`\n${separator}`, header, metaLine, body, footer, separator].join("\n"));
}

async function resolveTargetAddress() {
  if (getContract?.refreshAddresses) {
    try {
      await getContract.refreshAddresses();
    } catch (e) {
      console.warn("Address refresh skipped:", e.message);
    }
  }

  // Priority:
  // 1) Config addresses (ORDERBOOK from config/contracts)
  // 2) First active MARKET_INFO orderBook
  let source = "config:ORDERBOOK";
  let candidate = getAddress("ORDERBOOK") || CONFIG_ADDRESSES?.ORDERBOOK;

  if (!candidate) {
    source = "config:MARKET_INFO";
    try {
      const markets = Object.values(MARKET_INFO || {});
      const active = markets.find((m) => m && m.active && m.orderBook);
      if (active?.orderBook) {
        candidate = active.orderBook;
        source = `config:MARKET_INFO(${active.symbol || active.name || "market"})`;
      }
    } catch (_) {}
  }

  if (!candidate || !ethers.isAddress(candidate)) {
    throw new Error(
      `No valid address for OBLiquidationFacet / ORDERBOOK. Ensure config/contracts has ORDERBOOK or MARKET_INFO entries.`
    );
  }
  return { candidate, source };
}

async function main() {
  const { candidate: address, source } = await resolveTargetAddress();
  const provider = ethers.provider;
  const iface = new ethers.Interface(LIQUIDATION_EVENTS_ABI);
  const contract = new ethers.Contract(address, iface, provider);

  console.log(
    `${colors.bold}${colors.cyan}📡 Listening for OBLiquidationFacet events…${colors.reset}`
  );
  console.log(
    `${colors.dim}network: ${network?.name || "unknown"} | contract: ${address} (source: ${source})${colors.reset}`
  );
  console.log(
    `${colors.dim}Events: ${iface.fragments
      .filter((f) => f.type === "event")
      .map((f) => f.name)
      .join(", ")}${colors.reset}`
  );
  console.log(`${colors.dim}Press Ctrl+C to stop.${colors.reset}\n`);

  // Subscribe to every event fragment
  iface.fragments
    .filter((frag) => frag.type === "event")
    .forEach((frag) => {
      contract.on(frag.name, (...params) => {
        const eventObj = params[params.length - 1];
        const argMap = {};
        frag.inputs.forEach((input, idx) => {
          argMap[input.name || `arg${idx}`] = params[idx];
        });
        logEvent(frag.name, argMap, eventObj);
      });
    });

  // Keep process alive
  process.on("SIGINT", () => {
    console.log(`\n${colors.dim}Stopping listener…${colors.reset}`);
    process.exit(0);
  });

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await new Promise((resolve) => setTimeout(resolve, 3600 * 1000));
  }
}

main().catch((error) => {
  console.error("Monitor failed:", error);
  process.exit(1);
});

