import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeEventLog, encodeFunctionData, Hex, parseAbiItem, createPublicClient, createWalletClient, http } from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY");
const SIGNING_KEY = Deno.env.get("LIQUIDATION_DIRECT_SIGN_IN_KEY") || "";

// On-chain
const RPC_URL = Deno.env.get("HUB_RPC_URL") || "";
const CORE_VAULT = Deno.env.get("CORE_VAULT_ADDRESS") || "";

// ============ Relayer Pool Configuration ============
// Mirrors the gasless trading infrastructure: small pool for normal txs, big pool for high-gas txs.
// Env vars:
//   LIQUIDATOR_PRIVATE_KEYS_JSON          - JSON array of hex private keys (small pool)
//   LIQUIDATOR_PRIVATE_KEYS_BIG_JSON      - JSON array of hex private keys (big-block pool)
//   LIQUIDATOR_PRIVATE_KEY                - Legacy single-key fallback
//   HYPEREVM_SMALL_BLOCK_GAS_LIMIT        - Small block gas cap (default 2_000_000)
//   HYPEREVM_BIG_BLOCK_GAS_LIMIT          - Big block gas cap (default 30_000_000)
//   LIQUIDATION_GAS_ESTIMATE_BUFFER_BPS   - Buffer multiplier in bps (default 13000 = 1.30x)
//   LIQUIDATION_NONCE_ALLOCATOR           - "disabled" to skip Supabase nonce allocator

type RelayerAccount = {
  id: string;
  pool: "small" | "big";
  address: `0x${string}`;
  privateKey: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
};

function normalizePrivateKey(pk: string): `0x${string}` | null {
  const raw = String(pk || "").trim();
  if (!raw) return null;
  const v = raw.startsWith("0x") ? raw : `0x${raw}`;
  if (!/^0x[a-fA-F0-9]{64}$/.test(v)) return null;
  return v as `0x${string}`;
}

