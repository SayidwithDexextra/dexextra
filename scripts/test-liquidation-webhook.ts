#!/usr/bin/env npx tsx
/**
 * Interactive test script for the liquidation-direct-webhook edge function.
 *
 * Loads markets + open positions from Supabase, lets you pick a market
 * and position, then crafts a properly ABI-encoded webhook payload.
 *
 * Usage:
 *   npx tsx scripts/test-liquidation-webhook.ts
 */

import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { createClient } from "@supabase/supabase-js";
import {
  createPublicClient,
  encodeAbiParameters,
  encodeEventTopics,
  http,
  parseAbiItem,
  toHex,
} from "viem";

// ─── Load .env.local ───

function loadEnv() {
  const envPath = path.resolve(__dirname, "..", ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("  .env.local not found at", envPath);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  const env: Record<string, string> = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx < 0) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    const commentIdx = val.indexOf(" #");
    if (commentIdx > 0) val = val.slice(0, commentIdx).trim();
    env[key] = val;
  }
  return env;
}

const env = loadEnv();

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || "";
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY || "";
const RPC_URL = env.RPC_URL || env.HYPERLIQUID_RPC_URL || "";
const CORE_VAULT = env.CORE_VAULT_ADDRESS || env.NEXT_PUBLIC_CORE_VAULT_ADDRESS || "";
const EDGE_FN_URL = `${SUPABASE_URL}/functions/v1/liquidation-direct-webhook`;

let SIGNING_KEY = env.LIQUIDATION_DIRECT_SIGN_IN_KEY || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── On-chain client ───

const CORE_VAULT_ABI = [
  parseAbiItem(
    "function getLiquidationPrice(address user, bytes32 marketId) view returns (uint256 liquidationPrice, bool hasPosition)"
  ),
  parseAbiItem(
    "function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)"
  ),
];

function getPublicClient() {
  if (!RPC_URL) return null;
  return createPublicClient({ transport: http(RPC_URL) });
}

// ─── ABI event definitions ───

const TRADE_RECORDED_EVENT = parseAbiItem(
  "event TradeRecorded(bytes32 indexed marketId, address indexed buyer, address indexed seller, uint256 price, uint256 amount, uint256 buyerFee, uint256 sellerFee, uint256 timestamp, uint256 liquidationPrice)"
);

const PRICE_UPDATED_EVENT = parseAbiItem(
  "event PriceUpdated(uint256 lastTradePrice, uint256 currentMarkPrice)"
);

const LIQUIDATION_COMPLETED_EVENT = parseAbiItem(
  "event LiquidationCompleted(address indexed trader, uint256 liquidationsTriggered, string method, int256 startSize, int256 remainingSize)"
);

// ─── Data types ───

interface MarketInfo {
  id: string;
  name: string;
  symbol: string;
  market_id_bytes32: string;
  market_address: string;
  last_trade_price: string | null;
}

interface PositionInfo {
  user_wallet_address: string;
  market_id: string;
  amount: string;
  liquidation_price: string;
  price: string | null;
}

// ─── Supabase data loaders ───

async function loadMarketsWithPositions(): Promise<
  (MarketInfo & { position_count: number })[]
> {
  const { data: positions } = await supabase
    .from("user_trades")
    .select("market_id")
    .neq("amount", "0");

  if (!positions || !positions.length) return [];

  const marketIds = [...new Set(positions.map((p: any) => p.market_id))];
  const countMap = new Map<string, number>();
  for (const p of positions) {
    countMap.set(p.market_id, (countMap.get(p.market_id) || 0) + 1);
  }

  const { data: markets } = await supabase
    .from("markets")
    .select("id, name, symbol, market_id_bytes32, market_address, last_trade_price")
    .in("id", marketIds);

  if (!markets) return [];

  return markets
    .map((m: any) => ({
      ...m,
      position_count: countMap.get(m.id) || 0,
    }))
    .sort((a: any, b: any) => b.position_count - a.position_count);
}

async function loadPositionsForMarket(
  marketId: string
): Promise<PositionInfo[]> {
  const { data } = await supabase
    .from("user_trades")
    .select("user_wallet_address, market_id, amount, liquidation_price, price")
    .eq("market_id", marketId)
    .neq("amount", "0");

  return (data || []) as PositionInfo[];
}

// ─── On-chain verification ───

