-- =============================================
-- Migration: 017_add_ai_source_locator_column.sql
-- Purpose: Add dedicated ai_source_locator JSONB column to markets table
--          for auto-discovered CSS/XPath/JS selectors that enable fast-path
--          metric extraction without the full multi-model vision pipeline.
-- =============================================

-- 1) Add the column
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS ai_source_locator JSONB DEFAULT NULL;

-- 2) Migrate existing data from market_config->'ai_source_locator' into the new column
UPDATE markets
SET ai_source_locator = jsonb_build_object(
  'url', market_config->'ai_source_locator'->>'url',
  'selectors', '[]'::jsonb,
  'discovered_at', NOW(),
  'last_successful_at', NULL,
  'success_count', 0,
  'failure_count', 0,
  'version', 1
)
WHERE market_config->'ai_source_locator' IS NOT NULL
  AND market_config->'ai_source_locator'->>'url' IS NOT NULL
  AND ai_source_locator IS NULL;

-- 3) Remove the nested key from market_config to avoid dual-source confusion
UPDATE markets
SET market_config = market_config - 'ai_source_locator'
WHERE market_config ? 'ai_source_locator';

-- 4) Index for fast lookups on markets that have a locator
CREATE INDEX IF NOT EXISTS idx_markets_ai_source_locator_not_null
  ON markets ((ai_source_locator IS NOT NULL))
  WHERE ai_source_locator IS NOT NULL;

-- 5) Documentation
COMMENT ON COLUMN markets.ai_source_locator IS 'Auto-discovered CSS/XPath/JS selectors for fast metric extraction. Populated during market creation, updated on each successful fast-path fetch.';