function parseJsonKeys(envName: string): string[] {
  const raw = Deno.env.get(envName) || "";
  if (!raw.trim()) return [];
  try {
    const v = JSON.parse(raw);
    if (!Array.isArray(v)) return [];
    return v.map((x: any) => String(x || "").trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function loadRelayerPool(pool: "small" | "big"): RelayerAccount[] {
  const jsonEnv = pool === "big" ? "LIQUIDATOR_PRIVATE_KEYS_BIG_JSON" : "LIQUIDATOR_PRIVATE_KEYS_JSON";
  let rawKeys = parseJsonKeys(jsonEnv);

  if (rawKeys.length === 0 && pool === "small") {
    const fallback = Deno.env.get("LIQUIDATOR_PRIVATE_KEY") || Deno.env.get("PRIVATE_KEY") || "";
    if (fallback.trim()) rawKeys = [fallback.trim()];
  }

  const bigExcludeSet = new Set<string>();
  if (pool === "small") {
    for (const k of parseJsonKeys("LIQUIDATOR_PRIVATE_KEYS_BIG_JSON")) {
      const norm = normalizePrivateKey(k);
      if (norm) bigExcludeSet.add(norm.toLowerCase());
    }
  }

  const out: RelayerAccount[] = [];
  let idx = 0;
  for (const rawPk of rawKeys) {
    const pk = normalizePrivateKey(rawPk);
    if (!pk) continue;
    if (pool === "small" && bigExcludeSet.has(pk.toLowerCase())) continue;
    const acct = privateKeyToAccount(pk);
    out.push({
      id: `liq_${pool}:${idx}`,
      pool,
      address: acct.address,
      privateKey: pk,
      account: acct,
    });
    idx++;
  }
  return out;
}

let _smallPool: RelayerAccount[] | null = null;
let _bigPool: RelayerAccount[] | null = null;
function getSmallPool(): RelayerAccount[] {
  if (!_smallPool) _smallPool = loadRelayerPool("small");
  return _smallPool;
}
function getBigPool(): RelayerAccount[] {
  if (!_bigPool) _bigPool = loadRelayerPool("big");
  return _bigPool;
}

let _rrSmall = 0;
let _rrBig = 0;
function pickRoundRobin(pool: "small" | "big"): RelayerAccount | null {
  const keys = pool === "big" ? getBigPool() : getSmallPool();
  if (keys.length === 0) return null;
  if (pool === "big") {
    const k = keys[_rrBig % keys.length];
    _rrBig++;
    return k;
  }
  const k = keys[_rrSmall % keys.length];
  _rrSmall++;
  return k;
}

function hasAnyRelayer(): boolean {
  return getSmallPool().length > 0 || getBigPool().length > 0;
}

const SMALL_BLOCK_GAS_LIMIT = (() => {
  const raw = Deno.env.get("HYPEREVM_SMALL_BLOCK_GAS_LIMIT") || "";
  if (!raw.trim()) return 2_000_000n;
  try { return BigInt(raw.trim()); } catch { return 2_000_000n; }
})();

const BIG_BLOCK_GAS_LIMIT = (() => {
  const raw = Deno.env.get("HYPEREVM_BIG_BLOCK_GAS_LIMIT") || "";
  if (!raw.trim()) return 30_000_000n;
  try { return BigInt(raw.trim()); } catch { return 30_000_000n; }
})();

const GAS_ESTIMATE_BUFFER_BPS = (() => {
  const raw = Deno.env.get("LIQUIDATION_GAS_ESTIMATE_BUFFER_BPS") || "";
  if (!raw.trim()) return 13000n;
  try {
    const v = BigInt(raw.trim());
    return v >= 10000n && v <= 30000n ? v : 13000n;
  } catch { return 13000n; }
})();

function isBlockGasLimitError(err: any): boolean {
  const msg = String(err?.shortMessage || err?.reason || err?.message || err || "").toLowerCase();
  return (
    msg.includes("exceeds block gas limit") ||
    msg.includes("block gas limit") ||
    msg.includes("transaction gas limit exceeds") ||
    msg.includes("gas limit too high") ||
    msg.includes("intrinsic gas too low")
  );
}

async function allocateNonce(
  supabase: any,
  relayer: RelayerAccount,
  publicClient: any,
  traceId: string,
  label: string
): Promise<bigint> {
  const observedPending = await publicClient.getTransactionCount({
    address: relayer.address,
    blockTag: "pending",
  });
  const observed = BigInt(observedPending);

  const mode = (Deno.env.get("LIQUIDATION_NONCE_ALLOCATOR") || "").trim().toLowerCase();
  if (mode === "disabled" || mode === "off" || !supabase) return observed;

  try {
    const { data, error } = await supabase.rpc("allocate_relayer_nonce", {
      p_relayer_address: relayer.address.toLowerCase(),
      p_chain_id: "999",
      p_observed_pending_nonce: observed.toString(),
      p_label: label,
    });
    if (error) throw error;
    return BigInt(data as any);
  } catch (e: any) {
    logDebug(traceId, "nonce_fallback", {
      relayer: relayer.address,
      reason: e?.message || String(e),
    });
    return observed;
  }
}

const USER_TRADES_TABLE = "user_trades";
const PRICE_DECIMALS = 6n; // 1,000,000 = $1
const AMOUNT_DECIMALS = 18n; // 5,000,000,000,000,000 = 0.05
const AMOUNT_DISPLAY_DECIMALS = 4;
const LIQUIDATION_DISPLAY_DECIMALS = 7;

const ABI = [
  parseAbiItem(
    "event LiquidationCompleted(address indexed trader,uint256 liquidationsTriggered,string method,int256 startSize,int256 remainingSize)"
  ),
  parseAbiItem(
    "event TradeRecorded(bytes32 indexed marketId,address indexed buyer,address indexed seller,uint256 price,uint256 amount,uint256 buyerFee,uint256 sellerFee,uint256 timestamp,uint256 liquidationPrice)"
  ),
  parseAbiItem("event PriceUpdated(uint256 lastTradePrice,uint256 currentMarkPrice)"),
  parseAbiItem("event OrderPlaced(uint256 indexed orderId,address indexed trader,uint256 price,uint256 amount,bool isBuy,bool isMarginOrder)"),
  parseAbiItem("event OrderCancelled(uint256 indexed orderId,address indexed trader)"),
  parseAbiItem("event OrderModified(uint256 indexed oldOrderId,uint256 indexed newOrderId,address indexed trader,uint256 newPrice,uint256 newAmount)")
];

const CORE_VAULT_ABI = [
  parseAbiItem(
    "function getLiquidationPrice(address user, bytes32 marketId) view returns (uint256 liquidationPrice, bool hasPosition)"
  ),
  parseAbiItem("function liquidateDirect(bytes32 marketId, address trader)"),
  parseAbiItem(
    "function getPositionSummary(address user, bytes32 marketId) view returns (int256 size, uint256 entryPrice, uint256 marginLocked)"
  ),
];

const ORDERBOOK_PRICING_ABI = [
  parseAbiItem("function calculateMarkPrice() view returns (uint256)"),
];

function textEncoder() {
  return new TextEncoder();
}
function hexToBytes(hex: string) {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function normalizeHex32(hex: string): string | null {
  const clean = (hex || "").replace(/^0x/, "").toLowerCase();
  if (clean.length !== 64) return null;
  return "0x" + clean;
}
function formatUnits(value: bigint, decimals: bigint): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** decimals;
  const intPart = v / base;
  const fracPart = v % base;
  if (fracPart === 0n) return (neg ? "-" : "") + intPart.toString();
  const fracStr = fracPart.toString().padStart(Number(decimals), "0").replace(/0+$/, "");
  return (neg ? "-" : "") + intPart.toString() + "." + fracStr;
}
function truncateDecimals(val: string | null, decimals: number): string | null {
  if (val === null || val === undefined) return null;
  if (!val.includes(".")) return val;
  const neg = val.startsWith("-");
  const clean = neg ? val.slice(1) : val;
  const [i, f = ""] = clean.split(".");
  const fTrunc = f.slice(0, decimals);
  const res = fTrunc ? `${i}.${fTrunc}` : i;
  return neg ? `-${res}` : res;
}
function decimalToUnits(value: string | null, decimals: bigint): bigint | null {
  try {
    if (!value) return null;
    const neg = value.startsWith("-");
    const clean = neg ? value.slice(1) : value;
    const [i, f = ""] = clean.split(".");
    const fPadded = (f + "0".repeat(Number(decimals))).slice(0, Number(decimals));
    const bi = BigInt(i || "0") * (10n ** decimals) + BigInt(fPadded || "0");
    return neg ? -bi : bi;
  } catch {
    return null;
  }
}
function toBigIntSafe(v: any): bigint | null {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.trunc(v));
    if (typeof v === "string") {
      if (!v) return null;
      if (v.startsWith("0x")) return BigInt(v);
      return BigInt(v);
    }
  } catch {}
  return null;
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a[i] ^ b[i];
  return out === 0;
}

const LOG_VERBOSE = (() => {
  const v = (Deno.env.get("LIQUIDATION_LOG_LEVEL") || "").trim().toLowerCase();
  return v === "verbose" || v === "debug" || v === "trace";
})();

function logStep(traceId: string, stage: string, data?: Record<string, unknown>) {
  try {
    console.log(`[liq][${traceId}][${stage}]`, data ? JSON.stringify(data) : "");
  } catch (_) {}
}

function logDebug(traceId: string, stage: string, data?: Record<string, unknown>) {
  if (!LOG_VERBOSE) return;
  logStep(traceId, stage, data);
}

function normalizeAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  return address.toLowerCase();
}

function extractAddress(candidate: any): string | null {
  if (!candidate) return null;
  if (typeof candidate === "string") return candidate;
  if (typeof candidate === "object" && typeof candidate.address === "string") return candidate.address;
  return null;
}

function collectLogAddresses(log: any): string[] {
  if (!log || typeof log !== "object") return [];
  const rawCandidates = [
    log.address,
    log.contractAddress,
    log.toAddress,
    log.fromAddress,
    log?.raw?.address,
    log?.event?.address,
    log?.account,
    log?.account?.address,
    log?.transaction?.to,
    log?.transaction?.to?.address,
    log?.transaction?.from,
    log?.transaction?.from?.address,
  ];
  const unique: string[] = [];
  for (const candidate of rawCandidates) {
    const addr = extractAddress(candidate);
    if (!addr) continue;
    const normalized = normalizeAddress(addr);
    if (!normalized) continue;
    if (!unique.includes(normalized)) unique.push(normalized);
  }
  return unique;
}

function getLogAddressCandidate(log: any): string | null {
  const [first] = collectLogAddresses(log);
  return first ?? null;
}

function attachLogAddress(log: any) {
  const addr = getLogAddressCandidate(log);
  if (!addr) return log;
  if (log.address === addr) return log;
  return { ...log, address: addr };
}

function ensureLogAddresses(logs: any[]) {
  return Array.isArray(logs) ? logs.map((log) => attachLogAddress(log)) : logs;
}

