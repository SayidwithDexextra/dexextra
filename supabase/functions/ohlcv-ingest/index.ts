import "jsr:@supabase/functions-js/edge-runtime.d.ts";

/**
 * OHLCV ingest (Alchemy webhook → ClickHouse market_ticks → MV → ohlcv_1m)
 *
 * Key guarantees:
 * - Persist ONLY raw events into ClickHouse `market_ticks` (canonical tick stream).
 * - Do NOT write directly to `ohlcv_1m` by default (MV is the source of truth).
 * - Broadcast latest 1m candles to Pusher for realtime charts.
 */

// Helpers
const enc = new TextEncoder();

function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = "";
  for (let i = 0; i < bytes.length; i++) {
    const h = bytes[i].toString(16).padStart(2, "0");
    hex += h;
  }
  return hex;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) throw new Error("Invalid hex length");
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return toHex(sig);
}

async function verifyAlchemySignature(rawBody: string, providedSig: string | null): Promise<boolean> {
  const singleKey = Deno.env.get("ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV") || "";
  const listKeys = Deno.env.get("ALCHEMY_WEBHOOK_SIGNING_KEYS_OHLCV") || "";
  const keys = [...new Set([singleKey, ...listKeys.split(",").map((s) => s.trim())].filter(Boolean))];
  if (keys.length === 0) return true; // no keys configured -> allow (dev)
  if (!providedSig) return false;

  const providedBytes = hexToBytes(providedSig.toLowerCase());
  for (const key of keys) {
    const expectedHex = await hmacSha256Hex(key, rawBody);
    const expectedBytes = hexToBytes(expectedHex);
    if (timingSafeEqual(providedBytes, expectedBytes)) return true;
  }
  return false;
}

function parseUint256HexToFloat(hexWord: string, decimals: number): number {
  const clean = hexWord.startsWith("0x") ? hexWord.slice(2) : hexWord;
  const big = BigInt("0x" + clean);
  const scale = 10n ** BigInt(decimals);
  const intPart = Number(big / scale);
  const fracPart = Number(big % scale) / Number(scale);
  return intPart + fracPart;
}

function splitDataToWords(data: string): string[] {
  const clean = data.startsWith("0x") ? data.slice(2) : data;
  const words: string[] = [];
  for (let i = 0; i < clean.length; i += 64) {
    words.push("0x" + clean.slice(i, i + 64));
  }
  return words;
}

function formatDateTimeUTC(tsSeconds: number): string {
  const d = new Date(tsSeconds * 1000);
  const pad = (n: number) => n.toString().padStart(2, "0");
  const yyyy = d.getUTCFullYear();
  const mm = pad(d.getUTCMonth() + 1);
  const dd = pad(d.getUTCDate());
  const hh = pad(d.getUTCHours());
  const mi = pad(d.getUTCMinutes());
  const ss = pad(d.getUTCSeconds());
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
}

