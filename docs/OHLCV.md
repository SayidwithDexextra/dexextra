# OHLCV Edge Function Design (Market‑ID centric)

Purpose: ingest on‑chain trade execution events from Alchemy webhooks, resolve markets by on‑chain orderBook (contract) address, persist trades with market identifiers into ClickHouse, and serve OHLCV derived strictly from market ids (not symbols).

Environment note: The ClickHouse `trades` table already exists in our environment. Treat the `trades` DDL below as reference only. If `ohlcv_1m` and `mv_trades_to_1m` also exist, no action is required.

## 1) Ingestion sources
- Alchemy webhooks
  - ADDRESS_ACTIVITY (decoded.params available in many cases)
  - GRAPHQL (block.logs with `account.address`, `topics[]`, `data`)
- Event targets (examples from our codebase and legacy order book)
  - TradeExecuted(bytes32 indexed orderId, address indexed maker, address indexed taker, bool isBuyOrder, uint256 price, uint256 quantity, uint256 timestamp)
  - OrderFilled(..., uint256 price, uint256 quantity, ...)

Notes:
- We cannot rely on `symbol` in payloads. We must resolve the market by emitter (orderBook) contract address.
- For GRAPHQL without decoded params, we can parse `log.data` as 32‑byte words.
  - Heuristic (configurable): word[0] → price, word[1] → size
  - Scale with env: `OHLCV_PRICE_DECIMALS`, `OHLCV_SIZE_DECIMALS`

## 2) Market resolution (by orderBook/contract address)
- Take `orderBookAddress = log.account.address` (or `log.address`) lower‑cased
- Supabase query against `markets`:
  - `SELECT id AS market_uuid, market_identifier, symbol, market_address FROM markets WHERE market_address = :addr LIMIT 1`
  - Require exact match. If none, drop the event (unknown market) or store with `market_uuid = null` (config‑driven).
- The `markets.id` (UUID) is our canonical market identifier. We also preserve `market_identifier` for human debugging.

## 3) Trade normalization
Extract from event/log:
- contract_address: emitter address (lower‑case)
- market_uuid: from Supabase lookup (section 2)
- market_id (optional numeric): if we maintain a numeric id column in CH (UInt32); otherwise stick to UUID
- price: uint256 → number (scaled by `OHLCV_PRICE_DECIMALS`)
- size: uint256 → number (scaled by `OHLCV_SIZE_DECIMALS`)
- side: “buy”/“sell” when boolean or maker/taker semantics available; else default “buy”
- maker: 0/1 when available (optional)
- trade_id / order_id: when emitted
- ts: prefer on‑chain event timestamp if included; else block timestamp; else `Date.now()/1000` fallback

Normalized row for ClickHouse `trades`:
```
{
  symbol?: string,                     // not authoritative; present only for back‑compat
  ts: DateTime('UTC'),                 // seconds resolution
  price: Float64,
  size: Float64,
  side: LowCardinality(String),        // 'buy' | 'sell'
  maker: UInt8,                        // 1 maker, 0 taker
  trade_id: String,                    // optional
  order_id: String,                    // optional
  market_id: UInt32,                   // optional (see schema variant)
  market_uuid: LowCardinality(String), // authoritative market identifier
  contract_address: LowCardinality(String)
}
```

## 4) ClickHouse schema (market‑id first)
Recommended tables (variants supported via feature detection):

Reference: The `trades` table DDL below is informational — do not create it; the table already exists in our environment. If `ohlcv_1m` and the materialized view also exist, they can be treated as reference as well.

### trades (source of truth)
```
CREATE TABLE trades (
  symbol LowCardinality(String),             -- kept for back‑compat; can be empty
  ts DateTime('UTC'),
  price Float64,
  size Float64,
  side LowCardinality(String),
  maker UInt8 DEFAULT 0,
  trade_id String DEFAULT '',
  order_id String DEFAULT '',
  market_id UInt32 DEFAULT 0,               -- optional numeric id
  market_uuid LowCardinality(String) DEFAULT '',  -- primary id
  contract_address LowCardinality(String) DEFAULT ''
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (market_uuid, ts)
SETTINGS index_granularity = 8192;
```

### ohlcv_1m (minute candles)
Add market identifiers so we can query by market directly:
```
CREATE TABLE ohlcv_1m (
  market_uuid LowCardinality(String),
  market_id UInt32 DEFAULT 0,               -- optional
  symbol LowCardinality(String),            -- optional
  ts DateTime('UTC'),
  open Float64,
  high Float64,
  low Float64,
  close Float64,
  volume Float64,
  trades UInt32
)
ENGINE = MergeTree()
PARTITION BY toYYYYMM(ts)
ORDER BY (market_uuid, ts)
TTL ts + INTERVAL 90 DAY DELETE
SETTINGS index_granularity = 8192;
```