function isZeroLike(value: string | null | undefined) {
  if (value === null || value === undefined) return false;
  const num = Number(value);
  return Number.isFinite(num) && num === 0;
}

async function fetchDbNetPositionRaw(opts: {
  supabase: any;
  marketUuid: string;
  wallet: string;
  traceId: string;
}): Promise<bigint> {
  const walletLower = normalizeAddress(opts.wallet);
  if (!walletLower) return 0n;

  // `user_trades` schema isn't defined in this repo, so we defensively sum `amount`
  // across all rows matching (market_id, user_wallet_address). This works whether
  // the table stores individual trades or aggregated rows.
  const pageSize = 1000;
  let from = 0;
  let total = 0n;

  while (true) {
    const to = from + pageSize - 1;
    let data: any[] | null = null;
    try {
      const res = await opts.supabase
        .from(USER_TRADES_TABLE)
        .select("amount")
        .eq("market_id", opts.marketUuid)
        .ilike("user_wallet_address", walletLower)
        .range(from, to);
      if (res?.error) {
        logStep(opts.traceId, "DB_FETCH_ERR", { wallet: walletLower?.slice(0, 10), err: res.error.message?.slice(0, 80) });
        break;
      }
      data = res?.data || [];
    } catch (e) {
      logStep(opts.traceId, "DB_FETCH_ERR", { wallet: walletLower?.slice(0, 10), err: ((e as any)?.message || "").slice(0, 80) });
      break;
    }

    if (!data.length) break;

    for (const row of data) {
      const amountStr =
        row?.amount === null || row?.amount === undefined
          ? null
          : typeof row.amount === "string"
          ? row.amount
          : row.amount.toString();
      const amtRaw = decimalToUnits(amountStr, AMOUNT_DECIMALS);
      if (amtRaw === null) continue;
      total += amtRaw;
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  logDebug(opts.traceId, "db_net_position", { wallet: walletLower, netRaw: total.toString() });
  return total;
}

async function verifySignature(raw: string, signature: string | null, traceId: string) {
  if (!SIGNING_KEY) return { ok: false, reason: "missing_signing_key" };
  if (!signature) return { ok: false, reason: "missing_signature" };
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      textEncoder().encode(SIGNING_KEY),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const digest = new Uint8Array(await crypto.subtle.sign("HMAC", key, textEncoder().encode(raw)));
    const sigBytes = hexToBytes(signature);
    const match = timingSafeEqual(digest, sigBytes);
    logDebug(traceId, "sig_check", { match });
    return { ok: match, reason: match ? undefined : "signature_mismatch" };
  } catch (e) {
    console.error("[liq-webhook][verify:error]", String(e));
    return { ok: false, reason: "verify_error" };
  }
}

function extractLogs(body: any) {
  const direct = body?.logs;
  const eventLogs = body?.event?.logs;
  const dataLogs = body?.event?.data?.logs;
  const blockLogs = body?.event?.data?.block?.logs;

  if (Array.isArray(direct)) return ensureLogAddresses(direct);
  if (Array.isArray(eventLogs)) return ensureLogAddresses(eventLogs);
  if (Array.isArray(dataLogs)) return ensureLogAddresses(dataLogs);
  if (Array.isArray(blockLogs)) return ensureLogAddresses(blockLogs);

  const activity = body?.event?.activity;
  if (Array.isArray(activity) && activity.length) {
    return ensureLogAddresses(
      activity
        .filter((a: any) => a?.log && Array.isArray(a.log.topics))
        .map((a: any) => ({
          address: a.log.address || a.toAddress || a.fromAddress,
          topics: a.log.topics || [],
          data: a.log.data || "0x",
          transactionHash: a.hash || a.transactionHash,
          blockNumber: a.blockNum,
          logIndex: a.log.logIndex ?? a.log.index ?? 0,
        }))
    );
  }

  return [];
}

function decodeLog(log: any) {
  try {
    return decodeEventLog({ abi: ABI, topics: log.topics as Hex[], data: log.data as Hex });
  } catch (_) {
    return null;
  }
}

const marketIdCache = new Map<string, string>(); // hex32 -> uuid
const marketAddressCache = new Map<string, { marketUuid: string; marketHex: string }>();

async function resolveMarketUuid(supabase: any, marketHex: string, traceId: string): Promise<string | null> {
  const norm = normalizeHex32(marketHex);
  if (!norm) return null;
  if (marketIdCache.has(norm)) return marketIdCache.get(norm)!;
  const clean = norm.replace(/^0x/, "");
  const candidates = [clean, `0x${clean}`];
  for (const c of candidates) {
    try {
      const { data, error } = await supabase
        .from("markets")
        .select("id")
        .ilike("market_id_bytes32", c)
        .maybeSingle();
      if (!error && data?.id) {
        marketIdCache.set(norm, data.id as string);
        logDebug(traceId, "market_resolved", { marketHex: norm, uuid: data.id });
        return data.id as string;
      }
    } catch (e) {
      logDebug(traceId, "market_lookup_err", { marketHex: norm, error: (e as any)?.message || String(e) });
    }
  }
  logDebug(traceId, "market_not_found", { hex: norm.slice(0, 14) });
  return null;
}

async function resolveMarketByAddress(supabase: any, address: string | null | undefined, traceId: string) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    logDebug(traceId, "market_addr_invalid", { address });
    return null;
  }
  if (marketAddressCache.has(normalized)) return marketAddressCache.get(normalized)!;
  try {
    const { data, error } = await supabase
      .from("markets")
      .select("id, market_id_bytes32")
      .ilike("market_address", normalized)
      .maybeSingle();
    if (error) {
      logDebug(traceId, "market_addr_err", { address: normalized, error: error.message });
      return null;
    }
    if (!data?.id || !data?.market_id_bytes32) {
      logDebug(traceId, "market_addr_not_found", { address: normalized });
      return null;
    }
    const marketHex = normalizeHex32(String(data.market_id_bytes32));
    if (!marketHex) {
      logDebug(traceId, "market_addr_bad_hex", { address: normalized });
      return null;
    }
    const resolved = { marketUuid: data.id as string, marketHex };
    marketAddressCache.set(normalized, resolved);
    logDebug(traceId, "market_addr_resolved", { address: normalized, uuid: resolved.marketUuid });
    return resolved;
  } catch (e) {
    logDebug(traceId, "market_addr_exception", { address: normalized, error: (e as any)?.message || String(e) });
    return null;
  }
}