function toFiniteNumber(v: any, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

// --- Pusher REST trigger helpers ---
// We use Pusher REST API directly from Deno. For POST requests, Pusher expects `body_md5`.
// This MD5 implementation is small and self-contained for UTF-8 strings.
function md5HexUtf8(input: string): string {
  // Based on a minimal MD5 implementation (public domain style)
  const bytes = enc.encode(input);

  const toUint32 = (x: number) => x >>> 0;
  const rol = (x: number, c: number) => (x << c) | (x >>> (32 - c));

  const K = new Uint32Array([
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
    0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
    0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
    0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
    0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
    0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
    0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
    0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
    0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
  ]);

  const S = new Uint8Array([
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ]);

  // Pre-processing: padding the message
  // IMPORTANT:
  // - MD5 appends the original message length as a 64-bit little-endian integer (bits).
  // - JS bit shifts mask shift counts to 0..31, so using `>>> 32` etc is WRONG.
  // - Use BigInt to encode the 64-bit length correctly.
  const bitLen = BigInt(bytes.length) * 8n;
  const withOne = bytes.length + 1;
  const padLen = (withOne % 64 <= 56) ? (56 - (withOne % 64)) : (56 + (64 - (withOne % 64)));
  const totalLen = withOne + padLen + 8;

  const msg = new Uint8Array(totalLen);
  msg.set(bytes, 0);
  msg[bytes.length] = 0x80;

  // Append original length in bits as little-endian 64-bit
  for (let i = 0; i < 8; i++) {
    msg[totalLen - 8 + i] = Number((bitLen >> (8n * BigInt(i))) & 0xffn);
  }

  let a0 = 0x67452301;
  let b0 = 0xefcdab89;
  let c0 = 0x98badcfe;
  let d0 = 0x10325476;

  const M = new Uint32Array(16);

  for (let i = 0; i < msg.length; i += 64) {
    for (let j = 0; j < 16; j++) {
      const k = i + j * 4;
      M[j] = msg[k] | (msg[k + 1] << 8) | (msg[k + 2] << 16) | (msg[k + 3] << 24);
    }

    let A = a0;
    let B = b0;
    let C = c0;
    let D = d0;

    for (let t = 0; t < 64; t++) {
      let F: number;
      let g: number;

      if (t < 16) {
        F = (B & C) | (~B & D);
        g = t;
      } else if (t < 32) {
        F = (D & B) | (~D & C);
        g = (5 * t + 1) % 16;
      } else if (t < 48) {
        F = B ^ C ^ D;
        g = (3 * t + 5) % 16;
      } else {
        F = C ^ (B | ~D);
        g = (7 * t) % 16;
      }

      const tmp = D;
      D = C;
      C = B;
      const sum = toUint32(A + toUint32(F) + K[t] + M[g]);
      B = toUint32(B + rol(sum, S[t]));
      A = tmp;
    }

    a0 = toUint32(a0 + A);
    b0 = toUint32(b0 + B);
    c0 = toUint32(c0 + C);
    d0 = toUint32(d0 + D);
  }

  const out = new Uint8Array(16);
  const words = [a0, b0, c0, d0];
  for (let i = 0; i < 4; i++) {
    out[i * 4 + 0] = words[i] & 0xff;
    out[i * 4 + 1] = (words[i] >>> 8) & 0xff;
    out[i * 4 + 2] = (words[i] >>> 16) & 0xff;
    out[i * 4 + 3] = (words[i] >>> 24) & 0xff;
  }

  // bytes -> hex
  return Array.from(out).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function pusherTrigger(
  channel: string,
  eventName: string,
  data: any,
): Promise<{ ok: boolean; status: number; text?: string; url?: string; skipped?: boolean; reason?: string }> {
  const appId = Deno.env.get("PUSHER_APP_ID") || "";
  const key = Deno.env.get("PUSHER_KEY") || "";
  const secret = Deno.env.get("PUSHER_SECRET") || "";
  const cluster = Deno.env.get("PUSHER_CLUSTER") || "us2";

  if (!appId || !key || !secret) {
    return { ok: true, status: 200, skipped: true, reason: "pusher_not_configured" };
  }

  const path = `/apps/${appId}/events`;
  const bodyObj = {
    name: eventName,
    channels: [channel],
    data: JSON.stringify(data),
  };
  const body = JSON.stringify(bodyObj);

  const body_md5 = md5HexUtf8(body);
  const auth_timestamp = Math.floor(Date.now() / 1000);
  const queryParts: Array<[string, string]> = [
    ["auth_key", key],
    ["auth_timestamp", String(auth_timestamp)],
    ["auth_version", "1.0"],
    ["body_md5", body_md5],
  ];
  queryParts.sort((a, b) => a[0].localeCompare(b[0]));
  const qs = queryParts.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");

  const stringToSign = `POST\n${path}\n${qs}`;
  const auth_signature = await hmacSha256Hex(secret, stringToSign);
  const url = `https://api-${cluster}.pusher.com${path}?${qs}&auth_signature=${auth_signature}`;

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body,
  });
  const text = await resp.text().catch(() => undefined);
  return { ok: resp.ok, status: resp.status, text, url };
}

// Normalized trade shape (subset used for logging)
interface NormalizedTrade {
  symbol?: string;
  ts: number; // seconds
  price: number;
  size: number;
  side: "buy" | "sell";
  maker?: 0 | 1;
  trade_id?: string;
  order_id?: string;
  market_id?: number;
  market_uuid?: string;
  contract_address: string;
  log_index?: number;
  tx_index?: number;
  tx_hash?: string;
}