async function verifyOnChain(
  wallet: string,
  marketHex: string
): Promise<{
  hasPosition: boolean;
  size: bigint | null;
  entryPrice: bigint | null;
  liqPrice: bigint | null;
} | null> {
  const client = getPublicClient();
  if (!client || !CORE_VAULT) return null;

  try {
    const [size, entryPrice] = (await client.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getPositionSummary",
      args: [wallet as `0x${string}`, marketHex as `0x${string}`],
    })) as [bigint, bigint, bigint];

    const [liqPrice, hasPos] = (await client.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getLiquidationPrice",
      args: [wallet as `0x${string}`, marketHex as `0x${string}`],
    })) as [bigint, boolean];

    return {
      hasPosition: hasPos && size !== 0n,
      size,
      entryPrice,
      liqPrice,
    };
  } catch (e: any) {
    console.log(`  On-chain check failed: ${e.message}`);
    return null;
  }
}

// ─── Formatting ───

function formatRawPrice(raw: bigint, decimals = 6): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const fracPart = v % base;
  const fracStr = fracPart.toString().padStart(decimals, "0").replace(/0+$/, "");
  const num = fracStr ? `${intPart}.${fracStr}` : intPart.toString();
  return neg ? `-${num}` : num;
}

function parseDecimalToRaw(val: string, decimals = 6): bigint {
  const neg = val.startsWith("-");
  const clean = neg ? val.slice(1) : val;
  const [i, f = ""] = clean.split(".");
  const fPadded = (f + "0".repeat(decimals)).slice(0, decimals);
  const bi = BigInt(i || "0") * 10n ** BigInt(decimals) + BigInt(fPadded || "0");
  return neg ? -bi : bi;
}

// ─── Payload builders ───

function buildPriceUpdatedPayload(
  market: MarketInfo,
  markPriceRaw: bigint
) {
  const lastTrade = markPriceRaw - 10000n; // slightly below mark

  const topics = encodeEventTopics({
    abi: [PRICE_UPDATED_EVENT],
    eventName: "PriceUpdated",
  });

  const data = encodeAbiParameters(
    [{ type: "uint256" }, { type: "uint256" }],
    [lastTrade > 0n ? lastTrade : 0n, markPriceRaw]
  );

  return {
    event: {
      activity: [
        {
          log: {
            address: market.market_address,
            topics: [...topics],
            data,
            logIndex: 0,
          },
          hash: toHex(crypto.randomBytes(32)),
          toAddress: market.market_address,
          fromAddress: market.market_address,
        },
      ],
    },
  };
}

function buildTradeRecordedPayload(
  market: MarketInfo,
  buyer: string,
  seller: string,
  priceRaw: bigint,
  amountRaw: bigint
) {
  const timestamp = BigInt(Math.floor(Date.now() / 1000));

  const topics = encodeEventTopics({
    abi: [TRADE_RECORDED_EVENT],
    eventName: "TradeRecorded",
    args: {
      marketId: market.market_id_bytes32 as `0x${string}`,
      buyer: buyer as `0x${string}`,
      seller: seller as `0x${string}`,
    },
  });

  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
      { type: "uint256" },
    ],
    [priceRaw, amountRaw, 0n, 0n, timestamp, 0n]
  );

  return {
    event: {
      activity: [
        {
          log: {
            address: market.market_address,
            topics: [...topics],
            data,
            logIndex: 0,
          },
          hash: toHex(crypto.randomBytes(32)),
          toAddress: market.market_address,
          fromAddress: market.market_address,
        },
      ],
    },
  };
}

function buildLiquidationCompletedPayload(
  market: MarketInfo,
  trader: string,
  remainingSize: bigint
) {
  const topics = encodeEventTopics({
    abi: [LIQUIDATION_COMPLETED_EVENT],
    eventName: "LiquidationCompleted",
    args: { trader: trader as `0x${string}` },
  });

  const data = encodeAbiParameters(
    [
      { type: "uint256" },
      { type: "string" },
      { type: "int256" },
      { type: "int256" },
    ],
    [1n, "direct", 1_000_000_000_000_000_000n, remainingSize]
  );

  return {
    event: {
      activity: [
        {
          log: {
            address: market.market_address,
            topics: [...topics],
            data,
            logIndex: 0,
          },
          hash: toHex(crypto.randomBytes(32)),
          toAddress: market.market_address,
          fromAddress: market.market_address,
        },
      ],
    },
  };
}