async function fetchOnchainLiqOnce(marketHex: string, wallet: string, traceId: string): Promise<string | null> {
  try {
    if (!CORE_VAULT || !RPC_URL || !wallet) return null;
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    const res = await publicClient.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getLiquidationPrice",
      args: [wallet as `0x${string}`, marketHex as `0x${string}`],
    });
    const liq = (res as any)?.[0] as bigint | undefined;
    logDebug(traceId, "onchain_liq", { wallet: wallet.slice(0, 10), liq: liq?.toString?.() });
    return liq !== undefined
      ? truncateDecimals(formatUnits(liq, PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS)
      : null;
  } catch (e) {
    logDebug(traceId, "onchain_liq_err", { wallet: wallet.slice(0, 10), reason: (e as any)?.message || String(e) });
    return null;
  }
}

async function fetchOnchainLiq(
  marketHex: string,
  wallet: string,
  traceId: string,
  opts: { retries?: number; delayMs?: number } = {}
): Promise<string | null> {
  const attempts = Math.max(1, (opts.retries ?? 2) + 1); // first attempt + retries
  const delayMs = Math.max(0, opts.delayMs ?? 2500);

  let last: string | null = null;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    last = await fetchOnchainLiqOnce(marketHex, wallet, traceId);
    const zeroLike = isZeroLike(last);

    if (last && !zeroLike) return last;

    if (attempt < attempts) {
      logDebug(traceId, "onchain_liq_retry", { attempt, wallet: wallet.slice(0, 10) });
      if (delayMs) await sleep(delayMs);
    }
  }

  if (isZeroLike(last)) {
    logDebug(traceId, "onchain_liq_zero", { wallet: wallet.slice(0, 10) });
    return null;
  }

  return last;
}

async function fetchOnchainKernelPrice(orderBookAddress: string, traceId: string): Promise<bigint | null> {
  const orderbook = normalizeAddress(orderBookAddress);
  if (!RPC_URL || !orderbook) return null;
  try {
    const publicClient = createPublicClient({ transport: http(RPC_URL) });
    const mark = await publicClient.readContract({
      address: orderbook as `0x${string}`,
      abi: ORDERBOOK_PRICING_ABI,
      functionName: "calculateMarkPrice",
      args: [],
    });
    const markBn = toBigIntSafe(mark);
    if (!markBn || markBn <= 0n) {
      logDebug(traceId, "kernel_mark_invalid", {
        orderBook: orderbook.slice(0, 12),
        value: markBn?.toString?.() ?? null,
      });
      return null;
    }
    logDebug(traceId, "kernel_mark", { orderBook: orderbook.slice(0, 12), mark: markBn.toString() });
    return markBn;
  } catch (e) {
    logStep(traceId, "KERNEL_FETCH_ERR", {
      orderBook: orderbook?.slice(0, 12),
      err: ((e as any)?.message || String(e)).slice(0, 120),
    });
    return null;
  }
}

async function upsertNetTrade(opts: {
  supabase: any;
  marketUuid: string;
  wallet: string;
  deltaRaw: bigint;
  payload: {
    price: string;
    liquidation_price: string | null;
    trade_timestamp: string;
    order_book_address: string;
  };
  traceId: string;
}) {
  const walletLower = normalizeAddress(opts.wallet);
  if (!walletLower) return;
  const deltaFull = formatUnits(opts.deltaRaw, AMOUNT_DECIMALS);
  const deltaFormatted = truncateDecimals(deltaFull, AMOUNT_DISPLAY_DECIMALS) ?? deltaFull;

  try {
    const { error } = await opts.supabase.rpc("net_user_trade", {
      p_market_id: opts.marketUuid,
      p_wallet: walletLower,
      p_delta: deltaFormatted,
      p_price: opts.payload.price ?? "0",
      p_liquidation_price: opts.payload.liquidation_price,
      p_trade_ts: opts.payload.trade_timestamp,
      p_order_book: opts.payload.order_book_address,
    });
    if (error) {
      logStep(opts.traceId, "RPC_ERR", { wallet: walletLower?.slice(0, 10), err: error.message?.slice(0, 80) });
    } else {
      logDebug(opts.traceId, "net_rpc_ok", { wallet: walletLower?.slice(0, 10), delta: deltaFormatted });
    }
  } catch (e) {
    logStep(opts.traceId, "RPC_ERR", { wallet: walletLower?.slice(0, 10), err: ((e as any)?.message || "").slice(0, 80),
    });
  }
}

async function readOnchainLiq(publicClient: any, trader: string, marketIdHex: string, traceId: string) {
  if (!CORE_VAULT) return { liq: null, hasPos: false, reason: "no_core_vault" };
  try {
    const [liqPrice, hasPos] = await publicClient.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getLiquidationPrice",
      args: [trader as `0x${string}`, marketIdHex as `0x${string}`],
    });
    logDebug(traceId, "onchain_liq_read", { trader: trader.slice(0, 10), hasPos, liq: liqPrice?.toString?.() });
    return { liq: liqPrice as bigint, hasPos: Boolean(hasPos) };
  } catch (e) {
    logDebug(traceId, "onchain_liq_read_err", { trader: trader.slice(0, 10), reason: String(e).slice(0, 100) });
    return { liq: null, hasPos: false, reason: "read_error" };
  }
}

async function readOnchainPositionSize(
  publicClient: any,
  trader: string,
  marketIdHex: string,
  traceId: string
): Promise<{ size: bigint | null; entryPrice: bigint | null; hasPos: boolean }> {
  if (!CORE_VAULT) return { size: null, entryPrice: null, hasPos: false };
  try {
    const [size, entryPrice] = await publicClient.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getPositionSummary",
      args: [trader as `0x${string}`, marketIdHex as `0x${string}`],
    });
    const sizeBn = size as bigint;
    const hasPos = sizeBn !== 0n;
    logDebug(traceId, "onchain_pos", { trader: trader.slice(0, 10), size: sizeBn.toString(), hasPos });
    return { size: sizeBn, entryPrice: entryPrice as bigint, hasPos };
  } catch (e) {
    logDebug(traceId, "onchain_pos_err", { trader: trader.slice(0, 10), reason: String(e).slice(0, 100) });
    return { size: null, entryPrice: null, hasPos: false };
  }
}

