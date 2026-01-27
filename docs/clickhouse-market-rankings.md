# ClickHouse market rankings (Top Volume + Trending)

This project already persists a canonical trade/tick stream into ClickHouse and derives 1m candles via a materialized view. This doc defines **how to derive** market ranking metrics (Top Volume + Trending) from those existing tables, and how to scale the same derivations later.

## Data sources (authoritative)

### `market_ticks` (authoritative for rankings)
Created by [`scripts/setup-orderbook-clickhouse.js`](../scripts/setup-orderbook-clickhouse.js).

Use this for any ranking/leaderboard math because it is the **canonical raw stream** and can be re-aggregated deterministically.

- **`market_uuid`**: stable market identifier (links to Supabase `markets.id` / `orderbook_markets_view.id`). This is the primary grouping key.
- **`ts`**: event time (UTC).
- **`price`**: trade price (float).
- **`size`**: trade size (float). Used for base volume.
- **`trade_count`**: number of trades represented by a row. For “real” trade ticks this is `1`. (Synthetic candle-derived ticks should use `0` so they don’t inflate trade counts.)
- **`event_id`**: deterministic tie-breaker (e.g., `txHash:logIndex`) used to compute **open/close** reliably when multiple events share timestamps.
- **`symbol`**: human label (not stable enough to be a primary key; treat as display/meta).

### `ohlcv_1m` (good for chart reads; not required for rankings)
Derived from `market_ticks` via MV `mv_ticks_to_1m`. It is great for chart queries, but because it’s a MergeTree fed by an MV, it can contain multiple partial rows per minute when ticks arrive in separate inserts. For rankings, prefer aggregating directly from `market_ticks`.

## Derived metrics (definitions)

### Windows
Defaults used by the rankings API:
- **1h**: last 1 hour
- **prev1h**: the hour immediately before the last hour
- **24h**: last 24 hours

### Top Volume
Returned together so the UI can rank by either:
- **base_volume_24h**: \(\sum size\)
- **notional_volume_24h**: \(\sum (price \times size)\)
- **trades_24h**: \(\sum trade\_count\) (or `count()` if `trade_count` isn’t available)

### Trending (hybrid score)
Compute a per-market feature vector, then a weighted score.

Features:
- **notional_1h**, **notional_prev1h**, **notional_24h**
- **base_1h**, **base_24h**
- **trades_1h**, **trades_24h**
- **price_change_1h_pct**, **price_change_24h_pct** (derived from `market_ticks` open/close)
- **accel_1h**: \(notional\_1h / \max(notional\_{prev1h}, \epsilon)\)

Score (first-pass weights; tune as needed):

```
score =
  0.35*log1p(notional_1h)
 +0.15*log1p(notional_24h)
 +0.20*log1p(trades_1h)
 +0.15*abs(price_change_1h_pct)
 +0.10*abs(price_change_24h_pct)
 +0.05*log1p(accel_1h)
```

Noise guards (recommended):
- Require `market_uuid != ''`
- Optionally require `notional_24h >= <minNotional24h>` and/or `trades_24h >= <minTrades24h>`

## Example queries (query-time derivation; no new tables)

### Top volume (exact) from `market_ticks`

```sql
SELECT
  market_uuid,
  anyLast(symbol) AS symbol,
  sum(size) AS base_volume_24h,
  sum(price * size) AS notional_volume_24h,
  sum(trade_count) AS trades_24h
FROM market_ticks
WHERE market_uuid != ''
  AND ts >= now('UTC') - INTERVAL 24 HOUR
GROUP BY market_uuid
ORDER BY notional_volume_24h DESC
LIMIT 50;
```

### Top volume (approx notional) from `ohlcv_1m`

If you need a lighter-weight query and you’re OK with approximation, compute notional by multiplying 1m “typical price” by the 1m base volume:

- `typical_price_1m ≈ (open + high + low + close) / 4`
- `notional_24h ≈ sum(typical_price_1m * volume)`

```sql
SELECT
  market_uuid,
  anyLast(symbol) AS symbol,
  sum(volume) AS base_volume_24h,
  sum(((open + high + low + close) / 4) * volume) AS notional_volume_24h_approx,
  sum(trades) AS trades_24h
FROM ohlcv_1m
WHERE market_uuid != ''
  AND ts >= now('UTC') - INTERVAL 24 HOUR
GROUP BY market_uuid
ORDER BY notional_volume_24h_approx DESC
LIMIT 50;
```

### Trending (hybrid) from `market_ticks` only

This version uses `event_id` for deterministic open/close. If your deployment doesn’t have `event_id`, replace `(ts, event_id)` with just `ts` and use `sum(trade_count)` → `count()`.

```sql
WITH
  now('UTC') AS t_now,
  (t_now - INTERVAL 1 HOUR) AS t_1h,
  (t_now - INTERVAL 2 HOUR) AS t_2h,
  (t_now - INTERVAL 24 HOUR) AS t_24h
SELECT
  market_uuid,
  anyLast(symbol) AS symbol,

  sumIf(size, ts >= t_24h) AS base_24h,
  sumIf(price * size, ts >= t_24h) AS notional_24h,
  sumIf(trade_count, ts >= t_24h) AS trades_24h,

  sumIf(size, ts >= t_1h) AS base_1h,
  sumIf(price * size, ts >= t_1h) AS notional_1h,
  sumIf(trade_count, ts >= t_1h) AS trades_1h,
  sumIf(price * size, ts >= t_2h AND ts < t_1h) AS notional_prev1h,

  argMinIf(price, (ts, event_id), ts >= t_1h) AS open_1h,
  argMaxIf(price, (ts, event_id), ts >= t_1h) AS close_1h,
  if(open_1h > 0, (close_1h - open_1h) / open_1h * 100, 0) AS price_change_1h_pct,

  argMinIf(price, (ts, event_id), ts >= t_24h) AS open_24h,
  argMaxIf(price, (ts, event_id), ts >= t_24h) AS close_24h,
  if(open_24h > 0, (close_24h - open_24h) / open_24h * 100, 0) AS price_change_24h_pct,

  notional_1h / greatest(notional_prev1h, 1e-9) AS accel_1h,

  (
    0.35*log1p(notional_1h)
   +0.15*log1p(notional_24h)
   +0.20*log1p(trades_1h)
   +0.15*abs(price_change_1h_pct)
   +0.10*abs(price_change_24h_pct)
   +0.05*log1p(accel_1h)
  ) AS trending_score
FROM market_ticks
WHERE market_uuid != ''
  AND ts >= t_24h
GROUP BY market_uuid
HAVING trades_24h > 0
ORDER BY trending_score DESC
LIMIT 50;
```

## Optional scale-out: bucketed rollups (preserve semantics, improve performance)

If scanning `market_ticks` over 24h becomes expensive, pre-aggregate into a bucketed rollup table (per-minute or per-5-minute) using `AggregatingMergeTree` and aggregate *states*.

Recommended per-bucket states:
- `base_volume_state = sumState(size)`
- `notional_state = sumState(price*size)`
- `trades_state = sumState(trade_count)`
- `open_state = argMinState(price, (ts, event_id))`
- `close_state = argMaxState(price, (ts, event_id))`
- `high_state = maxState(price)`
- `low_state = minState(price)`

Then rankings queries become `sumMerge(...)` across buckets instead of scanning raw ticks, while producing the same definitions above.

