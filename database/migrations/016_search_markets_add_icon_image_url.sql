-- Add icon_image_url to the search_markets RPC return so callers
-- (e.g. Similar Markets) receive the icon without a second query.

DROP FUNCTION IF EXISTS search_markets(text, character varying, character varying, integer);

CREATE OR REPLACE FUNCTION search_markets(
  search_term TEXT,
  p_category VARCHAR(50) DEFAULT NULL,
  p_status VARCHAR(20) DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  market_identifier VARCHAR(100),
  symbol VARCHAR(30),
  name VARCHAR(100),
  description TEXT,
  category text[],
  market_status VARCHAR(20),
  total_volume NUMERIC,
  total_trades INTEGER,
  last_trade_price NUMERIC,
  settlement_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  icon_image_url TEXT
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.market_identifier,
    m.symbol,
    m.name,
    m.description,
    m.category,
    m.market_status,
    m.total_volume,
    m.total_trades,
    m.last_trade_price,
    m.settlement_date,
    m.created_at,
    m.icon_image_url
  FROM markets m
  WHERE 
    m.is_active = true AND
    (p_category IS NULL OR p_category = ANY(m.category)) AND
    (p_status IS NULL OR m.market_status = p_status) AND
    (
      search_term IS NULL OR
      search_term = '' OR
      m.market_identifier ILIKE '%' || search_term || '%' OR
      m.symbol ILIKE '%' || search_term || '%' OR
      m.name ILIKE '%' || search_term || '%' OR
      m.description ILIKE '%' || search_term || '%' OR
      to_tsvector('english', m.market_identifier || ' ' || m.symbol || ' ' || m.name || ' ' || m.description) @@ plainto_tsquery('english', search_term)
    )
  ORDER BY 
    CASE 
      WHEN m.market_identifier ILIKE search_term THEN 1
      WHEN m.market_identifier ILIKE search_term || '%' THEN 2
      WHEN m.symbol = search_term THEN 3
      WHEN m.name ILIKE '%' || search_term || '%' THEN 4
      WHEN m.description ILIKE '%' || search_term || '%' THEN 5
      ELSE 6
    END,
    m.total_volume DESC,
    m.created_at DESC
  LIMIT p_limit;
END;
$$ language 'plpgsql' SECURITY DEFINER;

GRANT EXECUTE ON FUNCTION search_markets TO authenticated, anon;