async function reconcilePositionSize(opts: {
  supabase: any;
  publicClient: any;
  marketUuid: string;
  marketHex: string;
  wallet: string;
  dbNetRaw: bigint;
  traceId: string;
}): Promise<{ onchainSize: bigint | null; reconciled: boolean }> {
  const { supabase, publicClient, marketUuid, marketHex, wallet, dbNetRaw, traceId } = opts;
  const { size: onchainSize } = await readOnchainPositionSize(
    publicClient,
    wallet,
    marketHex,
    traceId
  );

  if (onchainSize === null) {
    return { onchainSize: null, reconciled: false };
  }

  if (onchainSize === dbNetRaw) {
    logDebug(traceId, "pos_in_sync", { wallet: wallet.slice(0, 10) });
    return { onchainSize, reconciled: false };
  }

  const deltaRaw = onchainSize - dbNetRaw;
  logStep(traceId, "DRIFT", { wallet: wallet.slice(0, 10), onchain: onchainSize.toString(), db: dbNetRaw.toString(), delta: deltaRaw.toString() });

  await upsertNetTrade({
    supabase,
    marketUuid,
    wallet,
    deltaRaw,
    payload: {
      price: "0",
      liquidation_price: null,
      trade_timestamp: new Date().toISOString(),
      order_book_address: "",
    },
    traceId,
  });

  logDebug(traceId, "pos_reconciled", { wallet: wallet.slice(0, 10), delta: deltaRaw.toString() });

  return { onchainSize, reconciled: true };
}

const LIQ_QUEUE_CHAIN_ID = 999;
const LIQ_MAX_ATTEMPTS = (() => {
  const raw = Deno.env.get("LIQUIDATION_MAX_RETRY_ATTEMPTS") || "";
  if (!raw.trim()) return 5;
  const n = parseInt(raw.trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : 5;
})();

async function enqueueLiqFailure(opts: {
  supabase: any;
  wallet: string;
  marketHex: string;
  error: string;
  traceId: string;
  priority?: number;
}) {
  if (!opts.supabase) return;
  try {
    const { data, error } = await opts.supabase.rpc("enqueue_liq_job", {
      p_address: opts.wallet.toLowerCase(),
      p_market_id: opts.marketHex.toLowerCase(),
      p_chain_id: LIQ_QUEUE_CHAIN_ID,
      p_error: opts.error.slice(0, 500),
      p_priority: opts.priority ?? 0,
    });
    if (error) {
      logStep(opts.traceId, "ENQUEUE_ERR", { wallet: opts.wallet?.slice(0, 10), err: error.message?.slice(0, 80) });
    } else {
      logDebug(opts.traceId, "enqueued", { wallet: opts.wallet?.slice(0, 10), jobId: data });
    }
  } catch (e: any) {
    logStep(opts.traceId, "ENQUEUE_ERR", { wallet: opts.wallet?.slice(0, 10), err: (e?.message || "").slice(0, 80) });
  }
}

async function sendLiquidationTx(opts: {
  relayer: RelayerAccount;
  publicClient: any;
  supabase: any;
  marketHex: `0x${string}`;
  traderWallet: `0x${string}`;
  gasLimit?: bigint;
  traceId: string;
  label: string;
}): Promise<{ tx: string; relayer: string; pool: string }> {
  const { relayer, publicClient, supabase, marketHex, traderWallet, traceId, label } = opts;
  const nonce = await allocateNonce(supabase, relayer, publicClient, traceId, label);

  const walletClient = createWalletClient({
    account: relayer.account,
    transport: http(RPC_URL),
  });

  const txArgs: any = {
    address: CORE_VAULT as `0x${string}`,
    abi: CORE_VAULT_ABI,
    functionName: "liquidateDirect" as const,
    args: [marketHex, traderWallet],
    nonce: Number(nonce),
  };
  if (opts.gasLimit) txArgs.gas = opts.gasLimit;

  const tx = await walletClient.writeContract(txArgs);

  // Best-effort mark broadcasted for observability
  try {
    const nonceMode = (Deno.env.get("LIQUIDATION_NONCE_ALLOCATOR") || "").trim().toLowerCase();
    if (nonceMode !== "disabled" && nonceMode !== "off" && supabase) {
      await supabase.rpc("mark_relayer_tx_broadcasted", {
        p_relayer_address: relayer.address.toLowerCase(),
        p_chain_id: "999",
        p_nonce: nonce.toString(),
        p_tx_hash: tx,
      });
    }
  } catch { /* ignore */ }

  // Wait for receipt and verify the tx actually succeeded on-chain
  try {
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: tx,
      timeout: 60_000,
    });
    if (receipt.status === "reverted") {
      throw new Error(`tx_reverted:${tx}`);
    }
  } catch (receiptErr: any) {
    const msg = receiptErr?.message || String(receiptErr);
    if (msg.includes("tx_reverted")) throw receiptErr;
    logStep(traceId, "RECEIPT_WARN", { tx, reason: msg.slice(0, 120) });
    throw new Error(`receipt_check_failed:${tx}:${msg.slice(0, 100)}`);
  }

  return { tx, relayer: relayer.address, pool: relayer.pool };
}