### MV trades → ohlcv_1m (market‑id aware)
```
CREATE MATERIALIZED VIEW mv_trades_to_1m
TO ohlcv_1m AS
SELECT
  anyLast(market_uuid) AS market_uuid,
  anyLast(market_id)   AS market_id,
  anyLast(symbol)      AS symbol,
  toStartOfInterval(ts, INTERVAL 1 MINUTE, 'UTC') AS ts,
  argMin(price, ts) AS open,
  max(price)        AS high,
  min(price)        AS low,
  argMax(price, ts) AS close,
  sum(size)         AS volume,
  count()           AS trades
FROM trades
GROUP BY market_uuid, ts;
```
Notes:
- If `market_uuid` column is absent, fall back to symbol‑based variant (legacy).
- If both `market_uuid` and `market_id` are present, prefer `market_uuid` in ORDER BY and GROUP BY.

## 5) Edge Function behavior
1) Auth
   - Optional bearer: `INGEST_API_KEY`
   - Signature verification: `ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV` (or list variant), compare HMAC(raw body) with `X‑Alchemy‑Signature`
2) Parse payload
   - ADDRESS_ACTIVITY → use decoded.params (`symbol`, `price`, `size` when present)
   - GRAPHQL logs → if decoded absent, split `data` into 32‑byte words; map word[0]→price, word[1]→size (configurable)
   - `OHLCV_PRICE_DECIMALS`, `OHLCV_SIZE_DECIMALS` for scaling
3) Resolve market
   - `market = SELECT id FROM markets WHERE market_address = :address LIMIT 1`
   - If not found → drop or queue for later (configurable)
4) Persist
   - Insert normalized trades into `trades` with `market_uuid` (and numeric `market_id` if tracked)
   - Optionally accept `candles[]` to write directly to `ohlcv_1m` (bypass MV)
5) Idempotency
   - Deduplicate by (`transactionHash`, `logIndex`) within a short time window (optional)
6) Logging (minimal)
   - Log raw payload once (chunked) under a distinct prefix
   - Log fatal errors

## 6) Environment variables
- Security
  - `INGEST_API_KEY`
  - `ALCHEMY_WEBHOOK_SIGNING_KEY_OHLCV` (or `ALCHEMY_WEBHOOK_SIGNING_KEYS_OHLCV`)
- Scaling
  - `OHLCV_PRICE_DECIMALS` (default 6)
  - `OHLCV_SIZE_DECIMALS`  (default 18)
- ClickHouse
  - `CLICKHOUSE_URL` or `CLICKHOUSE_HOST`
  - `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD`, `CLICKHOUSE_DATABASE`
- Supabase (for market resolution)
  - `SUPABASE_URL` (or `NEXT_PUBLIC_SUPABASE_URL`)
  - `SUPABASE_SERVICE_ROLE_KEY` (preferred) or `SUPABASE_ANON_KEY`

## 7) Querying by market id (no symbols)
Examples:
```
-- Latest 500 minute candles by market_uuid
SELECT
  toUnixTimestamp(ts) AS time,
  open, high, low, close, volume, trades
FROM ohlcv_1m
WHERE market_uuid = '{uuid}'
ORDER BY ts DESC
LIMIT 500;
```
For higher timeframes, aggregate dynamically from `ohlcv_1m`, grouping by `toStartOfInterval(ts, INTERVAL N MINUTE, 'UTC')` and selecting:
```
open = argMin(open, ts)
high = max(high)
low  = min(low)
close = argMax(close, ts)
volume = sum(volume)
trades = sum(trades)
```

## 8) Migration plan (if legacy symbol‑only)
1) If your existing `trades` table lacks `market_uuid` (and optionally `market_id`), add them; otherwise skip. Add these columns to `ohlcv_1m` only if they are missing.
2) Update MV to group by `market_uuid`
3) Update ingestion to resolve by `market_address` and populate `market_uuid`
4) Update APIs to accept `market_uuid` (and optionally symbol as fallback)

## 9) Test checklist
- Webhook acceptance: 200 for valid signature; 401 for invalid
- Market resolution: known `market_address` returns a row with `id`
- Insert path: trades written with `market_uuid`
- Existing `trades` rows are written with `market_uuid` populated after normalization
- MV path: `ohlcv_1m` contains candles keyed by `market_uuid`
- GET charts: `/api/charts/ohlcv?market_uuid=...&timeframe=1m` returns data (or adjust endpoint to accept market_uuid)

This design guarantees OHLCV is keyed and queried by market id, with symbol kept only for backward compatibility and human readability. The Supabase markets table remains the source of truth mapping orderBook addresses to canonical market identifiers.