// ─── HMAC signing ───

function signPayload(body: string, key: string): string {
  return crypto.createHmac("sha256", key).update(body).digest("hex");
}

// ─── Interactive prompts ───

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string): Promise<string> {
  return new Promise((resolve) => rl.question(question, resolve));
}

async function sendRequest(
  method: "GET" | "POST",
  body?: string,
  signature?: string
) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (signature) headers["x-alchemy-signature"] = signature;

  const opts: RequestInit = { method, headers };
  if (body && method === "POST") opts.body = body;

  console.log(`\n  Sending ${method} to ${EDGE_FN_URL}`);
  if (signature) console.log(`  Signature: ${signature.slice(0, 20)}...`);

  const start = Date.now();
  try {
    const res = await fetch(EDGE_FN_URL, opts);
    const elapsed = Date.now() - start;
    const text = await res.text();
    console.log(`\n  Status: ${res.status} ${res.statusText} (${elapsed}ms)`);
    try {
      const json = JSON.parse(text);
      console.log("  Response:\n" + JSON.stringify(json, null, 2));
    } catch {
      console.log("  Response (raw):\n" + text.slice(0, 3000));
    }
  } catch (e: any) {
    console.error("  Request failed:", e.message);
  }
}

async function confirmAndSend(payload: any) {
  if (!SIGNING_KEY.trim()) {
    console.log("  No signing key set. Cannot send POST requests.");
    return;
  }

  const bodyStr = JSON.stringify(payload);
  const sig = signPayload(bodyStr, SIGNING_KEY);

  console.log("\n  Payload preview:");
  const preview = JSON.stringify(payload, null, 2);
  if (preview.length > 1500) {
    console.log(preview.slice(0, 1500) + "\n  ... (truncated)");
  } else {
    console.log(preview);
  }
  console.log(`\n  Body size: ${bodyStr.length} bytes`);

  const c = await ask("\nSend this request? (y/n): ");
  if (c.toLowerCase() === "y") {
    await sendRequest("POST", bodyStr, sig);
  } else {
    console.log("  Skipped.");
  }
}

// ─── Market picker ───

async function pickMarket(): Promise<MarketInfo | null> {
  console.log("\n  Loading markets with open positions from Supabase...\n");
  const markets = await loadMarketsWithPositions();

  if (!markets.length) {
    console.log("  No markets with open positions found.");
    return null;
  }

  console.log("  Markets with open positions:\n");
  for (let i = 0; i < markets.length; i++) {
    const m = markets[i];
    const price = m.last_trade_price ? `$${m.last_trade_price}` : "n/a";
    console.log(
      `  [${i + 1}] ${m.name || m.symbol || "Unnamed"}`
    );
    console.log(
      `      ${m.position_count} position(s) | Last: ${price} | ${m.market_address.slice(0, 10)}...`
    );
  }
  console.log(`  [b] Back\n`);

  const choice = (await ask("Pick a market: ")).trim();
  if (choice === "b") return null;

  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx >= markets.length) {
    console.log("  Invalid choice.");
    return null;
  }

  return markets[idx];
}

// ─── Position picker ───

async function pickPosition(
  market: MarketInfo
): Promise<PositionInfo | null> {
  console.log(
    `\n  Loading positions for ${market.name || market.symbol}...\n`
  );
  const positions = await loadPositionsForMarket(market.id);

  if (!positions.length) {
    console.log("  No open positions found.");
    return null;
  }

  console.log("  Open positions:\n");
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const amt = parseFloat(p.amount);
    const dir = amt > 0 ? "LONG" : "SHORT";
    const liq = p.liquidation_price || "n/a";
    console.log(
      `  [${i + 1}] ${p.user_wallet_address.slice(0, 10)}...${p.user_wallet_address.slice(-4)}`
    );
    console.log(
      `      ${dir} ${Math.abs(amt).toFixed(4)} | Liq: $${liq} | Entry: $${p.price || "n/a"}`
    );
  }
  console.log(`  [a] All positions (PriceUpdated triggers check on all)`);
  console.log(`  [b] Back\n`);

  const choice = (await ask("Pick a position: ")).trim();
  if (choice === "b") return null;
  if (choice === "a") return null; // caller handles "all"

  const idx = parseInt(choice, 10) - 1;
  if (idx < 0 || idx >= positions.length) {
    console.log("  Invalid choice.");
    return null;
  }

  return positions[idx];
}

