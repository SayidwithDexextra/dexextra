-- =============================================
-- Migration: 010_add_metric_id_to_vamm_markets.sql
-- Add metric_id column to vamm_markets table for proper metric tracking
-- =============================================

-- Add metric_id column that deployment scripts are already using
ALTER TABLE vamm_markets 
ADD COLUMN IF NOT EXISTS metric_id VARCHAR(66);

-- Add index for efficient metric_id lookups
CREATE INDEX IF NOT EXISTS idx_vamm_markets_metric_id ON vamm_markets(metric_id);

-- Add comment for documentation
COMMENT ON COLUMN vamm_markets.metric_id IS 'Bytes32 metric identifier used in smart contracts (0x-prefixed)';

-- Update existing records without metric_id to generate one from their metric_name or symbol
-- This ensures backward compatibility for existing markets
UPDATE vamm_markets 
SET metric_id = COALESCE(
  -- If metric_name exists, use it
  CASE 
    WHEN metric_name IS NOT NULL AND LENGTH(metric_name) > 0 THEN
      '0x' || encode(rpad(metric_name::bytea, 32, '\x00'::bytea), 'hex')
    ELSE
      -- Fallback to symbol
      '0x' || encode(rpad(symbol::bytea, 32, '\x00'::bytea), 'hex')
  END
)
WHERE metric_id IS NULL;

-- Add constraint to ensure metric_id format is valid (0x followed by 64 hex chars)
ALTER TABLE vamm_markets 
ADD CONSTRAINT check_metric_id_format 
CHECK (metric_id IS NULL OR metric_id ~* '^0x[a-fA-F0-9]{64}$'); 