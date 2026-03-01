CREATE OR REPLACE VIEW public.active_markets AS
SELECT
  id,
  market_identifier,
  symbol,
  name,
  description,
  category,
  market_status,
  deployment_status,
  settlement_date,
  trading_end_date,
  total_volume,
  total_trades,
  last_trade_price,
  creator_wallet_address,
  market_address,
  market_id_bytes32,
  chain_id,
  network,
  created_at,
  deployed_at
FROM public.markets
WHERE is_active = true
  AND market_status::text <> ALL (ARRAY['ERROR'::text, 'EXPIRED'::text])
ORDER BY created_at DESC;