// Market row shape used in Step 5 logging
interface MarketRow {
  id: string;
  market_identifier?: string;
  symbol?: string;
  market_address: string;
}

// ClickHouse insert row shape for market_ticks
interface CHMarketTickRow {
  symbol: string;
  ts: string; // 'YYYY-MM-DD HH:mm:ss' UTC
  price: number;
  size: number;
  event_type: string;
  is_long: number;
  event_id: string;
  trade_count: number;
  market_id: number;
  market_uuid: string;
  contract_address: string;
}

interface CHCandle1mRow {
  market_uuid: string;
  market_id: number;
  symbol?: string;
  ts: string; // 'YYYY-MM-DD HH:mm:ss' UTC (bucket start)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  trades: number;
}

function detectType(body: any): "ADDRESS_ACTIVITY" | "GRAPHQL" | "UNKNOWN" {
  const t = (body?.type || "").toString().toUpperCase();
  if (t === "ADDRESS_ACTIVITY" || t === "GRAPHQL") return t as any;
  if (body?.event?.data?.block?.logs) return "GRAPHQL";
  if (body?.event?.activity) return "ADDRESS_ACTIVITY";
  return "UNKNOWN";
}

// Strict trade topics (no ENV) — accept only true executions for your OB
const TOPIC_ORDER_FILLED = "0xec7abeea99156aa60ed39992d78c95b0082f64d3469447a70c7fd11981912b9f";
const TOPIC_TRADE_EXECUTED = "0xb0100c4a25ad7c8bfaa42766f529176b9340f45755da88189bd092353fe50f0b";
const TOPIC_OB_PRICE_WORD0_SIZE_WORD1 = "0xb242177834d07ac02a9f62e34602e5da9d353cbe7df4378423ba8765a4793d80";

// topic → field order mapping
const TRADE_TOPIC_MAP: Record<string, { priceIdx: number; sizeIdx: number }> = {
  [TOPIC_ORDER_FILLED]: { priceIdx: 1, sizeIdx: 0 },
  [TOPIC_TRADE_EXECUTED]: { priceIdx: 1, sizeIdx: 0 },
  [TOPIC_OB_PRICE_WORD0_SIZE_WORD1]: { priceIdx: 0, sizeIdx: 1 },
};

function isPlausible(price: number, size: number): boolean {
  if (!(price > 0) || !(size > 0)) return false;
  if (price > 1e9 || size > 1e9) return false;
  return true;
}

function extractFromGraphql(body: any, priceDecimals: number, sizeDecimals: number): NormalizedTrade[] {
  const logs = body?.event?.data?.block?.logs || body?.event?.block?.logs || [];
  const blockTs = toFiniteNumber(
    body?.event?.data?.block?.timestamp ??
      body?.event?.block?.timestamp ??
      body?.event?.data?.block?.header?.timestamp ??
      Date.now() / 1000,
  );
  const out: NormalizedTrade[] = [];

  for (const log of logs) {
    const addr: string = (log?.account?.address || log?.address || "").toLowerCase();
    const data: string = log?.data || "";
    const topics: string[] = (log?.topics || []).map((t: string) => (t || "").toLowerCase());
    if (!addr || !data || data.length < 66) continue;

    const topic0 = topics[0] || "";
    const map = TRADE_TOPIC_MAP[topic0];
    if (!map) continue; // skip non-trade topics entirely

    const words = splitDataToWords(data);
    const priceHex = words[map.priceIdx] || "0x0";
    const sizeHex = words[map.sizeIdx] || "0x0";
    const price = parseUint256HexToFloat(priceHex, priceDecimals);
    const size = parseUint256HexToFloat(sizeHex, sizeDecimals);

    const ts = Math.floor(toFiniteNumber(log?.timestamp ?? log?.timeStamp ?? blockTs, blockTs));
    const logIndex = toFiniteNumber(log?.logIndex ?? log?.log_index ?? log?.index, 0);
    const txIndex = toFiniteNumber(log?.transactionIndex ?? log?.transaction_index, 0);
    const txHash = (log?.transaction?.hash || log?.transactionHash || log?.txHash || log?.hash || "").toString();

    console.log("[AlchemyTrades] price_capture", {
      path: "graphql",
      mapping: `topic_map:p${map.priceIdx}s${map.sizeIdx}`,
      contract_address: addr,
      topic0,
      price_hex: priceHex,
      size_hex: sizeHex,
      price,
      size,
      priceDecimals,
      sizeDecimals,
      ts,
      logIndex,
      txIndex,
      txHash: txHash || undefined,
    });

    if (isPlausible(price, size)) {
      out.push({
        ts,
        price,
        size,
        side: "buy",
        contract_address: addr,
        log_index: logIndex,
        tx_index: txIndex,
        tx_hash: txHash || undefined,
      });
    }
  }

  if (out.length === 0) {
    const seen = Array.from(
      new Set(
        (body?.event?.data?.block?.logs || body?.event?.block?.logs || []).map((l: any) =>
          (l?.topics?.[0] || "").toLowerCase()
        ),
      ),
    );
    console.log("[AlchemyTrades] no_trades_after_filter", { topics: seen });
  }

  return out;
}

