#!/usr/bin/env node
/**
 * test-liquidations-supabase.js
 *
 * Comprehensive liquidation scenario runner for Hyperliquid mainnet OrderBook markets.
 *
 * Goals:
 * - Pull active factory-made markets from Supabase `markets` table
 * - For each (or a selected) market, run:
 *   1) Maker posts bid liquidity
 *   2) Victim opens a SHORT by selling into that bid (margin trade)
 *   3) LP posts ask ladder; pusher consumes asks + posts higher bids
 *   4) Mark price rises to victim liquidation price
 *   5) (Intentionally) do NOT trigger liquidation: this script only places the orders and reports state
 *
 * IMPORTANT:
 * - This script DOES NOT deploy anything.
 * - This script reads market addresses from Supabase.
 * - It expects you to provide funded private keys for mainnet usage.
 *
 * Run (from repo root):
 *   npx hardhat --config Dexetrav5/hardhat.config.js \
 *     run Dexetrav5/scripts/test-liquidations-supabase.js --network hyperliquid -- \
 *     --symbol ALU-USD --dry-run
 *
 * Suggested env vars (.env.local):
 * - SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY / SUPABASE_SERVICE_KEY (preferred for scripts)
 * - CORE_VAULT_ADDRESS
 * - COLLATERAL_TOKEN_ADDRESS (or MOCK_USDC_ADDRESS for localhost)
 * - PRIVATE_KEY_USER2, PRIVATE_KEY_USER3, PRIVATE_KEY_USER5 (and/or PRIVATE_KEY_USERD)
 *
 * CLI flags (all optional unless noted):
 * - --symbol <SYMBOL>                 Target a single market (e.g. ALU-USD)
 * - --network-name <name>             Filter Supabase markets.network (defaults to HARDHAT_NETWORK)
 * - --victim <user2|user3|user5|addr> Victim identity (default user2)
 * - --maker <user2|user3|user5|addr>  Maker (posts initial bid) (default user3)
 * - --lp <user2|user3|user5|addr>     Liquidity provider (posts asks) (default user5)
 * - --pusher <user2|user3|user5|addr> Price pusher (default user3)
 * - --dry-run                         Print actions without sending transactions
 *
 * Notes:
 * - Amounts are 18-decimal "units" (position size)
 * - Prices are 6-decimal (USDC precision)
 */

const path = require("path");
const fs = require("fs");

// Load env from common locations so Hardhat scripts can see Next.js .env.local
try {
  require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });
  require("dotenv").config({ path: path.join(process.cwd(), ".env") });
  require("dotenv").config({ path: path.join(__dirname, "../.env.local") });
  require("dotenv").config({ path: path.join(__dirname, "../.env") });
} catch (_) {}

const { ethers } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");
const readline = require("readline");

// Node fetch helper (Node 18+ has global fetch; fallback to node-fetch if available)
function getFetch() {
  if (typeof globalThis.fetch === "function")
    return globalThis.fetch.bind(globalThis);
  try {
    // eslint-disable-next-line global-require
    return require("node-fetch");
  } catch {
    throw new Error(
      "Missing fetch implementation. Use Node 18+ or install node-fetch."
    );
  }
}

function getArg(flag, fallback) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  return fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

async function ask(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) =>
    rl.question(question, (ans) => {
      rl.close();
      resolve(String(ans || "").trim());
    })
  );
}

async function askConfirm(question, defaultYes = false) {
  const suffix = defaultYes ? " (Y/n): " : " (y/N): ";
  const ans = (await ask(question + suffix)).toLowerCase();
  if (!ans) return defaultYes;
  return ans === "y" || ans === "yes";
}

async function promptContinueIfInteractive(interactiveConfirm, message) {
  if (!interactiveConfirm) return true;
  const ok = await askConfirm(`${message}\nContinue?`, true);
  return ok;
}

async function askNumber(
  question,
  { min = null, max = null, fallback = null } = {}
) {
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const raw = await ask(question);
    const v = raw ? Number(raw) : fallback;
    if (!Number.isFinite(v)) {
      console.log("  ⚠️ Please enter a valid number.");
      continue;
    }
    if (min != null && v < min) {
      console.log(`  ⚠️ Must be >= ${min}`);
      continue;
    }
    if (max != null && v > max) {
      console.log(`  ⚠️ Must be <= ${max}`);
      continue;
    }
    return v;
  }
}

async function chooseFromList(title, options, { allowQuit = true } = {}) {
  if (!Array.isArray(options) || options.length === 0) {
    throw new Error(`No options available for: ${title}`);
  }
  console.log(`\n${title}`);
  options.forEach((o, i) =>
    console.log(`${String(i + 1).padStart(2)}) ${o.label}`)
  );
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ans = await ask(
      `Select 1-${options.length}${allowQuit ? " (or q)" : ""}: `
    );
    if (allowQuit && ans.toLowerCase() === "q") return null;
    const idx = Number(ans) - 1;
    if (Number.isInteger(idx) && idx >= 0 && idx < options.length)
      return options[idx].value;
    console.log("  ⚠️ Invalid selection.");
  }
}

function toNum(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function isAddress(a) {
  try {
    return ethers.isAddress(a);
  } catch {
    return typeof a === "string" && /^0x[0-9a-fA-F]{40}$/.test(a);
  }
}

function isBytes32(v) {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

function fmt6(x) {
  try {
    return ethers.formatUnits(x, 6);
  } catch {
    return String(x);
  }
}

function fmt18(x) {
  try {
    return ethers.formatUnits(x, 18);
  } catch {
    return String(x);
  }
}

function parseQty18(qtyHuman) {
  const s = String(qtyHuman);
  return ethers.parseUnits(s, 18);
}

function parsePrice6(priceHuman) {
  const s = String(priceHuman);
  return ethers.parseUnits(s, 6);
}

// Fixed scenario constants (as requested)
const SIZE_10_UNITS = ethers.parseUnits("10", 18);
const SIZE_15_UNITS = ethers.parseUnits("15", 18);
const SIZE_1_UNIT = ethers.parseUnits("1", 18);
const MAKER_BUY_COUNT = 2;

function readEnvAny(keys) {
  try {
    const search = Array.isArray(keys) ? keys : [String(keys || "")];
    for (const baseKey of search) {
      if (!baseKey) continue;
      const variants = [baseKey, `NEXT_PUBLIC_${baseKey}`];
      for (const k of variants) {
        const v = process.env[k];
        if (v != null && String(v).trim().length > 0) return String(v).trim();
      }
    }
  } catch (_) {}
  return null;
}

function pickSupabaseKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    null
  );
}