// ─── Main menu scenarios ───

async function scenarioHealthCheck() {
  const c = await ask("Send GET health check? (y/n): ");
  if (c.toLowerCase() === "y") await sendRequest("GET");
}

async function scenarioPriceUpdate() {
  const market = await pickMarket();
  if (!market) return;

  console.log(`\n  Selected: ${market.name}`);
  console.log(`  Last trade price: $${market.last_trade_price || "unknown"}`);
  console.log(`  Market address: ${market.market_address}`);

  // Show positions so user knows what liq prices to target
  const positions = await loadPositionsForMarket(market.id);
  if (positions.length) {
    console.log(`\n  Positions that will be checked:\n`);
    for (const p of positions) {
      const amt = parseFloat(p.amount);
      const dir = amt > 0 ? "LONG" : "SHORT";
      const liqTrigger =
        amt > 0 ? `mark <= $${p.liquidation_price}` : `mark >= $${p.liquidation_price}`;
      console.log(
        `    ${p.user_wallet_address.slice(0, 10)}... | ${dir} ${Math.abs(amt).toFixed(4)} | Liq triggers when ${liqTrigger}`
      );
    }
  }

  console.log(`\n  Price is in dollars (e.g. 3.50, 10.05, 95000)`);
  const priceStr = await ask("Enter mark price ($): ");
  const markPriceRaw = parseDecimalToRaw(priceStr.trim() || "0");

  if (markPriceRaw <= 0n) {
    console.log("  Invalid price.");
    return;
  }

  console.log(`  Mark price (raw): ${markPriceRaw} = $${formatRawPrice(markPriceRaw)}`);

  const payload = buildPriceUpdatedPayload(market, markPriceRaw);
  await confirmAndSend(payload);
}

async function scenarioLiquidatePosition() {
  const market = await pickMarket();
  if (!market) return;

  const position = await pickPosition(market);
  if (!position) return;

  const amt = parseFloat(position.amount);
  const dir = amt > 0 ? "LONG" : "SHORT";

  console.log(`\n  Selected position:`);
  console.log(`    Wallet: ${position.user_wallet_address}`);
  console.log(`    Direction: ${dir} ${Math.abs(amt).toFixed(4)}`);
  console.log(`    Liq price: $${position.liquidation_price}`);

  // On-chain verification
  console.log(`\n  Checking on-chain state...`);
  const onchain = await verifyOnChain(
    position.user_wallet_address,
    market.market_id_bytes32
  );

  if (onchain) {
    console.log(`    On-chain position exists: ${onchain.hasPosition}`);
    if (onchain.size !== null)
      console.log(`    On-chain size: ${formatRawPrice(onchain.size, 18)}`);
    if (onchain.entryPrice !== null)
      console.log(`    On-chain entry: $${formatRawPrice(onchain.entryPrice)}`);
    if (onchain.liqPrice !== null)
      console.log(`    On-chain liq price: $${formatRawPrice(onchain.liqPrice)}`);

    if (!onchain.hasPosition) {
      console.log(
        `\n  WARNING: Position does NOT exist on-chain. The webhook will`
      );
      console.log(
        `  reconcile the DB (set amount to 0) but won't try to liquidate.`
      );
    }
  } else {
    console.log(`    Could not verify on-chain (no RPC or CORE_VAULT configured).`);
  }

  // Determine the mark price that would trigger liquidation
  const liqPriceRaw = parseDecimalToRaw(position.liquidation_price);
  let suggestedMark: bigint;
  if (amt > 0) {
    // Long: liquidates when mark <= liqPrice
    suggestedMark = liqPriceRaw - 100000n; // $0.10 below liq price
  } else {
    // Short: liquidates when mark >= liqPrice
    suggestedMark = liqPriceRaw + 100000n; // $0.10 above liq price
  }

  console.log(
    `\n  Suggested mark price to trigger liquidation: $${formatRawPrice(suggestedMark)}`
  );
  console.log(
    `  (${dir} liq triggers when mark ${amt > 0 ? "<=" : ">="} $${position.liquidation_price})\n`
  );

  const priceStr = await ask(
    `Enter mark price ($ or Enter for $${formatRawPrice(suggestedMark)}): `
  );
  const markPriceRaw = priceStr.trim()
    ? parseDecimalToRaw(priceStr.trim())
    : suggestedMark;

  console.log(`  Mark price: $${formatRawPrice(markPriceRaw)}`);

  const shouldTrigger =
    amt > 0 ? markPriceRaw <= liqPriceRaw : markPriceRaw >= liqPriceRaw;
  console.log(
    `  Will this trigger liquidation? ${shouldTrigger ? "YES" : "NO (mark price not past liq threshold)"}`
  );

  const payload = buildPriceUpdatedPayload(market, markPriceRaw);
  await confirmAndSend(payload);
}