function extractFromAddressActivity(body: any, priceDecimals: number, sizeDecimals: number): NormalizedTrade[] {
  const acts = body?.event?.activity || [];
  const out: NormalizedTrade[] = [];
  for (const a of acts) {
    const addr: string = (a?.rawContract?.address || a?.contractAddress || "").toLowerCase();
    const params: Array<{ name: string; value: any }> = a?.log?.decoded?.params || [];
    let price: number | null = null;
    let size: number | null = null;
    let side: "buy" | "sell" = "buy";

    let priceSource: string | null = null;
    let sizeSource: string | null = null;
    let priceHex: string | null = null;
    let sizeHex: string | null = null;

    for (const p of params) {
      const name = (p?.name || "").toLowerCase();
      if (name === "price") {
        const v = typeof p.value === "string" && p.value.startsWith("0x") ? p.value : "0x" + BigInt(p.value).toString(16);
        price = parseUint256HexToFloat(v, priceDecimals);
        priceSource = "decoded_param";
        priceHex = v;
      }
      if (name === "quantity" || name === "size") {
        const v = typeof p.value === "string" && p.value.startsWith("0x") ? p.value : "0x" + BigInt(p.value).toString(16);
        size = parseUint256HexToFloat(v, sizeDecimals);
        sizeSource = "decoded_param";
        sizeHex = v;
      }
      if (name === "isbuyorder") {
        side = p.value ? "buy" : "sell";
      }
    }

    if (price == null || size == null) {
      const data: string = a?.log?.data || "";
      if (data) {
        const words = splitDataToWords(data);
        if (words.length >= 2) {
          const size1 = parseUint256HexToFloat(words[0], sizeDecimals);
          const price1 = parseUint256HexToFloat(words[1], priceDecimals);
          if (isPlausible(price1, size1)) {
            price = price1;
            size = size1;
            priceHex = words[1];
            sizeHex = words[0];
          } else {
            const price2 = parseUint256HexToFloat(words[0], priceDecimals);
            const size2 = parseUint256HexToFloat(words[1], sizeDecimals);
            if (isPlausible(price2, size2)) {
              price = price2;
              size = size2;
              priceHex = words[0];
              sizeHex = words[1];
            }
          }
          if (price != null && size != null) {
            if (!priceSource) priceSource = "data_words";
            if (!sizeSource) sizeSource = "data_words";
          }
        }
      }
    }

    if (!addr || price == null || size == null) continue;
    const ts = Math.floor((toFiniteNumber(a?.metadata?.blockTimestamp ?? a?.blockTimestamp, Date.now() / 1000)));
    const logIndex = toFiniteNumber(a?.log?.logIndex ?? a?.logIndex, 0);
    const txIndex = toFiniteNumber(a?.log?.transactionIndex ?? a?.transactionIndex, 0);
    const txHash = (a?.hash || a?.transactionHash || a?.log?.transactionHash || "").toString();

    console.log("[AlchemyTrades] price_capture", {
      path: "address_activity",
      contract_address: addr,
      source: priceSource || "unknown",
      price_hex: priceHex,
      size_hex: sizeHex,
      price,
      size,
      side,
      priceDecimals,
      sizeDecimals,
      ts,
      logIndex,
      txIndex,
      txHash: txHash || undefined,
    });

    out.push({ ts, price, size, side, contract_address: addr, log_index: logIndex, tx_index: txIndex, tx_hash: txHash || undefined });
  }
  return out;
}