function getSupabase() {
  const url = readEnvAny(["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"]);
  const key = pickSupabaseKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

function shortAddr(a) {
  const s = String(a || "");
  return s.startsWith("0x") && s.length === 42
    ? `${s.slice(0, 6)}…${s.slice(-4)}`
    : s;
}

function safeAddressFromPrivateKey(pkMaybe) {
  try {
    if (!pkMaybe) return null;
    const pkRaw = String(pkMaybe).trim();
    if (!pkRaw) return null;
    const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
    // No provider needed to derive the public address.
    return new ethers.Wallet(pk).address;
  } catch {
    return null;
  }
}

function safeAddressFromEnvVars(envVarNames) {
  const names = Array.isArray(envVarNames)
    ? envVarNames.map(String)
    : [String(envVarNames || "")];
  for (const name of names) {
    if (!name) continue;
    const addr = safeAddressFromPrivateKey(process.env[name]);
    if (addr) return { address: addr, source: name, missingAll: false };
  }
  return {
    address: null,
    source: names.filter(Boolean).join(" / "),
    missingAll: true,
  };
}

function formatUserChoiceLabel({ key, nick, envVars }) {
  const { address, source, missingAll } = safeAddressFromEnvVars(envVars);
  const addrPart = address ? ` — ${shortAddr(address)}` : "";
  const envPart = missingAll ? `${source} missing` : source;
  return `${key} — ${nick}${addrPart} (${envPart})`;
}

function resolveRelayerBaseUrl() {
  const raw =
    process.env.GASLESS_RELAYER_URL ||
    process.env.RELAYER_URL ||
    process.env.APP_URL ||
    "http://localhost:3000";
  return String(raw).replace(/\/$/, "");
}

function requireEnv(name) {
  const v = process.env[name];
  if (v == null || String(v).trim().length === 0) {
    throw new Error(`Missing required env: ${name}`);
  }
  return String(v).trim();
}

function gaslessDomainForOrderBook(orderBook, chainId) {
  return {
    name: "DexetraMeta",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: String(orderBook),
  };
}

function gaslessTypesForMethod(method) {
  switch (method) {
    case "metaPlaceLimit":
      return {
        PlaceLimit: [
          { name: "trader", type: "address" },
          { name: "price", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "isBuy", type: "bool" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    case "metaPlaceMarginLimit":
      return {
        PlaceMarginLimit: [
          { name: "trader", type: "address" },
          { name: "price", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "isBuy", type: "bool" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    case "metaPlaceMarket":
      return {
        PlaceMarket: [
          { name: "trader", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "isBuy", type: "bool" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    case "metaPlaceMarginMarket":
      return {
        PlaceMarginMarket: [
          { name: "trader", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "isBuy", type: "bool" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    case "metaModifyOrder":
      return {
        ModifyOrder: [
          { name: "trader", type: "address" },
          { name: "orderId", type: "uint256" },
          { name: "price", type: "uint256" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    case "metaCancelOrder":
      return {
        CancelOrder: [
          { name: "trader", type: "address" },
          { name: "orderId", type: "uint256" },
          { name: "deadline", type: "uint256" },
          { name: "nonce", type: "uint256" },
        ],
      };
    default:
      return null;
  }
}

function serializeBigints(v) {
  if (typeof v === "bigint") return v.toString();
  if (Array.isArray(v)) return v.map(serializeBigints);
  if (v && typeof v === "object") {
    const out = {};
    for (const [k, val] of Object.entries(v)) out[k] = serializeBigints(val);
    return out;
  }
  return v;
}

async function httpGetJson(url) {
  const fetchImpl = getFetch();
  const res = await fetchImpl(url, { method: "GET" });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = json?.error || text || `http ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

async function httpPostJson(url, body) {
  const fetchImpl = getFetch();
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = {};
  }
  if (!res.ok) {
    const err = json?.error || text || `http ${res.status}`;
    throw new Error(String(err));
  }
  return json;
}

async function fetchMetaNonce({ relayerBase, orderBook, trader }) {
  const url = `${relayerBase}/api/gasless/nonce?orderBook=${orderBook}&trader=${trader}`;
  const json = await httpGetJson(url);
  return BigInt(json?.nonce ?? "0");
}

async function fetchSessionNonce({ relayerBase, trader }) {
  const url = `${relayerBase}/api/gasless/session/nonce?trader=${trader}`;
  const json = await httpGetJson(url);
  return BigInt(json?.nonce ?? "0");
}

function computeSessionId({ trader, relayer, sessionSalt }) {
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "address", "bytes32"],
      [trader, relayer, sessionSalt]
    )
  );
}

function randomBytes32() {
  return ethers.hexlify(ethers.randomBytes(32));
}

function defaultMethodsBitmapHex() {
  // Enable bits 0..5 (place limit/margin limit/market/margin market/modify/cancel)
  const v =
    (1n << 0n) | (1n << 1n) | (1n << 2n) | (1n << 3n) | (1n << 4n) | (1n << 5n);
  return `0x${v.toString(16).padStart(64, "0")}`;
}

async function ensureSessionForUser({
  dryRun,
  relayerBase,
  chainId,
  user,
  orderBook,
  sessionCache,
}) {
  const k = String(user.address).toLowerCase();
  if (sessionCache[k]) return sessionCache[k];
  const relayerAddress = requireEnv("RELAYER_ADDRESS");
  if (!isAddress(relayerAddress))
    throw new Error("RELAYER_ADDRESS is not a valid address");
  const registryAddress = requireEnv("SESSION_REGISTRY_ADDRESS");
  if (!isAddress(registryAddress))
    throw new Error("SESSION_REGISTRY_ADDRESS is not a valid address");

  const now = Math.floor(Date.now() / 1000);
  // Keep simple: 24h sessions by default.
  const expiry = BigInt(now + 86400);
  const nonce = await fetchSessionNonce({ relayerBase, trader: user.address });
  const sessionSalt = randomBytes32();
  const methodsBitmap = defaultMethodsBitmapHex();
  const allowedMarkets = []; // keep empty for now
  const maxNotionalPerTrade = 0n;
  const maxNotionalPerSession = 0n;
  const permit = {
    trader: user.address,
    relayer: relayerAddress,
    expiry: expiry.toString(),
    maxNotionalPerTrade: maxNotionalPerTrade.toString(),
    maxNotionalPerSession: maxNotionalPerSession.toString(),
    methodsBitmap: String(methodsBitmap),
    sessionSalt,
    allowedMarkets,
    nonce: nonce.toString(),
  };
  const types = {
    SessionPermit: [
      { name: "trader", type: "address" },
      { name: "relayer", type: "address" },
      { name: "expiry", type: "uint256" },
      { name: "maxNotionalPerTrade", type: "uint256" },
      { name: "maxNotionalPerSession", type: "uint256" },
      { name: "methodsBitmap", type: "bytes32" },
      { name: "sessionSalt", type: "bytes32" },
      { name: "allowedMarkets", type: "bytes32[]" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const domain = {
    name: "DexetraMeta",
    version: "1",
    chainId: Number(chainId),
    verifyingContract: registryAddress,
  };
  const expectedSessionId = computeSessionId({
    trader: user.address,
    relayer: relayerAddress,
    sessionSalt,
  });

  logStep("session_prepare", "success", {
    label: user.label,
    trader: user.address,
    orderBook,
    registry: registryAddress,
    relayer: relayerAddress,
    nonce: nonce.toString(),
    expiry: expiry.toString(),
    sessionId: expectedSessionId,
    dryRun,
  });

  if (dryRun) {
    sessionCache[k] = expectedSessionId;
    return expectedSessionId;
  }
  if (!user.wallet) {
    throw new Error(
      `User ${user.label} missing private key (cannot sign session permit)`
    );
  }
  const signature = await user.wallet.signTypedData(domain, types, permit);
  const json = await httpPostJson(`${relayerBase}/api/gasless/session/init`, {
    permit,
    signature,
  });
  const sessionId = json?.sessionId || expectedSessionId;
  logStep("session_init", "success", {
    label: user.label,
    sessionId,
    tx: json?.txHash,
  });
  sessionCache[k] = sessionId;
  return sessionId;
}

async function relayMetaTrade({
  dryRun,
  relayerBase,
  chainId,
  orderBook,
  method,
  user,
  message,
}) {
  // Legacy meta flow intentionally removed to keep this script simple.
  void dryRun;
  void relayerBase;
  void chainId;
  void orderBook;
  void method;
  void user;
  void message;
  throw new Error(
    "Meta (per-trade signature) gasless flow is disabled in this script. Use session mode via /api/gasless/session/init + session* methods."
  );
}

async function relaySessionTrade({
  dryRun,
  relayerBase,
  orderBook,
  method,
  sessionId,
  params,
}) {
  if (dryRun) {
    logStep("relay_session_trade", "success", {
      method,
      dryRun: true,
      sessionId,
    });
    return { txHash: null };
  }
  const json = await httpPostJson(`${relayerBase}/api/gasless/trade`, {
    orderBook,
    method,
    sessionId,
    params: serializeBigints(params),
  });
  return { txHash: json?.txHash || null };
}

// ---------- Logging (human-first) ----------
const COLORS = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  gray: "\x1b[90m",
  red: "\x1b[91m",
  green: "\x1b[92m",
  yellow: "\x1b[93m",
  blue: "\x1b[94m",
};

function colorize(text, color) {
  return `${color}${text}${COLORS.reset}`;
}

function shouldEmitJsonLogs() {
  // If not TTY (piped to file/jq), default to JSON for machines.
  if (!process.stdout.isTTY) return true;
  return String(process.env.LIQ_TEST_JSON_LOGS || "").toLowerCase() === "true";
}

function safeOneLine(v, maxLen = 220) {
  try {
    const s = String(v ?? "");
    const one = s.replace(/\s+/g, " ").trim();
    return one.length > maxLen ? `${one.slice(0, maxLen - 1)}…` : one;
  } catch {
    return "";
  }
}

function formatKvs(obj) {
  try {
    if (!obj || typeof obj !== "object") return "";
    const order = [
      "symbol",
      "round",
      "marketId",
      "orderBook",
      "markPrice",
      "markAfter",
      "liqPrice",
      "price",
      "qty",
      "tx",
      "method",
      "dryRun",
      "error",
    ];
    const keys = Array.from(new Set([...order, ...Object.keys(obj)])).filter(
      (k) => obj[k] !== undefined && obj[k] !== null && obj[k] !== ""
    );
    const parts = [];
    for (const k of keys) {
      const val = obj[k];
      if (typeof val === "object" && val !== null) {
        parts.push(`${k}=${safeOneLine(JSON.stringify(val), 160)}`);
      } else {
        parts.push(`${k}=${safeOneLine(val, 160)}`);
      }
    }
    return parts.join(" ");
  } catch {
    return "";
  }
}

function logStep(step, status, data) {
  try {
    const ts = new Date().toISOString();
    const payload = {
      area: "test_liquidations",
      step,
      status,
      timestamp: ts,
    };
    if (data && typeof data === "object") Object.assign(payload, data);

    // Human-friendly log line (default for TTY)
    const icon = status === "success" ? "✓" : status === "error" ? "✗" : "•";
    const color =
      status === "success"
        ? COLORS.green
        : status === "error"
        ? COLORS.red
        : COLORS.yellow;
    const tag = `${COLORS.bold}[liq-test]${COLORS.reset}`;
    const stepCol = String(step).padEnd(22).slice(0, 22);
    const statusCol = String(status).padEnd(7).slice(0, 7);
    const kvs = formatKvs(data);
    const human = `${tag} ${colorize(`${icon} ${statusCol}`, color)} ${colorize(
      stepCol,
      COLORS.blue
    )} ${COLORS.dim}${kvs}${COLORS.reset}`.trimEnd();
    if (process.stdout.isTTY) console.log(human);

    // Optional structured JSON logs (for piping/ingestion)
    if (shouldEmitJsonLogs()) {
      console.log(JSON.stringify(payload));
    }
  } catch (_) {}
}

function resolveUserRef(refRaw) {
  const ref = String(refRaw || "").trim();
  const nicknameByKey = {
    user2: "SayidWithDextera",
    user3: "U3Marlon",
    user4: "MikeLeveler",
    user5: "U5RottenMango",
    admin: "UserDx2",
  };
  const envMap = {
    user2: process.env.PRIVATE_KEY_USER2,
    user3: process.env.PRIVATE_KEY_USER3,
    user4: process.env.PRIVATE_KEY_USER4,
    user5: process.env.PRIVATE_KEY_USER5,
    admin: process.env.PRIVATE_KEY_USERD || process.env.ADMIN_PRIVATE_KEY,
  };
  if (ref.toLowerCase() in envMap) {
    const pk = envMap[ref.toLowerCase()];
    if (!pk) throw new Error(`Missing env private key for '${ref}'`);
    return { kind: "pk", value: pk };
  }
  if (isAddress(ref)) return { kind: "addr", value: ref };
  // treat as env var name holding a private key
  const maybePk = process.env[ref];
  if (maybePk) return { kind: "pk", value: maybePk };
  throw new Error(
    `Unknown user reference '${ref}'. Use user2|user3|user5|admin or an address or env-var name.`
  );
}

async function buildWallet(ref, provider, fallbackSigner) {
  if (ref.kind === "addr") {
    // No private key → cannot send tx. We'll only allow this in --dry-run.
    return { address: ref.value, wallet: null };
  }
  const pkRaw = String(ref.value);
  const pk = pkRaw.startsWith("0x") ? pkRaw : `0x${pkRaw}`;
  const w = new ethers.Wallet(pk, provider);
  return { address: await w.getAddress(), wallet: w };
}

async function loadDeploymentJson(networkName) {
  try {
    const p = path.join(
      __dirname,
      `../deployments/${networkName}-deployment.json`
    );
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (_) {}
  return null;
}

async function fetchMarketsFromSupabase({ symbol, networkName }) {
  const supabase = getSupabase();
  if (!supabase)
    throw new Error(
      "Supabase not configured (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY or anon key)"
    );

  logStep("supabase_fetch", "start", {
    symbol: symbol || null,
    networkName: networkName || null,
  });
  let q = supabase
    .from("markets")
    .select(
      "id,symbol,name,market_address,market_id_bytes32,is_active,network,chain_id,market_status,deployment_status"
    )
    .eq("is_active", true);

  if (networkName) q = q.eq("network", networkName);
  if (symbol) q = q.eq("symbol", symbol);

  const { data, error } = await q.order("created_at", { ascending: false });
  if (error) {
    logStep("supabase_fetch", "error", {
      error: error.message || String(error),
    });
    throw error;
  }
  const rows = Array.isArray(data) ? data : [];
  const markets = rows
    .map((m) => ({
      id: m.id,
      symbol: m.symbol,
      name: m.name,
      marketAddress: m.market_address,
      marketId: m.market_id_bytes32,
      isActive: Boolean(m.is_active),
      network: m.network,
      chainId: Number(m.chain_id || 0),
      marketStatus: m.market_status,
      deploymentStatus: m.deployment_status,
    }))
    .filter(
      (m) => m.symbol && isAddress(m.marketAddress) && isBytes32(m.marketId)
    );

  logStep("supabase_fetch", "success", { count: markets.length });
  return markets;
}

async function ensureCollateral({
  dryRun,
  token,
  coreVault,
  userWallet,
  userAddress,
  depositAmount6,
  label,
}) {
  const bal = await token.balanceOf(userAddress);
  const allowance = await token.allowance(
    userAddress,
    await coreVault.getAddress()
  );
  logStep("collateral_status", "success", {
    label,
    user: userAddress,
    balance6: bal.toString(),
    allowance6: allowance.toString(),
    deposit6: depositAmount6.toString(),
  });

  if (bal < depositAmount6) {
    throw new Error(
      `${label} has insufficient collateral token balance. need=${fmt6(
        depositAmount6
      )} have=${fmt6(bal)} addr=${userAddress}`
    );
  }

  if (!dryRun) {
    if (!userWallet)
      throw new Error(`${label} wallet missing private key (cannot send tx)`);
    if (allowance < depositAmount6) {
      logStep("approve", "start", {
        label,
        amount6: depositAmount6.toString(),
      });
      const txA = await token
        .connect(userWallet)
        .approve(await coreVault.getAddress(), depositAmount6);
      logStep("approve", "success", { label, tx: txA.hash });
      await txA.wait();
    }
    logStep("deposit", "start", { label, amount6: depositAmount6.toString() });
    const txD = await coreVault
      .connect(userWallet)
      .depositCollateral(depositAmount6);
    logStep("deposit", "success", { label, tx: txD.hash });
    await txD.wait();
  } else {
    logStep("deposit", "success", { label, dryRun: true });
  }
}

async function getMarkPrice({ coreVault, marketId, pricingFacet }) {
  try {
    const mp = await coreVault.getMarkPrice(marketId);
    if (mp && BigInt(mp) > 0n) return mp;
  } catch (_) {}
  try {
    const mp2 = await pricingFacet.calculateMarkPrice();
    return mp2;
  } catch {
    return 0n;
  }
}

async function getPositionSummarySafe(coreVaultRead, user, marketId) {
  try {
    const res = await coreVaultRead.getPositionSummary(user, marketId);
    return { size18: res[0], entryPrice6: res[1], marginLocked6: res[2] };
  } catch {
    return { size18: 0n, entryPrice6: 0n, marginLocked6: 0n };
  }
}

async function getLiqPriceSafe(coreVaultRead, user, marketId) {
  try {
    const res = await coreVaultRead.getLiquidationPrice(user, marketId);
    return { liqPrice6: res[0], hasPosition: Boolean(res[1]) };
  } catch {
    return { liqPrice6: 0n, hasPosition: false };
  }
}

// Compute liquidation price with the same effective rules as our contracts:
// - Longs: 100% margined / no leverage => no meaningful liquidation price (return 0).
// - Shorts: liquidation trigger depends on entry price, margin locked, and MMR bps:
//     P_liq = (entryPrice + marginPerUnit) * 10000 / (10000 + MMR_BPS)
//   where marginPerUnit = marginLocked * 1e18 / |Q|  (all in 6-decimal price space)
function computeLiquidationPrice6FromSummary({
  size18,
  entryPrice6,
  marginLocked6,
  mmrBps,
}) {
  const size = BigInt(size18);
  if (size === 0n) return 0n;
  if (size > 0n) return 0n; // longs have no liq price in this system

  const absSize = -size;
  if (absSize === 0n) return 0n;
  const entry6 = BigInt(entryPrice6);
  const locked6 = BigInt(marginLocked6);
  const mmr = BigInt(mmrBps);

  const marginPerUnit6 = (locked6 * 1000000000000000000n) / absSize;
  const numerator = entry6 + marginPerUnit6;
  const denomBps = 10000n + mmr;
  if (denomBps === 0n) return 0n;
  return (numerator * 10000n) / denomBps;
}

async function scenarioForMarket({
  dryRun,
  market,
  coreVault,
  users,
  interactiveConfirm = false,
}) {
  const report = {
    market: {
      id: market.id,
      symbol: market.symbol,
      marketId: market.marketId,
      orderBook: market.marketAddress,
      network: market.network,
      chainId: market.chainId,
    },
    rounds: [],
  };

  // Facets attached to the diamond by address
  const pricingFacet = await ethers.getContractAt(
    "OBPricingFacet",
    market.marketAddress
  );
  const placementAbi = [
    "function placeMarginLimitOrder(uint256 price, uint256 amount, bool isBuy) returns (uint256 orderId)",
    "function placeMarginMarketOrder(uint256 amount, bool isBuy) returns (uint256 filledAmount)",
    "function bestBid() view returns (uint256)",
    "function bestAsk() view returns (uint256)",
  ];
  const liquidationAbi = [
    "function liquidateDirect(address trader)",
    "function pokeLiquidations()",
    "function pokeLiquidationsMulti(uint256 rounds)",
  ];
  const placement = await ethers.getContractAt(
    placementAbi,
    market.marketAddress
  );
  const liquidation = await ethers.getContractAt(
    liquidationAbi,
    market.marketAddress
  );
  // IMPORTANT: use a provider-backed CoreVault instance for static calls on non-view functions.
  const coreVaultRead = coreVault.connect(ethers.provider);
  const net = await ethers.provider.getNetwork();
  const chainId = Number(net.chainId);
  const relayerBase = resolveRelayerBaseUrl();
  const sessionCache = {};

  logStep("gasless_mode", "success", {
    symbol: market.symbol,
    gaslessEnabled: true,
    sessionEnabled: true,
    relayerBase,
    relayerAddress: shortAddr(requireEnv("RELAYER_ADDRESS")),
    chainId,
  });

  // Create sessions for all participating users once.
  for (const u of [users.maker, users.victim, users.lp, users.pusher]) {
    await ensureSessionForUser({
      dryRun,
      relayerBase,
      chainId,
      user: u,
      orderBook: market.marketAddress,
      sessionCache,
    });
  }

  // Pre-flight mark
  const initialMark = await getMarkPrice({
    coreVault: coreVaultRead,
    marketId: market.marketId,
    pricingFacet,
  });
  if (!initialMark || BigInt(initialMark) === 0n) {
    throw new Error(
      `Mark price is 0 for ${market.symbol}. Cannot anchor initial orders.`
    );
  }
  logStep("market_preflight", "success", {
    symbol: market.symbol,
    orderBook: market.marketAddress,
    marketId: market.marketId,
    initialMark: initialMark.toString(),
  });

  // No deposits / collateral management in this script (assume users are funded).
  logStep("deposit", "success", { skipped: true });

  // Single round only (simplified)
  const round = 1;
  const roundReport = { round, steps: [], result: null };

  // Anchor everything off the current CoreVault mark. Initial orders must be set at that mark price.
  const markBase = BigInt(
    await getMarkPrice({
      coreVault: coreVaultRead,
      marketId: market.marketId,
      pricingFacet,
    })
  );
  const makerBidPx = markBase; // exactly at mark

  logStep("round_preview", "success", {
    symbol: market.symbol,
    round,
    markPrice6: markBase.toString(),
    markPrice: fmt6(markBase),
    makerBidPx6: makerBidPx.toString(),
    makerBidPx: fmt6(makerBidPx),
    makerBidUnits: fmt18(SIZE_10_UNITS),
    victimSellUnits: fmt18(SIZE_10_UNITS),
    lpAskUnits: fmt18(SIZE_15_UNITS),
    makerBuyUnits: fmt18(SIZE_1_UNIT),
    makerBuyCount: MAKER_BUY_COUNT,
    dryRun,
  });
  if (interactiveConfirm && !dryRun) {
    const ok = await askConfirm(
      `Proceed with liquidation scenario on ${market.symbol}?`,
      true
    );
    if (!ok) {
      roundReport.result = { ok: false, reason: "user_cancelled" };
      report.rounds.push(roundReport);
      return report;
    }
  }

  // 1) Maker posts a bid AT MARK for 10 units
  logStep("place_bid_at_mark", "start", {
    symbol: market.symbol,
    round,
    price: makerBidPx.toString(),
    qty: fmt18(SIZE_10_UNITS),
    qty18: SIZE_10_UNITS.toString(),
  });
  const sidMaker = await ensureSessionForUser({
    dryRun,
    relayerBase,
    chainId,
    user: users.maker,
    orderBook: market.marketAddress,
    sessionCache,
  });
  const resBid = await relaySessionTrade({
    dryRun,
    relayerBase,
    orderBook: market.marketAddress,
    method: "sessionPlaceMarginLimit",
    sessionId: sidMaker,
    params: {
      trader: users.maker.address,
      price: makerBidPx.toString(),
      amount: SIZE_10_UNITS.toString(),
      isBuy: true,
    },
  });
  logStep("place_bid_at_mark", "success", {
    tx: resBid.txHash || null,
    dryRun,
  });
  if (!(await promptContinueIfInteractive(interactiveConfirm, "Bid placed."))) {
    roundReport.result = { ok: false, reason: "user_cancelled_after_bid" };
    report.rounds.push(roundReport);
    return report;
  }

  // 2) Victim opens SHORT by selling 10 units via market order (should consume the 10-unit bid)
  logStep("victim_open_short", "start", {
    symbol: market.symbol,
    round,
    qty: fmt18(SIZE_10_UNITS),
    qty18: SIZE_10_UNITS.toString(),
  });
  const sidVictim = await ensureSessionForUser({
    dryRun,
    relayerBase,
    chainId,
    user: users.victim,
    orderBook: market.marketAddress,
    sessionCache,
  });
  const resSell = await relaySessionTrade({
    dryRun,
    relayerBase,
    orderBook: market.marketAddress,
    method: "sessionPlaceMarginMarket",
    sessionId: sidVictim,
    params: {
      trader: users.victim.address,
      amount: SIZE_10_UNITS.toString(),
      isBuy: false,
    },
  });
  logStep("victim_open_short", "success", {
    tx: resSell.txHash || null,
    dryRun,
  });
  if (
    !(await promptContinueIfInteractive(
      interactiveConfirm,
      "Short opened (sell executed)."
    ))
  ) {
    roundReport.result = { ok: false, reason: "user_cancelled_after_short" };
    report.rounds.push(roundReport);
    return report;
  }

  // Refresh victim state
  const victimPos1 = await getPositionSummarySafe(
    coreVaultRead,
    users.victim.address,
    market.marketId
  );
  const victimSize1 = victimPos1.size18;
  let liq = await getLiqPriceSafe(
    coreVaultRead,
    users.victim.address,
    market.marketId
  );
  const liqPriceOnchain = liq.liqPrice6;
  const hasPosOnchain = liq.hasPosition;

  // Always compute liquidation price from the same canonical inputs:
  // - For LIVE runs: use the actual on-chain position summary.
  // - For DRY RUN: deterministically estimate the expected summary using our scenario assumptions.
  //
  // MMR (bps) comes from CoreVault helper (base+penalty, capped). If unavailable, default 20%.
  let mmrBps;
  try {
    mmrBps = BigInt(await coreVaultRead.maintenanceMarginBps(market.marketId));
  } catch {
    mmrBps = 2000n;
  }

  let liqPrice = liqPriceOnchain;
  let hasPos = hasPosOnchain;
  let dryRunMarginLocked6 = null;
  let liqPriceComputed6 = null;
  let usedComputed = false;

  if (!dryRun) {
    // LIVE: compute from the actual on-chain summary (this is the "always right" source of truth).
    const computed = computeLiquidationPrice6FromSummary({
      size18: victimPos1.size18,
      entryPrice6: victimPos1.entryPrice6,
      marginLocked6: victimPos1.marginLocked6,
      mmrBps,
    });
    liqPriceComputed6 = computed.toString();
    liqPrice = computed;
    hasPos = BigInt(victimPos1.size18) !== 0n;
    usedComputed = true;
  } else {
    // DRY RUN: estimate what the position summary WOULD be if we executed the planned fill.
    const entry6 = BigInt(makerBidPx);
    const q18 = -BigInt(SIZE_10_UNITS);
    const absQ18 = -q18;
    const notional6 = (absQ18 * entry6) / 1000000000000000000n;
    const shortMarginBps = 15000n;
    const marginLocked6 = (notional6 * shortMarginBps) / 10000n;
    dryRunMarginLocked6 = marginLocked6.toString();

    const computed = computeLiquidationPrice6FromSummary({
      size18: q18,
      entryPrice6: entry6,
      marginLocked6,
      mmrBps,
    });
    liqPriceComputed6 = computed.toString();
    liqPrice = computed;
    hasPos = true;
    usedComputed = true;
  }

  logStep("victim_state", "success", {
    symbol: market.symbol,
    round,
    victim: users.victim.address,
    size18: victimSize1.toString(),
    hasPosOnchain,
    liqPriceOnchain6: liqPriceOnchain.toString(),
    liqPriceOnchain: fmt6(liqPriceOnchain),
    // Used for subsequent steps (in dry-run this becomes the estimate).
    hasPos,
    liqPrice6: liqPrice.toString(),
    liqPrice: fmt6(liqPrice),
    dryRunMarginLocked6: dryRunMarginLocked6,
    mmrBps: mmrBps.toString(),
    liqPriceComputed6,
    usedComputed,
  });
  if (
    !(await promptContinueIfInteractive(
      interactiveConfirm,
      "Liquidation price computed / fetched."
    ))
  ) {
    roundReport.result = {
      ok: false,
      reason: "user_cancelled_after_liq_price",
    };
    report.rounds.push(roundReport);
    return report;
  }

  // If we failed to open a short, bail.
  if (!dryRun) {
    if (!hasPos || BigInt(victimSize1) >= 0n) {
      roundReport.result = {
        ok: false,
        reason: "victim_not_short_or_no_position",
        victimSize18: victimSize1.toString(),
        liqPrice6: liqPrice.toString(),
      };
      report.rounds.push(roundReport);
      return report;
    }
    if (!liqPrice || BigInt(liqPrice) === 0n) {
      roundReport.result = {
        ok: false,
        reason: "liq_price_unavailable",
        victimSize18: victimSize1.toString(),
        liqPrice6: liqPrice.toString(),
      };
      report.rounds.push(roundReport);
      return report;
    }
  }

  // 3) Liquidity provider adds 15 units on the opposing side (ASK) at liquidation price.
  // Maker then buys 1 unit twice off that ask liquidity.
  // Place the ASK slightly ABOVE the liquidation price (about +1%).
  // Use ceil so askPx > liqPrice even with integer rounding.
  const liqPx = BigInt(liqPrice);
  let askPx = (liqPx * 10100n + 9999n) / 10000n; // +1% (100 bps), rounded up
  if (askPx <= liqPx) askPx = liqPx + 1n;
  logStep("lp_post_ask_at_liq", "start", {
    symbol: market.symbol,
    round,
    liqPrice6: liqPx.toString(),
    liqPrice: fmt6(liqPx),
    askPrice6: askPx.toString(),
    askPrice: fmt6(askPx),
    qty: fmt18(SIZE_15_UNITS),
    qty18: SIZE_15_UNITS.toString(),
  });
  const sidLp = await ensureSessionForUser({
    dryRun,
    relayerBase,
    chainId,
    user: users.lp,
    orderBook: market.marketAddress,
    sessionCache,
  });
  const resAsk = await relaySessionTrade({
    dryRun,
    relayerBase,
    orderBook: market.marketAddress,
    method: "sessionPlaceMarginLimit",
    sessionId: sidLp,
    params: {
      trader: users.lp.address,
      price: askPx.toString(),
      amount: SIZE_15_UNITS.toString(),
      isBuy: false,
    },
  });
  logStep("lp_post_ask_at_liq", "success", {
    tx: resAsk.txHash || null,
    dryRun,
  });
  if (
    !(await promptContinueIfInteractive(interactiveConfirm, "LP ask placed."))
  ) {
    roundReport.result = { ok: false, reason: "user_cancelled_after_lp_ask" };
    report.rounds.push(roundReport);
    return report;
  }

  for (let k = 1; k <= MAKER_BUY_COUNT; k++) {
    logStep("maker_buy_1_unit", "start", {
      symbol: market.symbol,
      round,
      k,
      qty: fmt18(SIZE_1_UNIT),
      qty18: SIZE_1_UNIT.toString(),
    });
    const sidMaker2 = await ensureSessionForUser({
      dryRun,
      relayerBase,
      chainId,
      user: users.maker,
      orderBook: market.marketAddress,
      sessionCache,
    });
    const resBuy = await relaySessionTrade({
      dryRun,
      relayerBase,
      orderBook: market.marketAddress,
      method: "sessionPlaceMarginMarket",
      sessionId: sidMaker2,
      params: {
        trader: users.maker.address,
        amount: SIZE_1_UNIT.toString(),
        isBuy: true,
      },
    });
    logStep("maker_buy_1_unit", "success", {
      k,
      tx: resBuy.txHash || null,
      dryRun,
    });
    if (
      !(await promptContinueIfInteractive(
        interactiveConfirm,
        `Maker buy ${k}/${MAKER_BUY_COUNT} completed.`
      ))
    ) {
      roundReport.result = {
        ok: false,
        reason: "user_cancelled_after_maker_buy",
        k,
      };
      report.rounds.push(roundReport);
      return report;
    }
  }

  const markAfter = await getMarkPrice({
    coreVault: coreVaultRead,
    marketId: market.marketId,
    pricingFacet,
  });
  let isLiquidatable2;
  try {
    isLiquidatable2 = await coreVaultRead
      .getFunction("isLiquidatable")
      .staticCall(users.victim.address, market.marketId, markAfter);
  } catch {
    isLiquidatable2 = undefined;
  }
  logStep("post_buys_status", "success", {
    symbol: market.symbol,
    round,
    markAfter6: markAfter.toString(),
    markAfter: fmt6(markAfter),
    isLiquidatable: isLiquidatable2,
  });

  roundReport.result = {
    ok: true,
    victimSizeBefore18: victimSize1.toString(),
    liqPrice6: liqPrice.toString(),
    askPrice6: askPx.toString(),
    markAfter6: markAfter.toString(),
    isLiquidatable: isLiquidatable2,
  };
  report.rounds.push(roundReport);

  return report;
}

async function main() {
  const provider = ethers.provider;
  const net = await provider.getNetwork();
  const interactive =
    process.stdout.isTTY &&
    process.stdin.isTTY &&
    !hasFlag("--non-interactive");

  // Safe default: dry-run unless explicitly confirmed in interactive mode.
  const dryRun = hasFlag("--dry-run")
    ? true
    : interactive
    ? !(await askConfirm("Run in LIVE mode (send transactions)?", false))
    : true;

  let networkName =
    getArg("--network-name", null) ||
    process.env.NETWORK_NAME ||
    process.env.NEXT_PUBLIC_NETWORK_NAME ||
    process.env.HARDHAT_NETWORK ||
    null;
  if (interactive) {
    const ans = await ask(
      `Supabase network filter (press Enter for '${
        networkName || "no filter"
      }'): `
    );
    if (ans) networkName = ans;
  }

  // Defaults (can be overridden interactively)
  // No deposits, no spread/slippage/round configuration in this simplified script.
  const skipDeposits = true;
  // Back-compat only (scenario no longer uses step ladder)
  const steps = Math.max(1, Math.floor(toNum(getArg("--steps", "25"), 25)));
  const stepBps = Math.max(
    1,
    Math.floor(toNum(getArg("--step-bps", "50"), 50))
  );

  logStep("start", "success", {
    hardhatNetwork: process.env.HARDHAT_NETWORK || null,
    chainId: Number(net.chainId),
    networkName: networkName || null,
    dryRun,
    interactive,
    gaslessEnabled: true,
    sessionEnabled: true,
    relayerBase: resolveRelayerBaseUrl(),
  });

  const deploymentNetworkName =
    process.env.HARDHAT_NETWORK === "hardhat"
      ? "localhost"
      : process.env.HARDHAT_NETWORK || "hyperliquid";
  const deployment = await loadDeploymentJson(deploymentNetworkName);

  const coreVaultAddr =
    process.env.CORE_VAULT_ADDRESS ||
    deployment?.contracts?.CORE_VAULT ||
    deployment?.contracts?.COREVAULT ||
    null;
  if (!coreVaultAddr || !isAddress(coreVaultAddr)) {
    throw new Error(
      "Missing CORE_VAULT_ADDRESS (or deployments/<network>-deployment.json contracts.CORE_VAULT)"
    );
  }
  const coreVault = await ethers.getContractAt("CoreVault", coreVaultAddr);

  // Collateral token address is not exposed by CoreVault, so we require it from env/deployments.
  let collateralTokenAddr =
    process.env.COLLATERAL_TOKEN_ADDRESS ||
    process.env.MOCK_USDC_ADDRESS ||
    deployment?.contracts?.MOCK_USDC ||
    deployment?.contracts?.COLLATERAL_TOKEN ||
    null;
  if (
    (!collateralTokenAddr || !isAddress(collateralTokenAddr)) &&
    interactive
  ) {
    const ans = await ask(
      "Collateral token address (6 decimals) [COLLATERAL_TOKEN_ADDRESS]: "
    );
    if (ans) collateralTokenAddr = ans;
  }
  if (!collateralTokenAddr || !isAddress(collateralTokenAddr)) {
    throw new Error(
      "Missing collateral token address. Set COLLATERAL_TOKEN_ADDRESS (recommended for mainnet) or MOCK_USDC_ADDRESS, or provide deployments contracts.MOCK_USDC."
    );
  }
  const erc20Abi = [
    "function balanceOf(address) view returns (uint256)",
    "function allowance(address,address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
    "function decimals() view returns (uint8)",
    "function symbol() view returns (string)",
  ];
  // Collateral token is still resolved for address sanity in logs, but not used for deposits.
  await ethers.getContractAt(erc20Abi, collateralTokenAddr);

  // Pick users
  const userChoices = [
    {
      label: formatUserChoiceLabel({
        key: "user2",
        nick: "SayidWithDextera",
        envVars: ["PRIVATE_KEY_USER2"],
      }),
      value: "user2",
    },
    {
      label: formatUserChoiceLabel({
        key: "user3",
        nick: "U3Marlon",
        envVars: ["PRIVATE_KEY_USER3"],
      }),
      value: "user3",
    },
    {
      label: formatUserChoiceLabel({
        key: "user4",
        nick: "MikeLeveler",
        envVars: ["PRIVATE_KEY_USER4"],
      }),
      value: "user4",
    },
    {
      label: formatUserChoiceLabel({
        key: "user5",
        nick: "U5RottenMango",
        envVars: ["PRIVATE_KEY_USER5"],
      }),
      value: "user5",
    },
    {
      label: formatUserChoiceLabel({
        key: "admin",
        nick: "UserDx2",
        envVars: ["PRIVATE_KEY_USERD", "ADMIN_PRIVATE_KEY"],
      }),
      value: "admin",
    },
  ];
  let victimKey = getArg("--victim", null) || "user2";
  let makerKey = getArg("--maker", null) || "user3";
  let lpKey = getArg("--lp", null) || "user5";
  // Default pusher to admin to ensure 4 distinct users by default (even if pusher is unused in the simplified flow).
  let pusherKey = getArg("--pusher", null) || "admin";
  if (interactive) {
    victimKey = await chooseFromList(
      "Victim (will be liquidated)",
      userChoices,
      {
        allowQuit: false,
      }
    );
    makerKey = await chooseFromList("Maker (posts bid at mark)", userChoices, {
      allowQuit: false,
    });
    lpKey = await chooseFromList(
      "LP (posts asks at liquidation price)",
      userChoices,
      {
        allowQuit: false,
      }
    );
    pusherKey = await chooseFromList(
      "Pusher (buys asks to push mark)",
      userChoices,
      { allowQuit: false }
    );
  }

  const victimRef = resolveUserRef(victimKey);
  const makerRef = resolveUserRef(makerKey);
  const lpRef = resolveUserRef(lpKey);
  const pusherRef = resolveUserRef(pusherKey);

  const fallbackSigner = (await ethers.getSigners().catch(() => []))[0] || null;
  const victim = await buildWallet(victimRef, provider, fallbackSigner);
  const maker = await buildWallet(makerRef, provider, fallbackSigner);
  const lp = await buildWallet(lpRef, provider, fallbackSigner);
  const pusher = await buildWallet(pusherRef, provider, fallbackSigner);

  // Enforce independent users (distinct addresses) unless explicitly allowed.
  // This matters for realism and to avoid self-cross / unintended netting.
  const allowDup =
    String(process.env.LIQ_TEST_ALLOW_DUP_USERS || "").toLowerCase() === "true";
  const chosen = [
    { role: "victim", key: victimKey, address: victim.address },
    { role: "maker", key: makerKey, address: maker.address },
    { role: "lp", key: lpKey, address: lp.address },
    { role: "pusher", key: pusherKey, address: pusher.address },
  ];
  const seen = new Map();
  const dups = [];
  for (const u of chosen) {
    const k = String(u.address || "").toLowerCase();
    if (!k) continue;
    if (seen.has(k)) dups.push({ address: u.address, a: seen.get(k), b: u });
    else seen.set(k, u);
  }
  if (dups.length && !allowDup) {
    const msg =
      "Selected users are not independent (duplicate addresses). " +
      "Pick 4 distinct keys (victim/maker/lp/pusher) or set LIQ_TEST_ALLOW_DUP_USERS=true.";
    if (!interactive) {
      throw new Error(
        `${msg} duplicates=${dups
          .map((d) => `${shortAddr(d.address)}(${d.a.role},${d.b.role})`)
          .join(",")}`
      );
    }
    console.log("\n⚠️  " + msg);
    console.log(
      "    duplicates:",
      dups
        .map(
          (d) => `${shortAddr(d.address)} used for ${d.a.role} and ${d.b.role}`
        )
        .join("; ")
    );
    const cont = await askConfirm("Continue anyway?", false);
    if (!cont) {
      console.log("Exiting (re-run and pick distinct users).");
      return;
    }
  }

  const users = {
    victim: { ...victim, label: "victim" },
    maker: { ...maker, label: "maker" },
    lp: { ...lp, label: "lp" },
    pusher: { ...pusher, label: "pusher" },
  };

  if (!dryRun) {
    for (const u of [users.victim, users.maker, users.lp, users.pusher]) {
      if (!u.wallet) {
        throw new Error(
          `User ${u.label} has no private key (only address ${u.address}). Provide the corresponding PRIVATE_KEY_* env or use --dry-run.`
        );
      }
    }
  }

  logStep("users", "success", {
    victim: shortAddr(users.victim.address),
    maker: shortAddr(users.maker.address),
    lp: shortAddr(users.lp.address),
    pusher: shortAddr(users.pusher.address),
    victimKey,
    makerKey,
    lpKey,
    pusherKey,
    victimNick:
      victimKey === "user2"
        ? "SayidWithDextera"
        : victimKey === "user3"
        ? "U3Marlon"
        : victimKey === "user4"
        ? "MikeLeveler"
        : victimKey === "user5"
        ? "U5RottenMango"
        : victimKey === "admin"
        ? "UserDx2"
        : victimKey,
    makerNick:
      makerKey === "user2"
        ? "SayidWithDextera"
        : makerKey === "user3"
        ? "U3Marlon"
        : makerKey === "user4"
        ? "MikeLeveler"
        : makerKey === "user5"
        ? "U5RottenMango"
        : makerKey === "admin"
        ? "UserDx2"
        : makerKey,
    lpNick:
      lpKey === "user2"
        ? "SayidWithDextera"
        : lpKey === "user3"
        ? "U3Marlon"
        : lpKey === "user4"
        ? "MikeLeveler"
        : lpKey === "user5"
        ? "U5RottenMango"
        : lpKey === "admin"
        ? "UserDx2"
        : lpKey,
    pusherNick:
      pusherKey === "user2"
        ? "SayidWithDextera"
        : pusherKey === "user3"
        ? "U3Marlon"
        : pusherKey === "user4"
        ? "MikeLeveler"
        : pusherKey === "user5"
        ? "U5RottenMango"
        : pusherKey === "admin"
        ? "UserDx2"
        : pusherKey,
    coreVault: shortAddr(coreVaultAddr),
    collateralToken: shortAddr(collateralTokenAddr),
    skipDeposits,
    fixedBidUnits: fmt18(SIZE_10_UNITS),
    fixedLpAskUnits: fmt18(SIZE_15_UNITS),
    makerBuyCount: MAKER_BUY_COUNT,
  });

  // Load markets from Supabase (always)
  const markets = await fetchMarketsFromSupabase({ symbol: null, networkName });
  if (!markets.length) {
    throw new Error(
      `No active markets found in Supabase (network=${networkName || "any"})`
    );
  }

  // Choose market
  let selectedMarkets = markets;
  if (interactive) {
    const options = markets.map((m) => ({
      label: `${m.symbol} — ${shortAddr(m.marketAddress)} — marketId ${String(
        m.marketId
      ).slice(0, 10)}…`,
      value: m,
    }));
    const picked = await chooseFromList(
      "Pick a market to run liquidation scenario",
      options,
      { allowQuit: true }
    );
    if (!picked) return;
    selectedMarkets = [picked];
  } else {
    const sym =
      getArg("--symbol", null) ||
      process.env.LIQ_TEST_SYMBOL ||
      process.env.LIQ_SYMBOL ||
      null;
    if (sym) {
      selectedMarkets = markets.filter(
        (m) => String(m.symbol).toLowerCase() === String(sym).toLowerCase()
      );
    }
  }

  const allReports = [];
  for (const m of selectedMarkets) {
    try {
      const rep = await scenarioForMarket({
        dryRun,
        market: m,
        coreVault,
        users,
        steps,
        stepBps,
        interactiveConfirm: interactive,
      });
      allReports.push(rep);
      logStep("market_done", "success", {
        symbol: m.symbol,
        rounds: rep.rounds?.length || 0,
      });
    } catch (e) {
      logStep("market_done", "error", {
        symbol: m.symbol,
        error: e?.shortMessage || e?.reason || e?.message || String(e),
      });
      allReports.push({
        market: {
          symbol: m.symbol,
          marketId: m.marketId,
          orderBook: m.marketAddress,
        },
        error: e?.message || String(e),
      });
    }
  }

  console.log("\n=== liquidation test summary ===");
  for (const r of allReports) {
    const sym = r?.market?.symbol || "?";
    const ob = r?.market?.orderBook || "?";
    const mid = r?.market?.marketId || "?";
    const rounds = Array.isArray(r?.rounds) ? r.rounds.length : 0;
    const okAll =
      Array.isArray(r?.rounds) && r.rounds.length
        ? r.rounds.every((x) => x?.result?.ok)
        : false;
    const err = r?.error ? safeOneLine(r.error, 160) : "";
    console.log(
      `${COLORS.bold}[liq-test]${COLORS.reset} SUMMARY ` +
        `symbol=${sym} ok=${okAll} rounds=${rounds} ` +
        `orderBook=${shortAddr(ob)} marketId=${String(mid).slice(0, 10)}…` +
        (err ? ` error=${err}` : "")
    );
  }
  if (String(process.env.LIQ_TEST_DUMP_REPORT || "").toLowerCase() === "true") {
    console.log("\n[liq-test] Full report JSON (LIQ_TEST_DUMP_REPORT=true):");
    console.log(
      JSON.stringify({ ok: true, dryRun, markets: allReports }, null, 2)
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
