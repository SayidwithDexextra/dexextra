-- Migration: Drop settlement_window_expires_at column
--
-- The challenge window expiry is now derived deterministically as:
--   settlement_date - 90 seconds (ONCHAIN_SETTLE_BUFFER_SEC)
-- so the stored column is redundant.

-- 1) Drop the index first
DROP INDEX IF EXISTS idx_markets_settlement_window_expires_at;

-- 2) Drop the column
ALTER TABLE markets
  DROP COLUMN IF EXISTS settlement_window_expires_at;
