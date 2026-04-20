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

function isInsufficientFundsError(err: any): boolean {
  const msg = String(err?.reason || err?.shortMessage || err?.message || err || "").toLowerCase();
  return (
    msg.includes("insufficient funds") ||
    msg.includes("insufficient balance") ||
    msg.includes("sender doesn't have enough funds") ||
    msg.includes("not enough funds")
  );
}

const lowBalanceCache = new Map<string, number>();
const LOW_BALANCE_TTL_MS = 60_000;

function isMarkedLowBalance(address: string): boolean {
  const key = address.toLowerCase();
  const ts = lowBalanceCache.get(key);
  if (!ts) return false;
  if (Date.now() - ts > LOW_BALANCE_TTL_MS) {
    lowBalanceCache.delete(key);
    return false;
  }
  return true;
}

function markLowBalance(address: string): void {
  lowBalanceCache.set(address.toLowerCase(), Date.now());
  console.warn(`[liq][low-balance] marked ${address} as low-balance for ${LOW_BALANCE_TTL_MS / 1000}s`);
}

function getCandidatesForPool(pool: "small" | "big"): RelayerAccount[] {
  const keys = pool === "big" ? getBigPool() : getSmallPool();
  const healthy = keys.filter((k) => !isMarkedLowBalance(k.address));
  const flagged = keys.filter((k) => isMarkedLowBalance(k.address));
  return healthy.length > 0 ? [...healthy, ...flagged] : [...keys];
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
  parseAbiItem(
    "function getUsersWithPositionsInMarket(bytes32 marketId) view returns (address[])"
  ),
  parseAbiItem(
    "function getAllKnownUsers() view returns (address[])"
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

function log(traceId: string, emoji: string, message: string) {
  console.log(`[${traceId}] ${emoji} ${message}`);
}

function logStep(traceId: string, stage: string, data?: Record<string, unknown>) {
  // Simplified: convert common stages to readable messages
  const dataStr = data ? Object.entries(data).map(([k, v]) => `${k}=${v}`).join(" ") : "";
  console.log(`[${traceId}] ${stage} ${dataStr}`.trim());
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

async function fetchOnchainUsersWithPositions(
  publicClient: any,
  marketIdHex: string,
  traceId: string
): Promise<string[]> {
  if (!CORE_VAULT) return [];
  try {
    const users = await publicClient.readContract({
      address: CORE_VAULT as `0x${string}`,
      abi: CORE_VAULT_ABI,
      functionName: "getUsersWithPositionsInMarket",
      args: [marketIdHex as `0x${string}`],
    });
    const userList = (users as string[]) || [];
    logDebug(traceId, "onchain_users", { market: marketIdHex.slice(0, 14), count: userList.length });
    return userList.map((u) => normalizeAddress(u)).filter(Boolean) as string[];
  } catch (e) {
    logStep(traceId, "ONCHAIN_USERS_ERR", { reason: String(e).slice(0, 100) });
    return [];
  }
}

async function fetchOnchainPositionAndLiq(
  publicClient: any,
  trader: string,
  marketIdHex: string,
  traceId: string
): Promise<{ size: bigint; liqPrice: bigint; hasPos: boolean } | null> {
  if (!CORE_VAULT) return null;
  try {
    const [posResult, liqResult] = await Promise.all([
      publicClient.readContract({
        address: CORE_VAULT as `0x${string}`,
        abi: CORE_VAULT_ABI,
        functionName: "getPositionSummary",
        args: [trader as `0x${string}`, marketIdHex as `0x${string}`],
      }),
      publicClient.readContract({
        address: CORE_VAULT as `0x${string}`,
        abi: CORE_VAULT_ABI,
        functionName: "getLiquidationPrice",
        args: [trader as `0x${string}`, marketIdHex as `0x${string}`],
      }),
    ]);
    
    const size = posResult[0] as bigint;
    const liqPrice = liqResult[0] as bigint;
    const hasPos = size !== 0n;
    
    logDebug(traceId, "onchain_full", { 
      trader: trader.slice(0, 10), 
      size: size.toString(), 
      liq: liqPrice.toString(),
      hasPos 
    });
    
    return { size, liqPrice, hasPos };
  } catch (e) {
    logDebug(traceId, "onchain_full_err", { trader: trader.slice(0, 10), reason: String(e).slice(0, 100) });
    return null;
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
  log(traceId, "🔄", `Drift: ${wallet.slice(0, 8)} (Δ${formatUnits(deltaRaw, AMOUNT_DECIMALS)})`);

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

async function fetchQueuedLiquidations(
  supabase: any,
  marketHex: string,
  traceId: string
): Promise<string[]> {
  if (!supabase) return [];
  try {
    const { data, error } = await supabase
      .from("liq_queue")
      .select("address")
      .ilike("market_id", marketHex.toLowerCase())
      .eq("chain_id", LIQ_QUEUE_CHAIN_ID)
      .lt("attempts", LIQ_MAX_ATTEMPTS)
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(50);
    
    if (error) {
      logDebug(traceId, "queue_fetch_err", { err: error.message?.slice(0, 80) });
      return [];
    }
    
    const wallets = (data || []).map((r: any) => normalizeAddress(r.address)).filter(Boolean) as string[];
    if (wallets.length > 0) {
      log(traceId, "📋", `${wallets.length} queued liquidations for retry`);
    }
    return wallets;
  } catch (e: any) {
    logDebug(traceId, "queue_fetch_err", { err: (e?.message || "").slice(0, 80) });
    return [];
  }
}

async function markQueuedLiquidationComplete(
  supabase: any,
  wallet: string,
  marketHex: string,
  traceId: string,
  txHash?: string
) {
  if (!supabase) return;
  try {
    // Find the job ID first, then complete via RPC
    const { data: jobs } = await supabase
      .from("liq_queue")
      .select("id")
      .ilike("address", wallet.toLowerCase())
      .ilike("market_id", marketHex.toLowerCase())
      .eq("chain_id", LIQ_QUEUE_CHAIN_ID)
      .limit(1);
    
    if (jobs && jobs.length > 0) {
      await supabase.rpc("complete_liq_job", {
        p_id: jobs[0].id,
        p_tx_hash: txHash || null,
      });
    }
  } catch {}
}

async function incrementQueuedLiquidationAttempts(
  supabase: any,
  wallet: string,
  marketHex: string,
  error: string,
  traceId: string
) {
  if (!supabase) return;
  try {
    // Find the job ID first, then update via fail_or_requeue_liq_job
    const { data: jobs } = await supabase
      .from("liq_queue")
      .select("id")
      .ilike("address", wallet.toLowerCase())
      .ilike("market_id", marketHex.toLowerCase())
      .eq("chain_id", LIQ_QUEUE_CHAIN_ID)
      .limit(1);
    
    if (jobs && jobs.length > 0) {
      await supabase.rpc("fail_or_requeue_liq_job", {
        p_id: jobs[0].id,
        p_error: error.slice(0, 500),
        p_max_attempts: LIQ_MAX_ATTEMPTS,
      });
    }
  } catch {}
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

// Batch size for parallel RPC calls
const BATCH_SIZE = 20;
const MAX_CONCURRENT_LIQUIDATIONS = 5;

async function batchFetchPositions(
  publicClient: any,
  users: string[],
  marketHex: `0x${string}`,
  traceId: string
): Promise<Map<string, { size: bigint; liqPrice: bigint }>> {
  const results = new Map<string, { size: bigint; liqPrice: bigint }>();
  
  // Process in batches for parallel RPC calls
  for (let i = 0; i < users.length; i += BATCH_SIZE) {
    const batch = users.slice(i, i + BATCH_SIZE);
    const promises = batch.map(async (wallet) => {
      const data = await fetchOnchainPositionAndLiq(publicClient, wallet, marketHex, traceId);
      if (data && data.hasPos && data.size !== 0n) {
        results.set(wallet.toLowerCase(), { size: data.size, liqPrice: data.liqPrice });
      }
    });
    await Promise.all(promises);
  }
  
  return results;
}

type LiqCandidate = {
  wallet: `0x${string}`;
  size: bigint;
  liqPrice: bigint;
  isLong: boolean;
  urgency: bigint; // How far past liquidation price (higher = more urgent)
  isQueued: boolean; // Was this from the liq_queue table?
};

function scoreLiquidationUrgency(markPrice: bigint, liqPrice: bigint, isLong: boolean): bigint {
  // Higher score = more urgent (deeper underwater)
  if (isLong) {
    return liqPrice > markPrice ? liqPrice - markPrice : 0n;
  } else {
    return markPrice > liqPrice ? markPrice - liqPrice : 0n;
  }
}

async function findCandidatesAndLiquidate(
  markPrice: bigint,
  opts: { supabase: any; traceId: string; marketUuid: string; marketHex: string }
) {
  const { traceId, supabase, marketUuid, marketHex } = opts;
  if (!CORE_VAULT || !RPC_URL || !hasAnyRelayer()) {
    return { skipped: true, reason: "missing_config" };
  }

  const smallPool = getSmallPool();
  const bigPool = getBigPool();

  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const marketHexTyped = marketHex as `0x${string}`;
  const marketShort = marketHex.slice(0, 10);
  const markStr = formatUnits(markPrice, PRICE_DECIMALS);

  // Fetch on-chain users AND queued liquidations in parallel
  const [onchainUsers, queuedUsers] = await Promise.all([
    fetchOnchainUsersWithPositions(publicClient, marketHexTyped, traceId),
    fetchQueuedLiquidations(supabase, marketHexTyped, traceId),
  ]);
  
  // Merge: queued liquidations take priority (they already failed once)
  const queuedSet = new Set(queuedUsers.map((u) => u.toLowerCase()));
  const allUsers = [...queuedUsers, ...onchainUsers.filter((u) => !queuedSet.has(u.toLowerCase()))];
  
  if (!allUsers.length) {
    log(traceId, "⏭️", `No positions in market [${marketShort}]`);
    return { skipped: true, reason: "no_onchain_positions" };
  }

  log(traceId, "📊", `Fetching ${allUsers.length} positions @ $${markStr} [${marketShort}]${queuedUsers.length ? ` (${queuedUsers.length} queued)` : ""}`);

  // BATCH FETCH: Get all positions in parallel batches
  const positionMap = await batchFetchPositions(publicClient, allUsers, marketHexTyped, traceId);
  
  // IDENTIFY LIQUIDATABLE: Score and sort by urgency
  const candidates: LiqCandidate[] = [];
  
  for (const [wallet, { size, liqPrice }] of positionMap.entries()) {
    if (liqPrice === 0n) continue;
    
    const isLong = size > 0n;
    const shouldLiq = isLong ? markPrice <= liqPrice : markPrice >= liqPrice;
    const isQueued = queuedSet.has(wallet.toLowerCase());
    
    // For queued liquidations, always retry even if position seems healthy
    // (price may have changed since queueing)
    if (!shouldLiq && !isQueued) continue;
    
    // If position is no longer liquidatable, remove from queue
    if (!shouldLiq && isQueued) {
      await markQueuedLiquidationComplete(supabase, wallet, marketHexTyped, traceId);
      log(traceId, "📋", `Removed ${wallet.slice(0, 8)} from queue (no longer liquidatable)`);
      continue;
    }
    
    const urgency = scoreLiquidationUrgency(markPrice, liqPrice, isLong);
    candidates.push({
      wallet: wallet as `0x${string}`,
      size,
      liqPrice,
      isLong,
      urgency,
      isQueued,
    });
  }
  
  // Sort by urgency (most underwater first)
  candidates.sort((a, b) => (b.urgency > a.urgency ? 1 : b.urgency < a.urgency ? -1 : 0));
  
  if (candidates.length === 0) {
    log(traceId, "✓", `${positionMap.size} positions checked, none liquidatable`);
    return { skipped: false, liquidations: [], checked: positionMap.size };
  }
  
  log(traceId, "🎯", `${candidates.length} liquidatable (most urgent: ${candidates[0].wallet.slice(0, 8)})`);

  // PARALLEL LIQUIDATIONS: Execute up to MAX_CONCURRENT_LIQUIDATIONS at once
  const liquidations: any[] = [];
  
  for (let i = 0; i < candidates.length; i += MAX_CONCURRENT_LIQUIDATIONS) {
    const batch = candidates.slice(i, i + MAX_CONCURRENT_LIQUIDATIONS);
    
    const batchPromises = batch.map(async (candidate) => {
      const { wallet: walletHex, isLong, liqPrice: liqBn, isQueued } = candidate;
      const dir = isLong ? "LONG" : "SHORT";
      const liqStr = formatUnits(liqBn, PRICE_DECIMALS);

      // Gas estimation & pool routing
      let routedPool: "small" | "big" = smallPool.length > 0 ? "small" : "big";
      const estimateFrom = (smallPool[0] || bigPool[0])?.address;
      let estimatedGasBuffered: bigint | null = null;

      if (estimateFrom) {
        try {
          const callData = encodeFunctionData({
            abi: CORE_VAULT_ABI,
            functionName: "liquidateDirect",
            args: [marketHexTyped, walletHex],
          });
          const estimatedGas = await publicClient.estimateGas({
            account: estimateFrom,
            to: CORE_VAULT as `0x${string}`,
            data: callData,
          });
          estimatedGasBuffered = (estimatedGas * GAS_ESTIMATE_BUFFER_BPS) / 10000n;
          if (estimatedGasBuffered > SMALL_BLOCK_GAS_LIMIT) routedPool = "big";
        } catch {}
      }

      const safetySmall = 120_000n;
      const safetyBig = 300_000n;
      const gasLimitForPool = (pool: "small" | "big"): bigint | undefined => {
        const desired = estimatedGasBuffered && estimatedGasBuffered > 0n ? estimatedGasBuffered + 50_000n : undefined;
        const cap = pool === "big"
          ? (BIG_BLOCK_GAS_LIMIT > safetyBig ? BIG_BLOCK_GAS_LIMIT - safetyBig : BIG_BLOCK_GAS_LIMIT)
          : (SMALL_BLOCK_GAS_LIMIT > safetySmall ? SMALL_BLOCK_GAS_LIMIT - safetySmall : SMALL_BLOCK_GAS_LIMIT);
        return desired && desired > cap ? cap : desired;
      };

      // Simulate first
      const simAccount = routedPool === "big" ? (bigPool[0] || smallPool[0]) : (smallPool[0] || bigPool[0]);
      try {
        await publicClient.simulateContract({
          address: CORE_VAULT as `0x${string}`,
          abi: CORE_VAULT_ABI,
          functionName: "liquidateDirect",
          args: [marketHexTyped, walletHex],
          account: simAccount.address,
        });
      } catch (simErr: any) {
        // If this was a queued liquidation that failed simulation, increment attempts
        if (isQueued) {
          const errMsg = simErr?.shortMessage || simErr?.message || "simulation_failed";
          await incrementQueuedLiquidationAttempts(supabase, walletHex, marketHexTyped, errMsg.slice(0, 200), traceId);
        }
        return { status: "skipped", wallet: walletHex, reason: "simulation_failed" };
      }

      let relayerCandidates = getCandidatesForPool(routedPool);
      if (relayerCandidates.length === 0 && routedPool === "big") {
        relayerCandidates = getCandidatesForPool("small");
      }
      if (relayerCandidates.length === 0) {
        if (isQueued) {
          await incrementQueuedLiquidationAttempts(supabase, walletHex, marketHexTyped, "no_relayer_available", traceId);
        } else {
          await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: "no_relayer_available", traceId, priority: 10 });
        }
        return { status: "failed", wallet: walletHex, reason: "no_relayer" };
      }

      log(traceId, "⚡", `${dir} ${walletHex.slice(0, 8)} liq=$${liqStr}`);

      // Try relayers
      for (const relayer of relayerCandidates) {
        try {
          const result = await sendLiquidationTx({
            relayer,
            publicClient,
            supabase,
            marketHex: marketHexTyped,
            traderWallet: walletHex,
            gasLimit: gasLimitForPool(routedPool),
            traceId,
            label: `liq:${marketHex.slice(0, 10)}:${walletHex.slice(0, 10)}`,
          });
          log(traceId, "✅", `${walletHex.slice(0, 8)} tx=${result.tx.slice(0, 12)}${isQueued ? " (queued)" : ""}`);
          // Remove from queue on success
          if (isQueued) {
            await markQueuedLiquidationComplete(supabase, walletHex, marketHexTyped, traceId, result.tx);
          }
          return { status: "success", wallet: walletHex, tx: result.tx, pool: result.pool };
        } catch (sendErr: any) {
          if (isInsufficientFundsError(sendErr)) {
            markLowBalance(relayer.address);
            continue;
          }
          const errMsg = sendErr?.shortMessage || sendErr?.message || String(sendErr);
          if (isQueued) {
            await incrementQueuedLiquidationAttempts(supabase, walletHex, marketHexTyped, errMsg.slice(0, 200), traceId);
          } else {
            await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: errMsg.slice(0, 200), traceId, priority: 5 });
          }
          return { status: "failed", wallet: walletHex, reason: errMsg.slice(0, 60) };
        }
      }

      if (isQueued) {
        await incrementQueuedLiquidationAttempts(supabase, walletHex, marketHexTyped, "all_relayers_insufficient", traceId);
      } else {
        await enqueueLiqFailure({ supabase, wallet: walletHex, marketHex: marketHexTyped, error: "all_relayers_insufficient", traceId, priority: 10 });
      }
      return { status: "failed", wallet: walletHex, reason: "all_relayers_low_funds" };
    });

    const batchResults = await Promise.allSettled(batchPromises);
    
    for (const r of batchResults) {
      if (r.status === "fulfilled" && r.value?.status === "success") {
        liquidations.push(r.value);
      }
    }
  }

  const successCount = liquidations.filter((l) => l.status === "success").length;
  log(traceId, "📋", `${successCount}/${candidates.length} liquidated, ${positionMap.size} checked`);

  // BACKGROUND: Sync DB with on-chain (non-blocking, fire-and-forget)
  if (supabase && positionMap.size > 0) {
    reconcileDbInBackground(supabase, marketUuid, marketHexTyped, positionMap, traceId);
  }

  return { liquidations, checked: positionMap.size, liquidatable: candidates.length };
}

// Fire-and-forget DB reconciliation (runs after liquidations complete)
function reconcileDbInBackground(
  supabase: any,
  marketUuid: string,
  marketHex: string,
  positionMap: Map<string, { size: bigint; liqPrice: bigint }>,
  traceId: string
) {
  (async () => {
    let synced = 0;
    for (const [wallet, { size, liqPrice }] of positionMap.entries()) {
      try {
        const dbNet = await fetchDbNetPositionRaw({ supabase, marketUuid, wallet, traceId });
        if (dbNet !== size) {
          const deltaRaw = size - dbNet;
          await upsertNetTrade({
            supabase,
            marketUuid,
            wallet,
            deltaRaw,
            payload: {
              price: "0",
              liquidation_price: truncateDecimals(formatUnits(liqPrice, PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS),
              trade_timestamp: new Date().toISOString(),
              order_book_address: "",
            },
            traceId,
          });
          synced++;
        }
      } catch {}
    }
    if (synced > 0) {
      log(traceId, "🔄", `Background sync: ${synced} positions corrected`);
    }
  })().catch(() => {});
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

  for (const eventLog of logs) {
    const decoded = decodeLog(eventLog);
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
      const orderBookSource = getLogAddressCandidate(eventLog);
      const orderBook = normalizeAddress(orderBookSource) || "";
      const payloadBase = {
        price: priceNorm,
        liquidation_price: liqEvent,
        trade_timestamp: tradeTs,
        order_book_address: orderBook,
      };

      // ALWAYS verify on-chain position and liquidation price for both parties
      const tradePublicClient = CORE_VAULT && RPC_URL ? createPublicClient({ transport: http(RPC_URL) }) : null;
      const walletsToSync = [
        args.buyer ? String(args.buyer) : null,
        args.seller ? String(args.seller) : null,
      ].filter(Boolean) as string[];

      for (const w of walletsToSync) {
        const walletNorm = normalizeAddress(w);
        if (!walletNorm) continue;

        // Fetch on-chain position and liquidation price
        let onchainSize: bigint | null = null;
        let onchainLiqPrice: bigint | null = null;
        
        if (tradePublicClient) {
          try {
            const onchainData = await fetchOnchainPositionAndLiq(tradePublicClient, walletNorm, marketHex, traceId);
            if (onchainData) {
              onchainSize = onchainData.size;
              onchainLiqPrice = onchainData.liqPrice;
            }
          } catch (e: any) {
            logDebug(traceId, "onchain_fetch_err", { wallet: walletNorm.slice(0, 10), reason: String(e).slice(0, 80) });
          }
        }

        // Use on-chain data as source of truth, fallback to event data
        const liqPriceStr = onchainLiqPrice !== null && onchainLiqPrice !== 0n
          ? truncateDecimals(formatUnits(onchainLiqPrice, PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS)
          : liqEvent;

        // If we have on-chain size, sync DB to match exactly
        if (onchainSize !== null) {
          const dbNet = await fetchDbNetPositionRaw({ supabase, marketUuid, wallet: walletNorm, traceId });
          const deltaRaw = onchainSize - dbNet;
          
          if (deltaRaw !== 0n) {
            log(traceId, "🔄", `Trade sync: ${walletNorm.slice(0, 8)} (Δ${formatUnits(deltaRaw, AMOUNT_DECIMALS)})`);
            await upsertNetTrade({
              supabase,
              marketUuid,
              wallet: walletNorm,
              deltaRaw,
              payload: { ...payloadBase, liquidation_price: liqPriceStr },
              traceId,
            });
          } else {
            logDebug(traceId, "trade_in_sync", { wallet: walletNorm.slice(0, 10) });
          }
        } else {
          // Fallback: apply event delta if on-chain fetch failed
          const isBuyer = normalizeAddress(String(args.buyer)) === walletNorm;
          const deltaRaw = isBuyer ? amtRaw : -amtRaw;
          await upsertNetTrade({
            supabase,
            marketUuid,
            wallet: walletNorm,
            deltaRaw,
            payload: { ...payloadBase, liquidation_price: liqPriceStr },
            traceId,
          });
        }
      }

      results.push({ status: "ok", event: "TradeRecorded", marketId: marketHex });
    } else if (decoded.eventName === "PriceUpdated") {
      // Liquidation checks use on-chain data primarily, supabase is optional for DB sync
      const mark = decoded.args.currentMarkPrice;
      const markBn =
        typeof mark === "bigint" ? mark : typeof mark === "number" ? BigInt(mark) : toBigIntSafe(mark);
      if (!markBn) {
        results.push({ status: "skipped", event: "PriceUpdated", reason: "invalid_mark_price" });
        continue;
      }

      logDebug(traceId, "price_payload", { decodedArgs: decoded.args });

      const orderBookCandidates = collectLogAddresses(eventLog);
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

      const orderBookCandidates = collectLogAddresses(eventLog);
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
      log(traceId, "📈", `${decoded.eventName} → checking @ $${formatUnits(kernelMark, PRICE_DECIMALS)}`);

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
      const orderBookCandidates = collectLogAddresses(eventLog);
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

  log(traceId, "✓", `Done (${results.length} events)`);
  return new Response(JSON.stringify({ ok: true, processed: results.length, results, traceId }), {
    headers: { "content-type": "application/json" },
  });
});
