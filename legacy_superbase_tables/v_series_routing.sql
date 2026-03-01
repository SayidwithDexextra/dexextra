CREATE OR REPLACE VIEW public.v_series_routing AS
SELECT
  s.id AS series_id,
  s.slug,
  sm.market_id AS primary_market_id
FROM public.market_series s
LEFT JOIN public.series_markets sm
  ON sm.series_id = s.id
 AND sm.is_primary = true;
