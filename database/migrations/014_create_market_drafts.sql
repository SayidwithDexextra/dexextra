-- =============================================
-- Migration: 014_create_market_drafts.sql
-- Create market_drafts table for persisting
-- in-progress market creation state
-- =============================================

CREATE TABLE IF NOT EXISTS market_drafts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_wallet  VARCHAR(42) NOT NULL,

  title           VARCHAR(200),

  current_step    VARCHAR(30) NOT NULL DEFAULT 'clarify_metric',

  draft_state     JSONB NOT NULL DEFAULT '{}',

  schema_version  INTEGER NOT NULL DEFAULT 1,

  status          VARCHAR(20) NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active', 'completed', 'archived')),

  market_id       UUID REFERENCES markets(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_market_drafts_wallet
  ON market_drafts (creator_wallet, status, updated_at DESC);

-- Auto-update updated_at on row changes
CREATE OR REPLACE FUNCTION update_market_drafts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_market_drafts_updated_at ON market_drafts;
CREATE TRIGGER trg_market_drafts_updated_at
  BEFORE UPDATE ON market_drafts
  FOR EACH ROW
  EXECUTE FUNCTION update_market_drafts_updated_at();