async function scenarioVerifyOnChain() {
  const market = await pickMarket();
  if (!market) return;

  const position = await pickPosition(market);
  if (!position) return;

  console.log(`\n  Verifying on-chain state for:`);
  console.log(`    Wallet: ${position.user_wallet_address}`);
  console.log(`    Market: ${market.name}`);
  console.log(`    DB amount: ${position.amount}`);
  console.log(`    DB liq price: $${position.liquidation_price}\n`);

  const onchain = await verifyOnChain(
    position.user_wallet_address,
    market.market_id_bytes32
  );

  if (!onchain) {
    console.log("  Could not check on-chain. Is RPC_URL and CORE_VAULT_ADDRESS set?");
    return;
  }

  console.log(`  On-chain results:`);
  console.log(`    Has position: ${onchain.hasPosition}`);
  console.log(
    `    Size: ${onchain.size !== null ? formatRawPrice(onchain.size, 18) : "null"}`
  );
  console.log(
    `    Entry price: ${onchain.entryPrice !== null ? "$" + formatRawPrice(onchain.entryPrice) : "null"}`
  );
  console.log(
    `    Liq price: ${onchain.liqPrice !== null ? "$" + formatRawPrice(onchain.liqPrice) : "null"}`
  );

  // Compare DB vs on-chain
  if (onchain.size !== null) {
    const dbAmtRaw = parseDecimalToRaw(position.amount, 18);
    if (dbAmtRaw !== onchain.size) {
      console.log(`\n  DRIFT DETECTED:`);
      console.log(`    DB:      ${formatRawPrice(dbAmtRaw, 18)}`);
      console.log(`    Chain:   ${formatRawPrice(onchain.size, 18)}`);
      console.log(
        `    Delta:   ${formatRawPrice(onchain.size - dbAmtRaw, 18)}`
      );
    } else {
      console.log(`\n  DB and on-chain are IN SYNC.`);
    }
  }
}

async function scenarioEnqueueRetry() {
  const market = await pickMarket();
  if (!market) return;

  const position = await pickPosition(market);
  if (!position) return;

  console.log(`\n  Enqueuing into liq_queue:`);
  console.log(`    Wallet: ${position.user_wallet_address}`);
  console.log(`    Market: ${market.market_id_bytes32}`);

  const c = await ask("\nEnqueue this for retry? (y/n): ");
  if (c.toLowerCase() !== "y") return;

  const { data, error } = await supabase.rpc("enqueue_liq_job", {
    p_address: position.user_wallet_address.toLowerCase(),
    p_market_id: market.market_id_bytes32.toLowerCase(),
    p_chain_id: 999,
    p_error: "manual_test_enqueue",
    p_priority: 10,
  });

  if (error) {
    console.log(`  Enqueue failed: ${error.message}`);
  } else {
    console.log(`  Enqueued! Job ID: ${data}`);
    console.log(
      `\n  Now invoke the retry worker:\n  curl -X POST ${SUPABASE_URL}/functions/v1/liquidation-retry-worker -H "Authorization: Bearer ${SUPABASE_KEY.slice(0, 20)}..." -H "Content-Type: application/json" -d '{}'`
    );

    const invoke = await ask("\nInvoke retry worker now? (y/n): ");
    if (invoke.toLowerCase() === "y") {
      console.log("  Invoking retry worker...");
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/liquidation-retry-worker`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${SUPABASE_KEY}`,
            },
            body: "{}",
          }
        );
        const text = await res.text();
        console.log(`\n  Status: ${res.status}`);
        try {
          console.log("  Response:\n" + JSON.stringify(JSON.parse(text), null, 2));
        } catch {
          console.log("  Response:\n" + text.slice(0, 2000));
        }
      } catch (e: any) {
        console.log(`  Failed: ${e.message}`);
      }
    }
  }
}

