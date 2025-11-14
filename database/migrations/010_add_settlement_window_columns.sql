-- =============================================
-- Migration: 010_add_settlement_window_columns.sql
-- Purpose: Add fields to support 24-hour settlement challenge window
-- Notes: Reuses existing `markets` table; no new tables introduced
-- =============================================

-- 1) Add settlement window proposal/challenge columns
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS proposed_settlement_value NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS proposed_settlement_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS settlement_window_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS proposed_settlement_by VARCHAR(42),
  ADD COLUMN IF NOT EXISTS alternative_settlement_value NUMERIC(20,8),
  ADD COLUMN IF NOT EXISTS alternative_settlement_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alternative_settlement_by VARCHAR(42),
  ADD COLUMN IF NOT EXISTS settlement_disputed BOOLEAN DEFAULT false;

-- 2) Helpful indexes
CREATE INDEX IF NOT EXISTS idx_markets_settlement_window_expires_at
  ON markets (settlement_window_expires_at);

CREATE INDEX IF NOT EXISTS idx_markets_settlement_status
  ON markets (market_status);

-- 3) Comments for documentation
COMMENT ON COLUMN markets.proposed_settlement_value IS 'First proposed settlement price (human-readable, 6d precision typical)';
COMMENT ON COLUMN markets.proposed_settlement_at IS 'Timestamp of first proposal';
COMMENT ON COLUMN markets.settlement_window_expires_at IS 'Timestamp when 24h challenge window ends';
COMMENT ON COLUMN markets.proposed_settlement_by IS 'Wallet address that proposed first settlement price';
COMMENT ON COLUMN markets.alternative_settlement_value IS 'Opposing settlement price proposed during challenge window';
COMMENT ON COLUMN markets.alternative_settlement_at IS 'Timestamp when opposing price was proposed';
COMMENT ON COLUMN markets.alternative_settlement_by IS 'Wallet address that proposed the alternative settlement price';
COMMENT ON COLUMN markets.settlement_disputed IS 'True when an opposing settlement price exists';