function buildOrIlikeParam(addrs: string[]): string {
  const clause = `(${addrs.map((a) => `market_address.ilike.${a}`).join(",")})`;
  return encodeURIComponent(clause);
}

async function fetchMarketsByAddressBatch(contractAddresses: string[]): Promise<{ rowsByAddress: Record<string, MarketRow>; fetchInfo: any }> {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || Deno.env.get("NEXT_PUBLIC_SUPABASE_URL") || "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const info: any = { supabaseUrlPresent: Boolean(supabaseUrl), supabaseKeyPresent: Boolean(supabaseKey) };
  if (!supabaseUrl || !supabaseKey) return { rowsByAddress: {}, fetchInfo: info };

  const addrs = Array.from(new Set(contractAddresses.map((a) => a.toLowerCase())));
  if (addrs.length === 0) return { rowsByAddress: {}, fetchInfo: { ...info, reason: "no_addresses" } };

  const baseUrl = `${supabaseUrl}/rest/v1/markets?select=id,market_identifier,symbol,market_address`;
  let url = baseUrl;
  if (addrs.length === 1) {
    url += `&market_address=ilike.${encodeURIComponent(addrs[0])}`;
    info.filterKind = "single_ilike";
  } else {
    url += `&or=${buildOrIlikeParam(addrs)}`;
    info.filterKind = "or_ilike";
  }
  info.url = url;

  try {
    const resp = await fetch(url, {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
      },
    });
    info.status = resp.status;
    let rows: MarketRow[] = [];
    try {
      rows = await resp.json();
    } catch (_) {
      info.jsonParseError = true;
    }
    if (!resp.ok) {
      info.errorBody = rows;
      return { rowsByAddress: {}, fetchInfo: info };
    }
    const byAddr: Record<string, MarketRow> = {};
    for (const r of rows) {
      const addr = (r?.market_address || "").toLowerCase();
      if (addr) byAddr[addr] = r as MarketRow;
    }
    return { rowsByAddress: byAddr, fetchInfo: info };
  } catch (e) {
    info.exception = String(e);
    return { rowsByAddress: {}, fetchInfo: info };
  }
}

// ClickHouse helpers
function getCHConfig() {
  const host = Deno.env.get("CLICKHOUSE_URL") || Deno.env.get("CLICKHOUSE_HOST") || "";
  const user = Deno.env.get("CLICKHOUSE_USER") || "";
  const password = Deno.env.get("CLICKHOUSE_PASSWORD") || "";
  const database = Deno.env.get("CLICKHOUSE_DATABASE") || "default";
  return { host, user, password, database };
}

function escapeSqlString(v: string): string {
  return String(v || "").replace(/\\/g, "\\\\").replace(/'/g, "\\'");
}

async function chInsertJsonEachRow(
  table: string,
  rows: object[],
): Promise<{ ok: boolean; status: number; text?: string; url: string }> {
  const { host, user, password, database } = getCHConfig();
  // Skip unknown fields for forward-compat (e.g. event_id/trade_count missing in older schemas)
  const insertQuery = `INSERT INTO ${table} SETTINGS input_format_skip_unknown_fields=1 FORMAT JSONEachRow`;
  const url = `${host}/?query=${encodeURIComponent(insertQuery)}&database=${encodeURIComponent(database)}`;
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
    "X-ClickHouse-Database": database,
  };
  if (user) headers["X-ClickHouse-User"] = user;
  if (password) headers["X-ClickHouse-Key"] = password;
  const body = rows.map((r) => JSON.stringify(r)).join("\n");
  const resp = await fetch(url, { method: "POST", headers, body });
  const text = await resp.text().catch(() => undefined);
  return { ok: resp.ok, status: resp.status, text, url };
}

