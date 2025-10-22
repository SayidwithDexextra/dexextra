## Order Event Ingestion & Debugging Summary

### Goal
Persist every user order event (placed, filled, cancelled, etc.) across thousands of OrderBook markets into the database, power real-time UI via Pusher, and expose simple debug tools to verify ingestion.

### End-to-End Flow
- On-chain emits events per market (OrderBook contracts)
  - Event topics monitored (1e6 precision for price/size):
    - ORDER_PLACED_ACTUAL: `0x348379522536ddee6c265b4008f5063ca68d4ee1e27925ba2a01236bab3c59e6`
    - ORDER_PLACED: `0xb18a04414e157e27a7bd658d83da50aeed90007f362102747b7d7f34b8b75ce1`
    - ORDER_FILLED: `0xec7abeea99156aa60ed39992d78c95b0082f64d3469447a70c7fd11981912b9f`
    - ORDER_CANCELLED: `0xdc408a4b23cfe0edfa69e1ccca52c3f9e60bc441b3b25c09ec6defb38896a4f3`
    - ORDER_CANCELLED_ACTUAL: `0xb2705df32ac67fc3101f496cd7036bf59074a603544d97d73650b6f09744986a`
    - ORDER_ADDED: `0x184a980efa61c0acfeff92c0613bf2d3aceedadec9002d919c6bde9218b56c68`
    - ORDER_MATCHED: `0xe5426fa5d075d3a0a2ce3373a3df298c78eec0ded097810b0e69a92c21b4b0b3`

- Alchemy → Webhook to backend
  - POST `/api/webhooks/orderbook`
  - Body: Alchemy GraphQL or Address Activity format containing block logs (processor supports both under `event.data.block.logs` or `block.logs`).
  - Signature verification (prod): set `ALCHEMY_WEBHOOK_SIGNING_KEY`.

- Processor (dynamic + scalable)
  - `src/services/orderBookWebhookProcessor.ts`
  - Loads active markets from `orderbook_markets_resolved` and builds a dynamic allowlist mapping `market_address` → `metric_id`.
  - Filters logs by known OrderBook addresses, decodes by topic, converts values with 1e6 precision, normalizes sides/types, and writes to:
    - `user_order_events` (append-only event stream)
    - Broadcasts to Pusher channels: `market-${metricId}` (events: `order-update`, `order-cancelled`)
  - Your DB trigger/function (recommended, see below) maintains `user_orders_snapshot` (latest state per (market, user, order)).

- Frontend
  - Subscribes to `market-${metricId}` via Pusher to refresh quickly.
  - Fetches order history via `/api/orders/query?metricId=${metricId}&trader=${wallet}` reading `user_orders_snapshot`.
  - Uses `metric_id` (not symbol) end-to-end; API resolves symbols/addresses/bytes32 to `metric_id` dynamically.

### Key Files
- Webhook receiver: `src/app/api/webhooks/orderbook/route.ts`
- Processor: `src/services/orderBookWebhookProcessor.ts`
- Orders query API (dynamic resolution): `src/app/api/orders/query/route.ts`
- Debug endpoint: `src/app/api/debug/orders/route.ts`
- Ad-hoc indexer (optional, no webhook): `src/app/api/indexer/scan/route.ts`

### Database Tables (core)
- `user_order_events` (append-only event log)
- `user_orders_snapshot` (latest state per `(trader_wallet_address, market_metric_id, order_id)`)

Recommended constraints/indexes:
```sql
-- Idempotency guard for event stream
CREATE UNIQUE INDEX IF NOT EXISTS ux_user_order_events_unique
ON user_order_events (order_id, tx_hash, log_index);

-- Snapshot key
ALTER TABLE user_orders_snapshot
  ADD CONSTRAINT IF NOT EXISTS ux_snapshot_key
  UNIQUE (trader_wallet_address, market_metric_id, order_id);

-- Read performance
CREATE INDEX IF NOT EXISTS idx_snapshot_user_market_time
ON user_orders_snapshot (market_metric_id, trader_wallet_address, last_update_at DESC);

CREATE INDEX IF NOT EXISTS idx_events_user_market_time
ON user_order_events (market_metric_id, trader_wallet_address, created_at DESC);
```

