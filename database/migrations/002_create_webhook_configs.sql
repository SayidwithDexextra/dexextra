-- Migration: Add webhook_configs table for Alchemy Notify API
-- This table stores webhook configuration for the new event monitoring system

-- Create webhook_configs table
CREATE TABLE IF NOT EXISTS webhook_configs (
  id VARCHAR(50) PRIMARY KEY DEFAULT 'default',
  address_activity_webhook_id VARCHAR(100) NOT NULL,
  mined_transaction_webhook_id VARCHAR(100) NOT NULL,
  contracts JSONB NOT NULL DEFAULT '[]',
  network VARCHAR(50) NOT NULL DEFAULT 'polygon',
  chain_id BIGINT NOT NULL DEFAULT 137,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_webhook_configs_network ON webhook_configs(network);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_chain_id ON webhook_configs(chain_id);

-- Create function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_webhook_configs_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for webhook_configs
CREATE TRIGGER update_webhook_configs_updated_at 
  BEFORE UPDATE ON webhook_configs 
  FOR EACH ROW EXECUTE FUNCTION update_webhook_configs_updated_at();

-- Add comment to table
COMMENT ON TABLE webhook_configs IS 'Stores Alchemy webhook configuration for smart contract event monitoring';
COMMENT ON COLUMN webhook_configs.id IS 'Unique identifier for the configuration (default: "default")';
COMMENT ON COLUMN webhook_configs.address_activity_webhook_id IS 'Alchemy webhook ID for address activity monitoring';
COMMENT ON COLUMN webhook_configs.mined_transaction_webhook_id IS 'Alchemy webhook ID for mined transaction monitoring';
COMMENT ON COLUMN webhook_configs.contracts IS 'JSON array of contracts being monitored';
COMMENT ON COLUMN webhook_configs.network IS 'Blockchain network (polygon, ethereum, etc.)';
COMMENT ON COLUMN webhook_configs.chain_id IS 'Blockchain chain ID (137 for Polygon, etc.)';

-- Insert default placeholder (will be updated by migration script)
INSERT INTO webhook_configs (
  id,
  address_activity_webhook_id,
  mined_transaction_webhook_id,
  contracts,
  network,
  chain_id
) VALUES (
  'default',
  'placeholder-address-activity',
  'placeholder-mined-transaction',
  '[]',
  'polygon',
  137
) ON CONFLICT (id) DO NOTHING; 