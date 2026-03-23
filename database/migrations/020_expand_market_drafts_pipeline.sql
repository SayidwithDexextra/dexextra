-- =============================================
-- Migration: 020_expand_market_drafts_pipeline.sql
-- Expand market_drafts to support pipeline
-- checkpoint/resume for split market creation
-- =============================================

-- New columns for on-chain deployment state
ALTER TABLE market_drafts
  ADD COLUMN IF NOT EXISTS orderbook_address  VARCHAR(42),
  ADD COLUMN IF NOT EXISTS market_id_bytes32  TEXT,
  ADD COLUMN IF NOT EXISTS transaction_hash   VARCHAR(66),
  ADD COLUMN IF NOT EXISTS chain_id           INTEGER,
  ADD COLUMN IF NOT EXISTS block_number       BIGINT,
  ADD COLUMN IF NOT EXISTS pipeline_stage     VARCHAR(30) NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS pipeline_state     JSONB NOT NULL DEFAULT '{}';

-- Expand the status CHECK to include 'deploying'
ALTER TABLE market_drafts DROP CONSTRAINT IF EXISTS market_drafts_status_check;
ALTER TABLE market_drafts
  ADD CONSTRAINT market_drafts_status_check
  CHECK (status IN ('active', 'deploying', 'completed', 'archived'));

-- pipeline_stage CHECK
ALTER TABLE market_drafts
  ADD CONSTRAINT market_drafts_pipeline_stage_check
  CHECK (pipeline_stage IN (
    'draft',
    'deploying', 'deployed',
    'configuring', 'configured',
    'finalizing', 'finalized'
  ));

-- Prevent duplicate deployments for the same orderbook
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_drafts_orderbook
  ON market_drafts (orderbook_address)
  WHERE orderbook_address IS NOT NULL AND status != 'archived';

-- Fast lookup for pipeline resume
CREATE INDEX IF NOT EXISTS idx_market_drafts_pipeline
  ON market_drafts (pipeline_stage, status)
  WHERE status = 'active' OR status = 'deploying';
