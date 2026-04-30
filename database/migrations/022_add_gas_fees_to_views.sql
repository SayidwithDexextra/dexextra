-- Migration: Add gas fee support to fee summary views
-- This updates the user_fee_summary and related views to include gas fees

-- Drop and recreate user_fee_summary to include gas fee columns
DROP VIEW IF EXISTS user_fee_summary;
CREATE OR REPLACE VIEW user_fee_summary AS
SELECT
  user_address,
  market_id,
  market_address,
  -- Trading fee counts (exclude gas fees)
  COUNT(*) FILTER (WHERE fee_role IN ('taker', 'maker')) AS total_trades,
  COUNT(*) FILTER (WHERE fee_role = 'taker') AS taker_trades,
  COUNT(*) FILTER (WHERE fee_role = 'maker') AS maker_trades,
  -- Trading fee amounts (exclude gas fees)
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS total_fees_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role = 'taker'), 0) AS taker_fees_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role = 'maker'), 0) AS maker_fees_usdc,
  -- Gas fee counts and amounts
  COUNT(*) FILTER (WHERE fee_role LIKE 'gas_fee%') AS gas_fee_events,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role LIKE 'gas_fee%'), 0) AS gas_fees_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role = 'gas_fee_maker'), 0) AS gas_fees_maker_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role = 'gas_fee_taker'), 0) AS gas_fees_taker_usdc,
  -- Volume (from trading, not gas fees)
  COALESCE(SUM(trade_notional) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS total_volume_usdc,
  -- Grand total (trading + gas fees)
  COALESCE(SUM(fee_amount_usdc), 0) AS grand_total_fees_usdc,
  -- Timestamps
  MIN(created_at) AS first_trade_at,
  MAX(created_at) AS last_trade_at
FROM trading_fees
GROUP BY user_address, market_id, market_address;

-- Grant access
GRANT SELECT ON user_fee_summary TO authenticated;
GRANT SELECT ON user_fee_summary TO anon;

-- Update market_owner_earnings to include gas fees in totals
DROP VIEW IF EXISTS market_owner_earnings;
CREATE OR REPLACE VIEW market_owner_earnings AS
SELECT
  market_owner_address,
  market_id,
  market_address,
  COUNT(*) AS total_fee_events,
  COALESCE(SUM(owner_share), 0) AS total_owner_earnings_usdc,
  COALESCE(SUM(protocol_share), 0) AS total_protocol_earnings_usdc,
  COALESCE(SUM(fee_amount_usdc), 0) AS total_fees_collected_usdc,
  -- Break down by type
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS trading_fees_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role LIKE 'gas_fee%'), 0) AS gas_fees_usdc,
  COALESCE(SUM(trade_notional) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS total_volume_usdc,
  MIN(created_at) AS first_fee_at,
  MAX(created_at) AS last_fee_at
FROM trading_fees
WHERE market_owner_address IS NOT NULL
GROUP BY market_owner_address, market_id, market_address;

GRANT SELECT ON market_owner_earnings TO authenticated;
GRANT SELECT ON market_owner_earnings TO anon;

-- Update protocol_fee_earnings to include gas fees in totals
DROP VIEW IF EXISTS protocol_fee_earnings;
CREATE OR REPLACE VIEW protocol_fee_earnings AS
SELECT
  protocol_fee_recipient,
  market_id,
  market_address,
  COUNT(*) AS total_fee_events,
  COALESCE(SUM(protocol_share), 0) AS total_protocol_earnings_usdc,
  COALESCE(SUM(owner_share), 0) AS total_owner_earnings_usdc,
  COALESCE(SUM(fee_amount_usdc), 0) AS total_fees_collected_usdc,
  -- Break down by type
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS trading_fees_usdc,
  COALESCE(SUM(fee_amount_usdc) FILTER (WHERE fee_role LIKE 'gas_fee%'), 0) AS gas_fees_usdc,
  COALESCE(SUM(trade_notional) FILTER (WHERE fee_role IN ('taker', 'maker')), 0) AS total_volume_usdc,
  MIN(created_at) AS first_fee_at,
  MAX(created_at) AS last_fee_at
FROM trading_fees
WHERE protocol_fee_recipient IS NOT NULL
GROUP BY protocol_fee_recipient, market_id, market_address;

GRANT SELECT ON protocol_fee_earnings TO authenticated;
GRANT SELECT ON protocol_fee_earnings TO anon;

-- Add comment for documentation
COMMENT ON VIEW user_fee_summary IS 'Aggregated fee summary per user per market. Separates trading fees (taker/maker) from gas fees (gas_fee_maker/gas_fee_taker).';
COMMENT ON VIEW market_owner_earnings IS 'Aggregated earnings for market owners. Includes breakdown of trading fees vs gas fees.';
COMMENT ON VIEW protocol_fee_earnings IS 'Aggregated earnings for protocol fee recipients. Includes breakdown of trading fees vs gas fees.';