async function chQueryJsonEachRow(query: string): Promise<{ ok: boolean; status: number; text?: string; url: string; rows: any[] }> {
  const { host, user, password, database } = getCHConfig();
  const url = `${host}/?database=${encodeURIComponent(database)}`;
  const headers: Record<string, string> = {
    "Content-Type": "text/plain; charset=utf-8",
    Accept: "application/json",
    "X-ClickHouse-Database": database,
  };
  if (user) headers["X-ClickHouse-User"] = user;
  if (password) headers["X-ClickHouse-Key"] = password;
  const resp = await fetch(url, { method: "POST", headers, body: query });
  const text = await resp.text().catch(() => "");
  if (!resp.ok) return { ok: false, status: resp.status, text, url, rows: [] };
  const lines = String(text || "").split("\n").map((l) => l.trim()).filter(Boolean);
  const rows = lines.map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return { ok: true, status: resp.status, text, url, rows };
}

async function fetchLatest1mCandleFromMarketTicks(opts: { marketUuid: string; bucketStartSec: number }) {
  const { marketUuid, bucketStartSec } = opts;
  const safeUuid = escapeSqlString(marketUuid);
  const start = formatDateTimeUTC(bucketStartSec);
  const end = formatDateTimeUTC(bucketStartSec + 60);

  const qWithEventId = `
SELECT
  toUnixTimestamp(toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC')) AS time,
  argMin(price, (ts, event_id)) AS open,
  max(price) AS high,
  min(price) AS low,
  argMax(price, (ts, event_id)) AS close,
  sum(size) AS volume
FROM market_ticks
WHERE market_uuid = '${safeUuid}'
  AND ts >= toDateTime('${start}')
  AND ts < toDateTime('${end}')
GROUP BY time
ORDER BY time DESC
LIMIT 1
FORMAT JSONEachRow
`;

  const qNoEventId = `
SELECT
  toUnixTimestamp(toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC')) AS time,
  argMin(price, ts) AS open,
  max(price) AS high,
  min(price) AS low,
  argMax(price, ts) AS close,
  sum(size) AS volume
FROM market_ticks
WHERE market_uuid = '${safeUuid}'
  AND ts >= toDateTime('${start}')
  AND ts < toDateTime('${end}')
GROUP BY time
ORDER BY time DESC
LIMIT 1
FORMAT JSONEachRow
`;

  let res = await chQueryJsonEachRow(qWithEventId);
  if (!res.ok) {
    // Fallback if schema lacks event_id (or similar)
    res = await chQueryJsonEachRow(qNoEventId);
  }
  const row = res.rows?.[0] || null;
  if (!row) return null;
  return {
    time: Number(row.time),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: Number(row.volume),
  };
}

function toMarketTickRows(trades: NormalizedTrade[]): CHMarketTickRow[] {
  return trades
    .filter((t) => t.market_uuid && t.market_uuid.length > 0)
    .map((t) => {
      const marketUuid = t.market_uuid!;
      const eventId =
        (t.tx_hash && Number.isFinite(Number(t.log_index)) ? `${t.tx_hash}:${Number(t.log_index)}` : "") ||
        (t.trade_id && t.trade_id.trim() ? t.trade_id.trim() : "") ||
        `edge:${marketUuid}:${t.ts}:${t.contract_address}:${t.log_index ?? 0}:${t.tx_index ?? 0}`;

      const sym = (t.symbol || "").trim();
      const symbol = sym ? sym.toUpperCase() : marketUuid;
      const isLong = t.side === "buy" ? 1 : 0;

      return {
        symbol,
        ts: formatDateTimeUTC(t.ts),
        price: t.price,
        size: t.size,
        event_type: "trade",
        is_long: isLong,
        event_id: eventId,
        trade_count: 1,
        market_id: t.market_id ?? 0,
        market_uuid: marketUuid,
        contract_address: t.contract_address,
      };
    });
}