Snapshot maintenance (trigger) – example:
```sql
CREATE OR REPLACE FUNCTION maintain_user_orders_snapshot() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO user_orders_snapshot AS s (
    trader_wallet_address, market_metric_id, order_id,
    latest_event_type, side, order_type, price, quantity,
    filled_quantity, order_status, first_seen_at, last_update_at,
    last_tx_hash, last_block_number, last_log_index
  ) VALUES (
    NEW.trader_wallet_address, NEW.market_metric_id, NEW.order_id,
    NEW.event_type, NEW.side, NEW.order_type, NEW.price, NEW.quantity,
    COALESCE(NEW.filled_quantity, 0), COALESCE(NEW.status, 'OPEN'), NOW(), NOW(),
    NEW.tx_hash, NEW.block_number, NEW.log_index
  )
  ON CONFLICT (trader_wallet_address, market_metric_id, order_id)
  DO UPDATE SET
    latest_event_type = EXCLUDED.latest_event_type,
    side              = COALESCE(EXCLUDED.side, s.side),
    order_type        = COALESCE(EXCLUDED.order_type, s.order_type),
    price             = COALESCE(EXCLUDED.price, s.price),
    quantity          = COALESCE(EXCLUDED.quantity, s.quantity),
    filled_quantity   = GREATEST(COALESCE(s.filled_quantity,0), COALESCE(EXCLUDED.filled_quantity,0)),
    order_status      = CASE EXCLUDED.latest_event_type
                          WHEN 'FILLED' THEN 'FILLED'
                          WHEN 'CANCELLED' THEN 'CANCELLED'
                          WHEN 'PARTIAL_FILL' THEN 'PARTIAL'
                          ELSE COALESCE(EXCLUDED.order_status, s.order_status, 'OPEN')
                        END,
    last_update_at    = NOW(),
    last_tx_hash      = EXCLUDED.last_tx_hash,
    last_block_number = EXCLUDED.last_block_number,
    last_log_index    = EXCLUDED.last_log_index;
  RETURN NULL;
END; $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_user_order_events_snapshot ON user_order_events;
CREATE TRIGGER trg_user_order_events_snapshot
AFTER INSERT ON user_order_events
FOR EACH ROW EXECUTE FUNCTION maintain_user_orders_snapshot();
```

### Environment Variables
- Supabase
  - `NEXT_PUBLIC_SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY` (server inserts)
  - (Fallbacks: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`)
- Pusher (client)
  - `NEXT_PUBLIC_PUSHER_KEY`
  - `NEXT_PUBLIC_PUSHER_CLUSTER`
- Alchemy
  - `ALCHEMY_WEBHOOK_SIGNING_KEY` (prod verification)
- Chain RPC (for ad-hoc scans)
  - `CHAIN_CONFIG.rpcUrl` (from `contractConfig`)

### Alchemy Webhook Setup
- Create a webhook (Address Activity / Logs) on your target network.
- Target URL: `/api/webhooks/orderbook`
- Addresses: include all OrderBook `market_address` values in `orderbook_markets_resolved` (ACTIVE && is_active).
- (Optional) Filter by the event topic hashes listed above.
- Set `ALCHEMY_WEBHOOK_SIGNING_KEY` if verifying signatures.

### Debugging & Verification
- Quick DB inspection
  - `GET /api/debug/orders?metricId=<metric_id|address|bytes32>&trader=0xYourWallet&limit=25`
  - Returns: resolved `metric_id`, last `user_order_events`, and `user_orders_snapshot` rows.

- Ad-hoc block scan (no webhook scenario)
  - `GET /api/indexer/scan?range=20` (last 20 blocks)
  - `GET /api/indexer/scan?from=latest-100&to=<blockNumber>`
  - Feeds logs to the same processor and broadcasts Pusher updates.

- Frontend console markers
  - Order placement: `[DBG][placeLimitOrder] start/sent/confirmed/refresh`
  - History fetch: `[DBG][history][request]/[response]/[error-status]/[exception]`

- Server logs (webhook path)
  - Processing count, sample logs `[DBG][webhook][logs][0..3]`
  - Parsed events `[DBG][webhook][parsed]`
  - Save status `[DBG][webhook][saved]` or `[DBG][webhook][save-error]`

### Frontend Integration Notes
- Use `metric_id` consistently when subscribing to Pusher and when calling `/api/orders/query`.
- Pusher channels: `market-${metricId}`
- UI fetch: `/api/orders/query?metricId=${metricId}&trader=${wallet}&limit=50`

### Scaling Considerations
- Dynamic allowlist of OrderBooks (no static symbol map).
- Idempotent inserts (unique index on `(order_id, tx_hash, log_index)`).
- Add partitioning on `user_order_events` if volume grows large.
- Optional factory support: extend processor to handle market creation event(s) and auto-insert new markets into `orderbook_markets`.

### Common Gotchas
- No `orderbook_markets_resolved` row → event filtered out (unknown address).
- Using display symbol instead of `metric_id` in UI → history empty / wrong channel.
- Missing `ALCHEMY_WEBHOOK_SIGNING_KEY` in prod → signature verification fails (if enabled).

### Smoke Test Checklist
- Place a LIMIT order in the UI (watch `[DBG][placeLimitOrder]`).
- Confirm server logs show webhook `[DBG]` entries and `processed > 0`.
- Verify DB with: `/api/debug/orders?metricId=<metric_id>&trader=0xYourWallet&limit=25`.
- Confirm UI history shows items after a short delay; Pusher channel: `market-<metric_id>`.


