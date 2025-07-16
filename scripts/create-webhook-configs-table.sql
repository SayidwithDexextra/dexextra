-- Create webhook configurations table for Alchemy Notify webhooks
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS webhook_configs (
  id VARCHAR(20) PRIMARY KEY DEFAULT 'default',
  address_activity_webhook_id VARCHAR(50),
  mined_transaction_webhook_id VARCHAR(50),
  contracts JSONB NOT NULL DEFAULT '[]'::jsonb,
  network VARCHAR(20) NOT NULL,
  chain_id INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_webhook_configs_network ON webhook_configs(network);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_chain_id ON webhook_configs(chain_id);

-- Create trigger to update updated_at timestamp
CREATE TRIGGER update_webhook_configs_updated_at 
  BEFORE UPDATE ON webhook_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Verify table was created
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns 
WHERE table_schema = 'public' 
  AND table_name = 'webhook_configs'
ORDER BY ordinal_position; 