CREATE OR REPLACE VIEW public.user_recent_orders AS
SELECT
  id,
  trader_wallet_address,
  market_metric_id,
  order_id,
  latest_event_type,
  side,
  order_type,
  price,
  quantity,
  filled_quantity,
  remaining_quantity,
  order_status,
  first_seen_at,
  last_update_at,
  last_tx_hash,
  last_block_number,
  last_log_index
FROM public.user_orders_snapshot
ORDER BY last_update_at DESC
LIMIT 1000;
