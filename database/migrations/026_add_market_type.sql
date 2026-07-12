-- =============================================
-- Migration: 026_add_market_type.sql
-- Purpose: Support ratio and indexed (base-100) markets.
--          Adds a queryable market_type discriminator and the IPFS manifest
--          CID that anchors the market's spec + start-price provenance.
--          All richer config (legs, baseline, manifest url/sha256) continues
--          to live in the existing market_config JSONB.
-- =============================================

-- 1) market_type discriminator (single | ratio | indexed)
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS market_type VARCHAR(16) NOT NULL DEFAULT 'single';

-- Backfill: everything created before this migration is a single-metric market.
UPDATE markets SET market_type = 'single' WHERE market_type IS NULL;

-- Constrain to known values.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'markets' AND constraint_name = 'check_market_type'
  ) THEN
    ALTER TABLE markets
      ADD CONSTRAINT check_market_type
      CHECK (market_type IN ('single', 'ratio', 'indexed'));
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 2) IPFS manifest CID (also stored as ipfs://<cid> in the on-chain metricUrl)
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS manifest_cid VARCHAR(100) DEFAULT NULL;

-- 3) Indexes for discovery/filtering by market type
CREATE INDEX IF NOT EXISTS idx_markets_market_type ON markets(market_type);
CREATE INDEX IF NOT EXISTS idx_markets_manifest_cid
  ON markets(manifest_cid)
  WHERE manifest_cid IS NOT NULL;

-- 4) Documentation
COMMENT ON COLUMN markets.market_type IS 'Market metric-tracking mode: single (one metric), ratio (raw A/B), or indexed (base-100 index of A/B).';
COMMENT ON COLUMN markets.manifest_cid IS 'IPFS CID of the immutable market manifest (type, legs, indexed baseline, start-price provenance). Mirrored on-chain as metricUrl = ipfs://<cid> for ratio/indexed markets.';

-- 5) market_config JSONB keys written by the creation pipeline for ratio/indexed markets:
--      market_config.market_type      : 'single' | 'ratio' | 'indexed'
--      market_config.manifest_cid     : IPFS CID
--      market_config.manifest_url      : ipfs://<cid>
--      market_config.manifest_sha256  : sha256 of canonical manifest bytes (independent integrity check)
--      market_config.legs             : { numerator: {...}, denominator: {...} }
--      market_config.baseline         : { A0, B0, V0, asOf } (indexed only)
--      market_config.base_value       : 100 (indexed)
--      market_config.operator         : 'A' | 'A/B'
--    These require no schema change (JSONB) and are documented here for reference.