function aggregateTo1m(trades: NormalizedTrade[]): CHCandle1mRow[] {
  const byKey = new Map<string, NormalizedTrade[]>();
  for (const t of trades) {
    if (!t.market_uuid) continue;
    const bucket = Math.floor(t.ts / 60) * 60; // seconds start of minute
    const key = `${t.market_uuid}|${bucket}`;
    const arr = byKey.get(key) || [];
    arr.push(t);
    byKey.set(key, arr);
  }
  const rows: CHCandle1mRow[] = [];
  for (const [key, arr] of byKey) {
    arr.sort((a, b) =>
      (a.ts - b.ts) ||
      ((a.log_index ?? 0) - (b.log_index ?? 0)) ||
      ((a.tx_index ?? 0) - (b.tx_index ?? 0))
    );

    const open = arr[0].price;
    const close = arr[arr.length - 1].price;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    for (const t of arr) {
      if (t.price > high) high = t.price;
      if (t.price < low) low = t.price;
      volume += t.size;
    }
    const [market_uuid, bucket] = key.split("|");
    rows.push({
      market_uuid,
      market_id: arr[0].market_id ?? 0,
      symbol: arr[0].symbol || "",
      ts: formatDateTimeUTC(Number(bucket)),
      open,
      high,
      low,
      close,
      volume,
      trades: arr.length,
    });
  }
  return rows;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
  }

  const rawBody = await req.text();
  let body: any;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch (_e) {
    console.log("[Step 1] Received payload (invalid JSON)", { rawBodySnippet: rawBody.slice(0, 2048) });
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: { "Content-Type": "application/json" } });
  }

  const alchemySig = req.headers.get("X-Alchemy-Signature");
  const inferredType = detectType(body);

  console.log("[Step 1] Received payload", {
    type: inferredType,
    headers: {
      "content-type": req.headers.get("content-type"),
      "x-alchemy-signature": alchemySig,
    },
    payload: body,
  });

  const isValid = await verifyAlchemySignature(rawBody, alchemySig);
  console.log("[Step 2] Signature verification", { valid: isValid });
  if (!isValid) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { "Content-Type": "application/json" } });
  }

  const priceDecimals = parseInt(Deno.env.get("OHLCV_PRICE_DECIMALS") || "6", 10);
  const sizeDecimals = parseInt(Deno.env.get("OHLCV_SIZE_DECIMALS") || "18", 10);

  let trades: NormalizedTrade[] = [];
  if (inferredType === "GRAPHQL") {
    trades = extractFromGraphql(body, priceDecimals, sizeDecimals);
  } else if (inferredType === "ADDRESS_ACTIVITY") {
    trades = extractFromAddressActivity(body, priceDecimals, sizeDecimals);
  } else {
    trades = [
      ...extractFromAddressActivity(body, priceDecimals, sizeDecimals),
      ...extractFromGraphql(body, priceDecimals, sizeDecimals),
    ];
  }

  const uniqueAddresses = Array.from(new Set(trades.map((t) => t.contract_address)));
  console.log("[Step 3] Market resolution", { uniqueAddresses });

  const { rowsByAddress, fetchInfo } = await fetchMarketsByAddressBatch(uniqueAddresses);
  console.log("[Step 3a] Supabase fetch info", fetchInfo);

  for (const t of trades) {
    const row = rowsByAddress[t.contract_address];
    if (row?.id) t.market_uuid = row.id;
    if (row?.symbol && !t.symbol) t.symbol = row.symbol;
  }

  const fetchedItems = Object.values(rowsByAddress);
  console.log("[Step 5] Supabase markets fetched", { count: fetchedItems.length, items: fetchedItems });

  // For broadcast labeling (keep human-readable symbols when available)
  const symbolByMarketUuid: Record<string, string> = {};
  for (const t of trades) {
    if (!t.market_uuid) continue;
    const sym = String(t.symbol || "").trim();
    if (sym) symbolByMarketUuid[t.market_uuid] = sym.toUpperCase();
  }

  // ✅ Canonical raw ingestion path: market_ticks only.
  const chTicks = toMarketTickRows(trades);
  const chCfg = getCHConfig();
  let chInsertInfo: any = { configured: Boolean(chCfg.host) };

  if (chTicks.length > 0 && chCfg.host) {
    console.log("[Step 6.0] ClickHouse ticks payload", { table: "market_ticks", rows: chTicks });
    try {
      const res = await chInsertJsonEachRow("market_ticks", chTicks);
      chInsertInfo = { ...chInsertInfo, url: res.url, ok: res.ok, status: res.status, text: res.text, inserted: chTicks.length };
    } catch (e) {
      chInsertInfo = { ...chInsertInfo, error: String(e) };
    }
  } else if (!chCfg.host) {
    chInsertInfo = { ...chInsertInfo, reason: "CLICKHOUSE_URL/CLICKHOUSE_HOST not set" };
  } else {
    chInsertInfo = { ...chInsertInfo, reason: "no resolved trades to insert" };
  }

  console.log("[Step 6] ClickHouse market_ticks insert", chInsertInfo);

  // We compute 1m candles for optional direct writes, but we do NOT write them to ClickHouse by default.
  // The source of truth for ohlcv_1m should be the MV (mv_ticks_to_1m) derived from market_ticks.
  const candleRows = aggregateTo1m(trades.filter((t) => t.market_uuid));

  const write1m = (Deno.env.get("OHLCV_INGEST_WRITE_1M") || "false").toLowerCase() === "true";
  let chCandlesInfo: any = { enabled: write1m };

  if (write1m) {
    if (candleRows.length > 0 && chCfg.host) {
      console.log("[Step 7.0] ClickHouse candles payload", { table: "ohlcv_1m", rows: candleRows });
      try {
        const res = await chInsertJsonEachRow("ohlcv_1m", candleRows);
        chCandlesInfo = { ...chCandlesInfo, url: res.url, ok: res.ok, status: res.status, text: res.text, inserted: candleRows.length };
      } catch (e) {
        chCandlesInfo = { ...chCandlesInfo, error: String(e) };
      }
    } else if (!chCfg.host) {
      chCandlesInfo = { ...chCandlesInfo, reason: "CLICKHOUSE_URL/CLICKHOUSE_HOST not set" };
    } else {
      chCandlesInfo = { ...chCandlesInfo, reason: "no candleRows from this batch" };
    }
  } else {
    chCandlesInfo = { ...chCandlesInfo, reason: "disabled (mv_ticks_to_1m is source of truth)" };
  }

  console.log("[Step 7] ClickHouse OHLCV direct write", chCandlesInfo);

  // Publish realtime 1m candles keyed by market_uuid to Pusher: channel `chart-<market_uuid>-1m`
  // Script parity: compute candle from ClickHouse `market_ticks` for the minute bucket after insert.
  const publishEnabled = (Deno.env.get("OHLCV_INGEST_PUBLISH_PUSHER") || "true").toLowerCase() !== "false";
  let pusherInfo: any = { enabled: publishEnabled, published: 0 };
  if (publishEnabled && chCfg.host) {
    const keys = new Set<string>();
    for (const t of trades) {
      if (!t.market_uuid) continue;
      const bucketStartSec = Math.floor(t.ts / 60) * 60;
      keys.add(`${t.market_uuid}|${bucketStartSec}`);
    }

    for (const key of keys) {
      const [marketUuid, bucketStr] = key.split("|");
      const bucketStartSec = Number(bucketStr);
      if (!marketUuid || !Number.isFinite(bucketStartSec)) continue;

      const latest = await fetchLatest1mCandleFromMarketTicks({ marketUuid, bucketStartSec });
      if (!latest) continue;

      const channel = `chart-${marketUuid}-1m`;
      const payload = {
        symbol: symbolByMarketUuid[marketUuid] || marketUuid,
        marketUuid,
        timeframe: "1m",
        open: latest.open,
        high: latest.high,
        low: latest.low,
        close: latest.close,
        volume: latest.volume,
        timestamp: (Number.isFinite(latest.time) ? latest.time : bucketStartSec) * 1000,
      };
      try {
        const res = await pusherTrigger(channel, "chart-update", payload);
        if (!res.ok && !res.skipped) {
          pusherInfo.lastError = { status: res.status, text: res.text, url: res.url };
        } else {
          pusherInfo.published++;
        }
      } catch (e) {
        pusherInfo.lastError = { error: String(e) };
      }
    }
  }
  console.log("[Step 8] Pusher publish", pusherInfo);

  const example = trades[0] || null;
  console.log("[Step 4] Parsed trades normalized", { count: trades.length, example });

  return new Response(
    JSON.stringify({
      ok: true,
      parsedCount: trades.length,
      marketsFound: fetchedItems.length,
      ch: { ticks: chInsertInfo, candles: chCandlesInfo },
      pusher: pusherInfo,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});

