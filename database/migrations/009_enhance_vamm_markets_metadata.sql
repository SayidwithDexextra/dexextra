-- =============================================
-- Migration: 009_enhance_vamm_markets_metadata.sql
-- Add metadata fields to vamm_markets table for comprehensive deployment tracking
-- =============================================

-- First, ensure updated_at column exists (in case it was missing)
ALTER TABLE vamm_markets 
ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- Add new columns to store additional deployment metadata
ALTER TABLE vamm_markets 
ADD COLUMN IF NOT EXISTS block_number BIGINT,
ADD COLUMN IF NOT EXISTS gas_used VARCHAR(50),
ADD COLUMN IF NOT EXISTS template_type VARCHAR(20) DEFAULT 'preset',
ADD COLUMN IF NOT EXISTS template_name VARCHAR(100),
ADD COLUMN IF NOT EXISTS metric_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS metric_data_source TEXT,
ADD COLUMN IF NOT EXISTS settlement_period_days INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS max_leverage INTEGER DEFAULT 50,
ADD COLUMN IF NOT EXISTS trading_fee_rate INTEGER DEFAULT 30, -- basis points
ADD COLUMN IF NOT EXISTS volume_scale_factor INTEGER DEFAULT 1000,
ADD COLUMN IF NOT EXISTS collateral_token VARCHAR(42),
ADD COLUMN IF NOT EXISTS network VARCHAR(20) DEFAULT 'polygon';

-- Add indexes for the new searchable fields
CREATE INDEX IF NOT EXISTS idx_vamm_markets_network ON vamm_markets(network);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_template_type ON vamm_markets(template_type);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_template_name ON vamm_markets(template_name);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_block_number ON vamm_markets(block_number);
CREATE INDEX IF NOT EXISTS idx_vamm_markets_max_leverage ON vamm_markets(max_leverage);

-- Fix/recreate the updated_at trigger function to handle missing column gracefully
DROP TRIGGER IF EXISTS update_vamm_markets_updated_at ON vamm_markets;

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  -- Check if updated_at column exists before trying to set it
  IF TG_TABLE_NAME = 'vamm_markets' THEN
    NEW.updated_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger
CREATE TRIGGER update_vamm_markets_updated_at 
  BEFORE UPDATE ON vamm_markets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add comments for documentation
COMMENT ON COLUMN vamm_markets.block_number IS 'Blockchain block number where the contract was deployed';
COMMENT ON COLUMN vamm_markets.gas_used IS 'Gas consumed during contract deployment';
COMMENT ON COLUMN vamm_markets.template_type IS 'Type of VAMM template used: preset or custom';
COMMENT ON COLUMN vamm_markets.template_name IS 'Name of the template (e.g., standard, conservative, aggressive, or custom)';
COMMENT ON COLUMN vamm_markets.metric_name IS 'Display name of the metric being traded';
COMMENT ON COLUMN vamm_markets.metric_data_source IS 'Source of metric data (URL or description)';
COMMENT ON COLUMN vamm_markets.settlement_period_days IS 'Settlement period in days for metric resolution';
COMMENT ON COLUMN vamm_markets.max_leverage IS 'Maximum leverage allowed in this market';
COMMENT ON COLUMN vamm_markets.trading_fee_rate IS 'Trading fee rate in basis points (e.g., 30 = 0.3%)';
COMMENT ON COLUMN vamm_markets.volume_scale_factor IS 'Scaling factor for volume calculations';
COMMENT ON COLUMN vamm_markets.collateral_token IS 'Address of the collateral token (usually USDC)';
COMMENT ON COLUMN vamm_markets.network IS 'Blockchain network where contracts are deployed';

-- Update existing records with default values where possible
UPDATE vamm_markets SET 
  template_type = 'preset',
  template_name = 'standard',
  settlement_period_days = 7,
  max_leverage = 50,
  trading_fee_rate = 30,
  volume_scale_factor = 1000,
  network = 'polygon'
WHERE template_type IS NULL;

-- Insert sample enhanced data for testing (only if ENHANCED_TEST doesn't exist)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vamm_markets WHERE symbol = 'ENHANCED_TEST') THEN
    INSERT INTO vamm_markets (
      symbol, description, category, oracle_address, initial_price, price_decimals,
      banner_image_url, icon_image_url, deployment_fee, is_active, user_address,
      vamm_address, vault_address, market_id, transaction_hash, deployment_status,
      block_number, gas_used, template_type, template_name, metric_name,
      metric_data_source, settlement_period_days, max_leverage, trading_fee_rate,
      volume_scale_factor, collateral_token, network
    ) VALUES (
      'ENHANCED_TEST',
      'Enhanced test market with full metadata',
      '{"test", "enhanced", "metadata"}',
      '0x742d35Cc6635C0532925a3b8D9B5A7b8C6B9D0e1',
      25.50,
      8,
      'https://example.com/banner.jpg',
      'https://example.com/icon.jpg',
      0.1,
      true,
      '0x60D4a8b8a9b7f96D7e9c8E5f2796B1a2C3d4E5f6',
      '0x3e7bc93471a1b4c88c5e7a86a7a6c7d8e9f0a1b3',
      '0x4f8cd93471a1b4c88c5e7a86a7a6c7d8e9f0a1b4',
      '0x2345678901bcdef12345678901bcdef12345678901bcdef12345678901bcdef1',
      '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
      'deployed',
      45123456,
      '892341',
      'custom',
      'aggressive-v2',
      'Enhanced Test Metric',
      'https://api.example.com/enhanced-data',
      14,
      100,
      50,
      2000,
      '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174',
      'polygon'
    );
    RAISE NOTICE 'Sample enhanced market data inserted successfully';
  ELSE
    RAISE NOTICE 'ENHANCED_TEST market already exists, skipping sample data insertion';
  END IF;
END $$;

-- Validation checks
DO $$
BEGIN
  -- Verify new columns exist
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'vamm_markets' AND column_name = 'block_number') THEN
    RAISE EXCEPTION 'Migration failed: block_number column not created';
  END IF;
  
  -- Verify indexes exist
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'vamm_markets' AND indexname = 'idx_vamm_markets_network') THEN
    RAISE EXCEPTION 'Migration failed: network index not created';
  END IF;
  
  RAISE NOTICE 'Migration 009 completed successfully - Enhanced metadata fields added to vamm_markets';
END $$; 