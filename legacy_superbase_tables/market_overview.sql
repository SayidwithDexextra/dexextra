CREATE OR REPLACE VIEW public.market_overview AS
SELECT
  m.id AS market_id,
  m.market_identifier,
  m.symbol,
  m.name,
  m.category,
  m.icon_image_url,
  m.banner_image_url,
  m.market_address,
  m.chain_id,
  m.network,
  m.tick_size,
  m.decimals,
  m.is_active,
  m.market_status,
  m.total_volume,
  m.total_trades,
  t.mark_price,
  t.last_update,
  t.is_stale
FROM public.markets m
LEFT JOIN public.market_tickers t ON t.market_id = m.id
WHERE m.is_active = true;
