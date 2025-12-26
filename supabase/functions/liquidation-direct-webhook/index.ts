import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { decodeEventLog, Hex, parseAbiItem, createPublicClient, createWalletClient, http } from "npm:viem";
import { privateKeyToAccount } from "npm:viem/accounts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL");
const SUPABASE_KEY =
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ||
  Deno.env.get("SUPABASE_SERVICE_KEY") ||
  Deno.env.get("SUPABASE_ANON_KEY");
const SIGNING_KEY = Deno.env.get("LIQUIDATION_DIRECT_SIGN_IN_KEY") || "";

// On-chain (HyperLiquid mainnet)
const LIQUIDATOR_PK = Deno.env.get("LIQUIDATOR_PRIVATE_KEY") || Deno.env.get("PRIVATE_KEY") || "";
const RPC_URL = Deno.env.get("HUB_RPC_URL") || "";
const CORE_VAULT = Deno.env.get("CORE_VAULT_ADDRESS") || ""; // single source of truth

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
  parseAbiItem("event PriceUpdated(uint256 lastTradePrice,uint256 currentMarkPrice)")
];

const CORE_VAULT_ABI = [
  parseAbiItem(
    "function getLiquidationPrice(address user, bytes32 marketId) view returns (uint256 liquidationPrice, bool hasPosition)"
  ),
  parseAbiItem("function liquidateDirect(bytes32 marketId, address trader)")
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

function logStep(traceId: string, stage: string, data?: Record<string, unknown>) {
  try {
    console.log(`[liq-webhook][${traceId}][${stage}]`, data || {});
  } catch (_) {}
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
        logStep(opts.traceId, "db_net_fetch_error", {
          marketUuid: opts.marketUuid,
          wallet: walletLower,
          message: res.error.message,
        });
        break;
      }
      data = res?.data || [];
    } catch (e) {
      logStep(opts.traceId, "db_net_fetch_exception", {
        marketUuid: opts.marketUuid,
        wallet: walletLower,
        error: (e as any)?.message || String(e),
      });
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

  logStep(opts.traceId, "db_net_position", { marketUuid: opts.marketUuid, wallet: walletLower, netRaw: total.toString() });
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
    logStep(traceId, "signature_checked", { match });
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
        logStep(traceId, "market_uuid_resolved", { marketHex: norm, marketUuid: data.id, matched: c });
        return data.id as string;
      }
    } catch (e) {
      logStep(traceId, "market_lookup_exception", {
        marketHex: norm,
        candidate: c,
        error: (e as any)?.message || String(e),
      });
    }
  }
  logStep(traceId, "market_uuid_not_found", { marketHex: norm });
  return null;
}

