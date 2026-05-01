-- =============================================
-- Migration: 023_increase_user_trades_precision.sql
-- Increase decimal precision for user_trades table
-- to support full blockchain precision (18 decimals)
-- =============================================

-- Alter amount column to support 18 decimals (full EVM token precision)
-- NUMERIC(38,18) can store up to 20 integer digits + 18 decimal places
ALTER TABLE user_trades
  ALTER COLUMN amount TYPE NUMERIC(38,18);

-- Alter price column to support 8 decimals (sufficient for most price feeds)
-- NUMERIC(28,8) can store prices up to 100 quadrillion with 8 decimal places
ALTER TABLE user_trades
  ALTER COLUMN price TYPE NUMERIC(28,8);

-- Alter liquidation_price column to support 8 decimals
ALTER TABLE user_trades
  ALTER COLUMN liquidation_price TYPE NUMERIC(28,8);

-- Add comment documenting the precision requirements
COMMENT ON COLUMN user_trades.amount IS 'Position size delta with full blockchain precision (18 decimals). Positive = bought, Negative = sold.';
COMMENT ON COLUMN user_trades.price IS 'Trade execution price with 8 decimal precision (6 decimals on-chain + 2 buffer).';
COMMENT ON COLUMN user_trades.liquidation_price IS 'Current liquidation price for the position with 8 decimal precision.';

-- Create index on amount for position queries (if not exists)
CREATE INDEX IF NOT EXISTS idx_user_trades_amount ON user_trades(amount) WHERE amount != 0;

-- Create index for finding non-zero positions by wallet
CREATE INDEX IF NOT EXISTS idx_user_trades_wallet_market_amount 
  ON user_trades(user_wallet_address, market_id, amount) 
  WHERE amount != 0;