async function findCandidatesAndLiquidate(
  markPrice: bigint,
  opts: { supabase: any; traceId: string; marketUuid: string; marketHex: string }
) {
  const { traceId, supabase, marketUuid, marketHex } = opts;
  if (!supabase || !CORE_VAULT || !RPC_URL || !hasAnyRelayer()) {
    return { skipped: true, reason: "missing_config" };
  }

  const smallPool = getSmallPool();
  const bigPool = getBigPool();

  logDebug(traceId, "relayers", { small: smallPool.length, big: bigPool.length });

  logStep(traceId, "PRICE_CHECK", { market: marketHex.slice(0, 14), mark: markPrice.toString() });

  let rows: any[] = [];
  logDebug(traceId, "fetch_trades", { marketUuid });
  try {
    const { data, error } = await supabase
      .from(USER_TRADES_TABLE)
      .select("user_wallet_address,liquidation_price,amount")
      .eq("market_id", marketUuid)
      .limit(5000);
    if (error) {
      logStep(traceId, "TRADES_DB_ERR", { err: error.message?.slice(0, 80) });
      return { skipped: true, reason: "db_error" };
    }
    rows = data || [];
  } catch (e) {
    logStep(traceId, "TRADES_DB_ERR", { err: ((e as any)?.message || "").slice(0, 80) });
    return { skipped: true, reason: "db_exception" };
  }

  logDebug(traceId, "trades_loaded", { count: rows.length });

  if (!rows.length) {
    logDebug(traceId, "no_trades", { marketUuid });
    return { skipped: true, reason: "no_trades" };
  }

  const aggregates = new Map<string, { wallet: string; netRaw: bigint; liq: string | null }>();
  for (const row of rows) {
    const wallet = normalizeAddress(row.user_wallet_address);
    if (!wallet) continue;
    const amountStr =
      row.amount === null || row.amount === undefined
        ? null
        : typeof row.amount === "string"
        ? row.amount
        : row.amount.toString();
    const amtRaw = decimalToUnits(amountStr, AMOUNT_DECIMALS);
    if (amtRaw === null || amtRaw === 0n) continue;

    const current = aggregates.get(wallet) || { wallet, netRaw: 0n, liq: null };
    current.netRaw += amtRaw;
    if (!current.liq && row.liquidation_price !== null && row.liquidation_price !== undefined) {
      current.liq =
        typeof row.liquidation_price === "string"
          ? row.liquidation_price
          : row.liquidation_price.toString();
    }
    aggregates.set(wallet, current);
  }

  if (!aggregates.size) {
    logDebug(traceId, "no_positions", { marketUuid });
    return { skipped: true, reason: "no_positions" };
  }

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const liquidations: any[] = [];
  const marketHexTyped = marketHex as `0x${string}`;

  for (const { wallet, netRaw, liq } of aggregates.values()) {
    if (netRaw === 0n) continue;
    const walletHex = wallet as `0x${string}`;

    const { liq: onchainLiq, hasPos } = await readOnchainLiq(publicClient, walletHex, marketHexTyped, traceId);
    if (!hasPos) continue;

    // Reconcile Supabase position size with on-chain truth
    let effectiveNetRaw = netRaw;
    try {
      const { onchainSize, reconciled } = await reconcilePositionSize({
        supabase,
        publicClient,
        marketUuid,
        marketHex: marketHexTyped,
        wallet: walletHex,
        dbNetRaw: netRaw,
        traceId,
      });
      if (onchainSize !== null) {
        effectiveNetRaw = onchainSize;
        if (effectiveNetRaw === 0n) {
          logDebug(traceId, "skip_zero", { wallet: walletHex.slice(0, 10) });
          continue;
        }
      }
    } catch (reconcileErr: any) {
      logStep(traceId, "RECONCILE_ERR", { wallet: walletHex.slice(0, 10), reason: (reconcileErr?.message || "").slice(0, 80) });
    }

    const storedLiqRaw = liq ? decimalToUnits(liq, PRICE_DECIMALS) : null;
    const liqBn = onchainLiq !== null ? onchainLiq : storedLiqRaw;
    if (liqBn === null) continue;

    const isLong = effectiveNetRaw > 0n;
    const shouldLiq = isLong ? markPrice <= liqBn : markPrice >= liqBn;
    if (!shouldLiq) continue;

    logStep(traceId, "LIQ_FOUND", { wallet: walletHex, dir: isLong ? "LONG" : "SHORT", mark: markPrice.toString(), liq: liqBn.toString() });

    // Gas estimation to decide small vs big pool routing
    let estimatedGas: bigint | null = null;
    let estimatedGasBuffered: bigint | null = null;
    let routedPool: "small" | "big" = smallPool.length > 0 ? "small" : "big";
    const estimateFrom = (smallPool[0] || bigPool[0])?.address;

    if (estimateFrom) {
      try {
        const callData = encodeFunctionData({
          abi: CORE_VAULT_ABI,
          functionName: "liquidateDirect",
          args: [marketHexTyped, walletHex],
        });
        estimatedGas = await publicClient.estimateGas({
          account: estimateFrom,
          to: CORE_VAULT as `0x${string}`,
          data: callData,
        });
        estimatedGasBuffered = (estimatedGas * GAS_ESTIMATE_BUFFER_BPS) / 10000n;

        if (estimatedGasBuffered > SMALL_BLOCK_GAS_LIMIT) {
          routedPool = "big";
        }

        logDebug(traceId, "gas_est", { raw: estimatedGas.toString(), buffered: estimatedGasBuffered.toString(), smallCap: SMALL_BLOCK_GAS_LIMIT.toString(), bigAvail: bigPool.length, pool: routedPool });
      } catch (estErr: any) {
        logDebug(traceId, "gas_est_fail", { reason: (estErr?.shortMessage || estErr?.message || "").slice(0, 80) });
      }
    }

    // Compute gas limit for the target pool
    const safetySmall = 120_000n;
    const safetyBig = 300_000n;
    function gasLimitForPool(pool: "small" | "big"): bigint | undefined {
      const desired = estimatedGasBuffered && estimatedGasBuffered > 0n
        ? estimatedGasBuffered + 50_000n
        : undefined;
      if (pool === "big") {
        const cap = BIG_BLOCK_GAS_LIMIT > safetyBig ? BIG_BLOCK_GAS_LIMIT - safetyBig : BIG_BLOCK_GAS_LIMIT;
        return desired && desired > cap ? cap : desired;
      }
      const cap = SMALL_BLOCK_GAS_LIMIT > safetySmall ? SMALL_BLOCK_GAS_LIMIT - safetySmall : SMALL_BLOCK_GAS_LIMIT;
      return desired && desired > cap ? cap : desired;
    }

    // Simulate with the chosen pool's account
    const simAccount = routedPool === "big"
      ? (bigPool[0] || smallPool[0])
      : (smallPool[0] || bigPool[0]);

    try {
      await publicClient.simulateContract({
        address: CORE_VAULT as `0x${string}`,
        abi: CORE_VAULT_ABI,
        functionName: "liquidateDirect",
        args: [marketHexTyped, walletHex],
        account: simAccount.address,
      });
    } catch (simErr) {
      logStep(traceId, "LIQ_REJECTED", { wallet: walletHex, reason: String(simErr).slice(0, 120) });
      continue;
    }

    let relayer = pickRoundRobin(routedPool);
    if (!relayer && routedPool === "big") {
      relayer = pickRoundRobin("small");
      logDebug(traceId, "big_pool_empty_using_small_relayer");
    }
    if (!relayer) {
      logStep(traceId, "LIQ_FAILED", { wallet: walletHex, reason: "no_relayer_available" });
      await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: "no_relayer_available", traceId, priority: 10 });
      continue;
    }

    logStep(traceId, "LIQ_START", { wallet: walletHex, pool: routedPool, gas: estimatedGas?.toString() ?? "unknown" });

    let result: { tx: string; relayer: string; pool: string } | null = null;
    let reroutedToBig = false;

    try {
      result = await sendLiquidationTx({
        relayer,
        publicClient,
        supabase,
        marketHex: marketHexTyped,
        traderWallet: walletHex,
        gasLimit: gasLimitForPool(routedPool),
        traceId,
        label: `liq:${marketHex.slice(0, 10)}:${walletHex.slice(0, 10)}`,
      });
    } catch (sendErr: any) {
      const errMsg = sendErr?.shortMessage || sendErr?.message || String(sendErr);
      const isTxReverted = errMsg.includes("tx_reverted") || errMsg.includes("receipt_check_failed");
      const canRetryBig = bigPool.length > 0 && routedPool !== "big" && (isBlockGasLimitError(sendErr) || isTxReverted);
      if (!canRetryBig) {
        logStep(traceId, "LIQ_FAILED", { wallet: walletHex, pool: routedPool, reason: errMsg.slice(0, 120) });
        await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: `send_fail[${routedPool}]:${errMsg.slice(0, 200)}`, traceId, priority: 5 });
        continue;
      }

      logStep(traceId, "REROUTE_BIG", { wallet: walletHex, reason: isTxReverted ? "tx_reverted" : "block_gas_limit" });

      const bigRelayer = pickRoundRobin("big");
      if (!bigRelayer) {
        logStep(traceId, "LIQ_FAILED", { wallet: walletHex, reason: "no_big_relayer_for_retry" });
        await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: "no_big_relayer_for_block_gas_retry", traceId, priority: 10 });
        continue;
      }

      try {
        reroutedToBig = true;
        result = await sendLiquidationTx({
          relayer: bigRelayer,
          publicClient,
          supabase,
          marketHex: marketHexTyped,
          traderWallet: walletHex,
          gasLimit: gasLimitForPool("big"),
          traceId,
          label: `liq_big:${marketHex.slice(0, 10)}:${walletHex.slice(0, 10)}`,
        });
      } catch (bigErr: any) {
        const bigErrMsg = bigErr?.shortMessage || bigErr?.message || String(bigErr);
        logStep(traceId, "LIQ_FAILED", { wallet: walletHex, pool: "big", reason: bigErrMsg.slice(0, 120) });
        await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: `big_send_fail:${bigErrMsg.slice(0, 200)}`, traceId, priority: 8 });
        continue;
      }
    }

    if (result) {
      liquidations.push({
        wallet: walletHex,
        marketId: marketHexTyped,
        tx: result.tx,
        relayer: result.relayer,
        pool: result.pool,
        reroutedToBig,
        estimatedGas: estimatedGas?.toString() ?? null,
      });
      logStep(traceId, "LIQ_COMPLETE", { wallet: walletHex, tx: result.tx, pool: result.pool, rerouted: reroutedToBig || undefined });
    }
  }

  return { liquidations, checked: aggregates.size };
}