async function scenarioQueueStatus() {
  console.log("\n  Checking liq_queue status...\n");

  const { data, error } = await supabase
    .from("liq_queue")
    .select("id, address, market_id, status, attempts, last_error, earliest_run_at, priority, tx_hash")
    .order("id", { ascending: false })
    .limit(15);

  if (error) {
    console.log(`  Error: ${error.message}`);
    return;
  }

  if (!data || !data.length) {
    console.log("  Queue is empty.");
    return;
  }

  console.log(`  ${data.length} job(s) in queue:\n`);
  for (const job of data) {
    const statusIcon =
      job.status === "done" ? "[DONE]" :
      job.status === "failed" ? "[FAIL]" :
      job.status === "processing" ? "[....]" :
      "[WAIT]";
    console.log(
      `  ${statusIcon} #${job.id} | ${(job.address as string).slice(0, 10)}... | attempts: ${job.attempts} | priority: ${job.priority}`
    );
    if (job.last_error)
      console.log(`         error: ${(job.last_error as string).slice(0, 80)}`);
    if (job.tx_hash) console.log(`         tx: ${job.tx_hash}`);
  }
}

async function scenarioBadSignature() {
  const payload = { event: { activity: [] } };
  const bodyStr = JSON.stringify(payload);
  console.log("\n  Sending with an INVALID signature (should get 401)...");
  const c = await ask("Send? (y/n): ");
  if (c.toLowerCase() === "y") {
    await sendRequest("POST", bodyStr, "deadbeef".repeat(8));
  }
}

// ─── Main ───

const SCENARIOS = [
  { key: "1", name: "Health Check (GET)", run: scenarioHealthCheck },
  {
    key: "2",
    name: "Trigger Liquidation (pick market + position)",
    run: scenarioLiquidatePosition,
  },
  {
    key: "3",
    name: "Price Update (pick market, enter mark price)",
    run: scenarioPriceUpdate,
  },
  {
    key: "4",
    name: "Verify On-Chain State (DB vs chain comparison)",
    run: scenarioVerifyOnChain,
  },
  {
    key: "5",
    name: "Enqueue for Retry + invoke worker",
    run: scenarioEnqueueRetry,
  },
  { key: "6", name: "View liq_queue status", run: scenarioQueueStatus },
  { key: "7", name: "Bad Signature Test (401)", run: scenarioBadSignature },
];

async function main() {
  console.log("============================================================");
  console.log("  Liquidation Direct Webhook — Interactive Tester");
  console.log("============================================================");
  console.log(`  Endpoint   : ${EDGE_FN_URL}`);
  console.log(`  Supabase   : ${SUPABASE_URL}`);
  console.log(`  RPC        : ${RPC_URL ? RPC_URL.slice(0, 40) + "..." : "NOT SET"}`);
  console.log(`  CoreVault  : ${CORE_VAULT || "NOT SET"}`);
  console.log("============================================================\n");

  if (!SIGNING_KEY) {
    console.log("  LIQUIDATION_DIRECT_SIGN_IN_KEY not found in .env.local");
    console.log("  This is set as a Supabase Edge Function secret.\n");
    SIGNING_KEY = await ask("Enter the signing key (or Enter for GET-only mode): ");
    if (!SIGNING_KEY.trim()) {
      console.log("  No signing key — POST scenarios will be limited.\n");
    } else {
      console.log("");
    }
  } else {
    console.log("  Signing key loaded.\n");
  }

  while (true) {
    console.log("\n--- Scenarios ---\n");
    for (const s of SCENARIOS) {
      console.log(`  [${s.key}] ${s.name}`);
    }
    console.log("  [q] Quit\n");

    const choice = (await ask("Pick: ")).trim();
    if (choice === "q" || choice === "quit") {
      console.log("\nDone.\n");
      break;
    }

    const scenario = SCENARIOS.find((s) => s.key === choice);
    if (!scenario) {
      console.log("  Invalid choice.");
      continue;
    }

    console.log(`\n>> ${scenario.name}\n`);

    try {
      await scenario.run();
    } catch (e: any) {
      console.log(`  Error: ${e.message}`);
    }
  }

  rl.close();
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