async function resolveMarketByAddress(supabase: any, address: string | null | undefined, traceId: string) {
  const normalized = normalizeAddress(address);
  if (!normalized) {
    logStep(traceId, "market_by_address_input_invalid", { address });
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
      logStep(traceId, "market_by_address_error", { address: normalized, message: error.message });
      return null;
    }
    if (!data?.id || !data?.market_id_bytes32) {
      logStep(traceId, "market_by_address_not_found", { address: normalized });
      return null;
    }
    const marketHex = normalizeHex32(String(data.market_id_bytes32));
    if (!marketHex) {
      logStep(traceId, "market_by_address_invalid_hex", { address: normalized, raw: data.market_id_bytes32 });
      return null;
    }
    const resolved = { marketUuid: data.id as string, marketHex };
    marketAddressCache.set(normalized, resolved);
    logStep(traceId, "market_by_address_resolved", {
      address: normalized,
      marketUuid: resolved.marketUuid,
      marketHex: resolved.marketHex,
    });
    return resolved;
  } catch (e) {
    logStep(traceId, "market_by_address_exception", { address: normalized, error: (e as any)?.message || String(e) });
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
    logStep(traceId, "onchain_liq_fetch", { marketHex, wallet, liq: liq?.toString?.() });
    return liq !== undefined
      ? truncateDecimals(formatUnits(liq, PRICE_DECIMALS), LIQUIDATION_DISPLAY_DECIMALS)
      : null;
  } catch (e) {
    logStep(traceId, "onchain_liq_fetch_error", { marketHex, wallet, reason: (e as any)?.message || String(e) });
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
      logStep(traceId, "onchain_liq_retry", { attempt, wallet, marketHex, last });
      if (delayMs) await sleep(delayMs);
    }
  }

  if (isZeroLike(last)) {
    logStep(traceId, "onchain_liq_zero_after_retries", { wallet, marketHex });
    return null;
  }

  return last;
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
      logStep(opts.traceId, "net_rpc_error", { wallet: walletLower, marketId: opts.marketUuid, error: error.message });
    } else {
      logStep(opts.traceId, "net_rpc_success", { wallet: walletLower, marketId: opts.marketUuid, delta: deltaFormatted });
    }
  } catch (e) {
    logStep(opts.traceId, "net_rpc_exception", {
      wallet: walletLower,
      marketId: opts.marketUuid,
      error: (e as any)?.message || String(e),
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
    logStep(traceId, "onchain_liq", { trader, marketId: marketIdHex, liq: liqPrice?.toString?.(), hasPos });
    return { liq: liqPrice as bigint, hasPos: Boolean(hasPos) };
  } catch (e) {
    logStep(traceId, "onchain_liq_error", { trader, marketId: marketIdHex, reason: String(e) });
    return { liq: null, hasPos: false, reason: "read_error" };
  }
}

async function findCandidatesAndLiquidate(
  markPrice: bigint,
  opts: { supabase: any; traceId: string; marketUuid: string; marketHex: string }
) {
  const { traceId, supabase, marketUuid, marketHex } = opts;
  if (!supabase || !CORE_VAULT || !RPC_URL || !LIQUIDATOR_PK) return { skipped: true, reason: "missing_config" };

  logStep(traceId, "price_update_processing", { marketUuid, marketHex, mark: markPrice.toString() });

  let rows: any[] = [];
  logStep(traceId, "price_update_fetch_trades", { marketUuid });
  try {
    const { data, error } = await supabase
      .from(USER_TRADES_TABLE)
      .select("user_wallet_address,liquidation_price,amount")
      .eq("market_id", marketUuid)
      .limit(5000);
    if (error) {
      logStep(traceId, "liq_fetch_error", { message: error.message, marketUuid });
      return { skipped: true, reason: "db_error" };
    }
    rows = data || [];
  } catch (e) {
    logStep(traceId, "liq_fetch_exception", { message: (e as any)?.message || String(e), marketUuid });
    return { skipped: true, reason: "db_exception" };
  }

  logStep(traceId, "price_update_trades_loaded", { marketUuid, count: rows.length });

  if (!rows.length) {
    logStep(traceId, "price_update_no_trades", { marketUuid });
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
    logStep(traceId, "liq_no_open_positions", { marketUuid });
    return { skipped: true, reason: "no_positions" };
  }

  const account = privateKeyToAccount(LIQUIDATOR_PK.startsWith("0x") ? LIQUIDATOR_PK : "0x" + LIQUIDATOR_PK);
  const publicClient = createPublicClient({ transport: http(RPC_URL) });
  const walletClient = createWalletClient({ account, transport: http(RPC_URL) });

  const liquidations: any[] = [];
  const marketHexTyped = marketHex as `0x${string}`;

  for (const { wallet, netRaw, liq } of aggregates.values()) {
    if (netRaw === 0n) continue;
    const walletHex = wallet as `0x${string}`;

    const { liq: onchainLiq, hasPos } = await readOnchainLiq(publicClient, walletHex, marketHexTyped, traceId);
    if (!hasPos) continue;

    const storedLiqRaw = liq ? decimalToUnits(liq, PRICE_DECIMALS) : null;
    const liqBn = onchainLiq !== null ? onchainLiq : storedLiqRaw;
    if (liqBn === null) continue;

    const isLong = netRaw > 0n;
    const shouldLiq = isLong ? markPrice <= liqBn : markPrice >= liqBn;
    if (!shouldLiq) continue;

    logStep(traceId, "liquidation_candidate", {
      wallet: walletHex,
      marketId: marketHexTyped,
      direction: isLong ? "long" : "short",
      mark: markPrice.toString(),
      liq: liqBn.toString(),
      netRaw: netRaw.toString(),
    });

    try {
      await publicClient.simulateContract({
        address: CORE_VAULT as `0x${string}`,
        abi: CORE_VAULT_ABI,
        functionName: "liquidateDirect",
        args: [marketHexTyped, walletHex],
        account: account.address,
      });
    } catch (simErr) {
      logStep(traceId, "liq_simulate_fail", { wallet: walletHex, marketId: marketHexTyped, reason: String(simErr) });
      continue;
    }

    try {
      const tx = await walletClient.writeContract({
        address: CORE_VAULT as `0x${string}`,
        abi: CORE_VAULT_ABI,
        functionName: "liquidateDirect",
        args: [marketHexTyped, walletHex],
      });
      liquidations.push({ wallet: walletHex, marketId: marketHexTyped, tx });
      logStep(traceId, "liq_sent", { wallet: walletHex, marketId: marketHexTyped, tx });
    } catch (sendErr) {
      logStep(traceId, "liq_send_error", { wallet: walletHex, marketId: marketHexTyped, reason: String(sendErr) });
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
  logStep(traceId, "received", { method: req.method, url: req.url, rawLen: raw?.length || 0 });

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
    logStep(traceId, "json_parse_error", { error: String(e) });
  }

  const logs = extractLogs(body);
  logStep(traceId, "logs_extracted", { count: logs.length });

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

      logStep(traceId, "price_update_payload", { rawLog: log, decodedArgs: decoded.args });

      const orderBookCandidates = collectLogAddresses(log);
      logStep(traceId, "price_update_event", {
        orderBook: orderBookCandidates[0] ?? null,
        candidates: orderBookCandidates,
        mark: markBn.toString(),
      });

      if (!orderBookCandidates.length) {
        logStep(traceId, "price_update_missing_address", { logHasAddress: Boolean(log?.address) });
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
        logStep(traceId, "liq_completed_no_reconcile_needed", { trader, market: marketMeta.marketUuid });
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

  logStep(traceId, "done", { processed: results.length });
  return new Response(JSON.stringify({ ok: true, processed: results.length, results, traceId }), {
    headers: { "content-type": "application/json" },
  });
});