Deno.serve(async (req) => {
  const traceId = `liq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  if (req.method === "GET") {
    return new Response(
      JSON.stringify({ status: "ok", service: "liquidation-direct-webhook", ts: new Date().toISOString(), traceId }),
      { headers: { "content-type": "application/json" } }
    );
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    });
  }

  const raw = await req.text();
  logDebug(traceId, "received", { len: raw?.length || 0 });

  const signature = req.headers.get("x-alchemy-signature");
  const verify = await verifySignature(raw, signature, traceId);
  if (!verify.ok) {
    return new Response(
      JSON.stringify({ ok: false, error: verify.reason || "invalid_signature", traceId }),
      { status: 401, headers: { "content-type": "application/json" } }
    );
  }

  let body: any = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    logStep(traceId, "JSON_ERR", { err: String(e).slice(0, 80) });
  }

  const logs = extractLogs(body);
  logDebug(traceId, "logs", { count: logs.length });

  const supabase =
    SUPABASE_URL && SUPABASE_KEY
      ? createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { autoRefreshToken: false, persistSession: false } })
      : null;

  const results: any[] = [];

  for (const log of logs) {
    const decoded = decodeLog(log);
    if (!decoded) {
      results.push({ status: "skipped", reason: "decode_failed" });
      continue;
    }

    if (decoded.eventName === "TradeRecorded") {
      const args: any = decoded.args;
      const amtRaw = toBigIntSafe(args.amount);
      if (amtRaw === null) {
        results.push({ status: "skipped", reason: "amount_missing" });
        continue;
      }
      const marketHex = normalizeHex32(String(args.marketId || "0x"));
      if (!marketHex) {
        results.push({ status: "skipped", reason: "market_hex_invalid" });
        continue;
      }
      if (!supabase) {
        results.push({ status: "skipped", reason: "no_supabase" });
        continue;
      }

      const marketUuid = await resolveMarketUuid(supabase, marketHex, traceId);
      if (!marketUuid) {
        results.push({ status: "skipped", reason: "market_uuid_not_found" });
        continue;
      }

      const priceNorm = args.price
        ? truncateDecimals(formatUnits(BigInt(args.price), PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS) || "0"
        : "0";
      const liqEvent = args.liquidationPrice
        ? truncateDecimals(formatUnits(BigInt(args.liquidationPrice), PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS)
        : null;
      const tradeTs = args.timestamp ? new Date(Number(args.timestamp) * 1000).toISOString() : new Date().toISOString();
      const orderBookSource = getLogAddressCandidate(log);
      const orderBook = normalizeAddress(orderBookSource) || "";
      const payloadBase = {
        price: priceNorm,
        liquidation_price: liqEvent,
        trade_timestamp: tradeTs,
        order_book_address: orderBook,
      };

      if (args.buyer) {
        await upsertNetTrade({
          supabase,
          marketUuid,
          wallet: String(args.buyer),
          deltaRaw: amtRaw,
          payload: payloadBase,
          traceId,
        });
      }
      if (args.seller) {
        const sellerLiq = (await fetchOnchainLiq(marketHex, String(args.seller), traceId)) || liqEvent;
        await upsertNetTrade({
          supabase,
          marketUuid,
          wallet: String(args.seller),
          deltaRaw: -amtRaw,
          payload: { ...payloadBase, liquidation_price: sellerLiq },
          traceId,
        });
      }

      // After applying the trade delta, verify DB position matches on-chain for both parties
      if (CORE_VAULT && RPC_URL) {
        const tradePublicClient = createPublicClient({ transport: http(RPC_URL) });
        const walletsToReconcile = [
          args.buyer ? String(args.buyer) : null,
          args.seller ? String(args.seller) : null,
        ].filter(Boolean) as string[];

        for (const w of walletsToReconcile) {
          try {
            const dbNet = await fetchDbNetPositionRaw({ supabase, marketUuid, wallet: w, traceId });
            await reconcilePositionSize({
              supabase,
              publicClient: tradePublicClient,
              marketUuid,
              marketHex,
              wallet: w,
              dbNetRaw: dbNet,
              traceId,
            });
          } catch (recErr: any) {
            logStep(traceId, "reconcile_err", {
              wallet: w?.slice(0, 10),
              reason: (recErr?.message || String(recErr)).slice(0, 80),
            });
          }
        }
      }

      results.push({ status: "ok", event: "TradeRecorded", marketId: marketHex });
    } else if (decoded.eventName === "PriceUpdated") {
      if (!supabase) {
        results.push({ status: "skipped", event: "PriceUpdated", reason: "no_supabase" });
        continue;
      }
      const mark = decoded.args.currentMarkPrice;
      const markBn =
        typeof mark === "bigint" ? mark : typeof mark === "number" ? BigInt(mark) : toBigIntSafe(mark);
      if (!markBn) {
        results.push({ status: "skipped", event: "PriceUpdated", reason: "invalid_mark_price" });
        continue;
      }

      logDebug(traceId, "price_payload", { decodedArgs: decoded.args });

      const orderBookCandidates = collectLogAddresses(log);
      logDebug(traceId, "price_event", { orderBook: orderBookCandidates[0] ?? null, mark: markBn.toString() });

      if (!orderBookCandidates.length) {
        logDebug(traceId, "price_no_addr");
        results.push({ status: "skipped", event: "PriceUpdated", reason: "missing_orderbook" });
        continue;
      }

      let marketMeta: { marketUuid: string; marketHex: string } | null = null;
      for (const candidate of orderBookCandidates) {
        marketMeta = await resolveMarketByAddress(supabase, candidate, traceId);
        if (marketMeta) break;
      }
      if (!marketMeta) {
        results.push({ status: "skipped", event: "PriceUpdated", reason: "market_not_resolved" });
        continue;
      }

      const compare = await findCandidatesAndLiquidate(markBn, {
        supabase,
        traceId,
        marketUuid: marketMeta.marketUuid,
        marketHex: marketMeta.marketHex,
      });
      results.push({ status: "ok", event: "PriceUpdated", market: marketMeta.marketUuid, liquidations: compare });
    } else if (
      decoded.eventName === "OrderPlaced" ||
      decoded.eventName === "OrderCancelled" ||
      decoded.eventName === "OrderModified"
    ) {
      if (!supabase) {
        results.push({ status: "skipped", event: decoded.eventName, reason: "no_supabase" });
        continue;
      }

      const orderBookCandidates = collectLogAddresses(log);
      if (!orderBookCandidates.length) {
        results.push({ status: "skipped", event: decoded.eventName, reason: "missing_orderbook" });
        continue;
      }

      let marketMeta: { marketUuid: string; marketHex: string } | null = null;
      let matchedOrderBook: string | null = null;
      for (const candidate of orderBookCandidates) {
        const candidateMeta = await resolveMarketByAddress(supabase, candidate, traceId);
        if (candidateMeta) {
          marketMeta = candidateMeta;
          matchedOrderBook = candidate;
          break;
        }
      }
      if (!marketMeta || !matchedOrderBook) {
        results.push({ status: "skipped", event: decoded.eventName, reason: "market_not_resolved" });
        continue;
      }

      const kernelMark = await fetchOnchainKernelPrice(matchedOrderBook, traceId);
      if (!kernelMark) {
        results.push({ status: "skipped", event: decoded.eventName, reason: "kernel_price_unavailable" });
        continue;
      }
      logStep(traceId, "KERNEL_PRICE_CHECK", {
        market: marketMeta.marketHex.slice(0, 14),
        mark: kernelMark.toString(),
        trigger: decoded.eventName,
      });

      const compare = await findCandidatesAndLiquidate(kernelMark, {
        supabase,
        traceId,
        marketUuid: marketMeta.marketUuid,
        marketHex: marketMeta.marketHex,
      });
      results.push({
        status: "ok",
        event: decoded.eventName,
        market: marketMeta.marketUuid,
        mark: kernelMark.toString(),
        liquidations: compare,
      });
    } else if (decoded.eventName === "LiquidationCompleted") {
      if (!supabase) {
        results.push({ status: "skipped", event: "LiquidationCompleted", reason: "no_supabase" });
        continue;
      }

      const args: any = decoded.args;
      const trader = normalizeAddress(String(args.trader || ""));
      const remainingRaw = toBigIntSafe(args.remainingSize);
      const orderBookCandidates = collectLogAddresses(log);
      const orderBookAddr = orderBookCandidates[0] ?? null;

      if (!trader) {
        results.push({ status: "skipped", event: "LiquidationCompleted", reason: "missing_trader" });
        continue;
      }
      if (remainingRaw === null) {
        results.push({ status: "skipped", event: "LiquidationCompleted", reason: "missing_remaining_size" });
        continue;
      }
      if (!orderBookAddr) {
        results.push({ status: "skipped", event: "LiquidationCompleted", reason: "missing_orderbook" });
        continue;
      }

      let marketMeta: { marketUuid: string; marketHex: string } | null = null;
      for (const candidate of orderBookCandidates) {
        marketMeta = await resolveMarketByAddress(supabase, candidate, traceId);
        if (marketMeta) break;
      }
      if (!marketMeta) {
        results.push({ status: "skipped", event: "LiquidationCompleted", reason: "market_not_resolved" });
        continue;
      }

      // IMPORTANT: `remainingSize` is the on-chain position size AFTER liquidation attempts.
      // Liquidation can be partial; we must NOT force Supabase to 0 unless remainingSize is 0.
      // Instead, reconcile Supabase net position to match remainingSize (apply only the delta).
      const dbNetRaw = await fetchDbNetPositionRaw({
        supabase,
        marketUuid: marketMeta.marketUuid,
        wallet: trader,
        traceId,
      });
      const deltaRaw = remainingRaw - dbNetRaw;
      const nowIso = new Date().toISOString();
      if (deltaRaw !== 0n) {
        await upsertNetTrade({
          supabase,
          marketUuid: marketMeta.marketUuid,
          wallet: trader,
          deltaRaw,
          payload: {
            price: "0",
            liquidation_price: null,
            trade_timestamp: nowIso,
            order_book_address: normalizeAddress(orderBookAddr) || "",
          },
          traceId,
        });
      } else {
        logDebug(traceId, "liq_done_ok", { trader: trader.slice(0, 10) });
      }

      results.push({
        status: "ok",
        event: "LiquidationCompleted",
        trader,
        market: marketMeta.marketUuid,
        orderBook: orderBookAddr,
        deltaApplied: deltaRaw.toString(),
      });
    } else {
      results.push({ status: "skipped", event: decoded.eventName });
    }
  }

  logStep(traceId, "DONE", { n: results.length });
  return new Response(JSON.stringify({ ok: true, processed: results.length, results, traceId }), {
    headers: { "content-type": "application/json" },
  });
});
