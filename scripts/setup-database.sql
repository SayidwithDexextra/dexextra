-- Database Setup Script for Approach 1
-- Run this in your Supabase SQL Editor

-- Create contract events table
CREATE TABLE IF NOT EXISTS contract_events (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  transaction_hash VARCHAR(66) NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  log_index INTEGER NOT NULL,
  contract_address VARCHAR(42) NOT NULL,
  event_type VARCHAR(50) NOT NULL,
  event_data JSONB NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL,
  chain_id BIGINT NOT NULL,
  user_address VARCHAR(42),
  market_id VARCHAR(255),
  symbol VARCHAR(20),
  amount NUMERIC,
  size NUMERIC,
  value NUMERIC,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate events
  UNIQUE(transaction_hash, log_index)
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_contract_events_contract_address ON contract_events(contract_address);
CREATE INDEX IF NOT EXISTS idx_contract_events_event_type ON contract_events(event_type);
CREATE INDEX IF NOT EXISTS idx_contract_events_user_address ON contract_events(user_address);
CREATE INDEX IF NOT EXISTS idx_contract_events_block_number ON contract_events(block_number);
CREATE INDEX IF NOT EXISTS idx_contract_events_timestamp ON contract_events(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_contract_events_market_id ON contract_events(market_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_symbol ON contract_events(symbol);

-- Composite indexes for common queries
CREATE INDEX IF NOT EXISTS idx_contract_events_user_type ON contract_events(user_address, event_type);
CREATE INDEX IF NOT EXISTS idx_contract_events_contract_type ON contract_events(contract_address, event_type);
CREATE INDEX IF NOT EXISTS idx_contract_events_timestamp_type ON contract_events(timestamp DESC, event_type);

-- Create event subscriptions table
CREATE TABLE IF NOT EXISTS event_subscriptions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  contract_address VARCHAR(42) NOT NULL,
  event_name VARCHAR(50) NOT NULL,
  user_address VARCHAR(42),
  is_active BOOLEAN DEFAULT true,
  webhook_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for subscriptions
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_contract ON event_subscriptions(contract_address);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_active ON event_subscriptions(is_active);
CREATE INDEX IF NOT EXISTS idx_event_subscriptions_user ON event_subscriptions(user_address);

-- Create contract sync status table
CREATE TABLE IF NOT EXISTS contract_sync_status (
  contract_address VARCHAR(42) PRIMARY KEY,
  last_processed_block BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create a function to update the updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger for event_subscriptions
CREATE TRIGGER update_event_subscriptions_updated_at 
  BEFORE UPDATE ON event_subscriptions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for contract_sync_status
CREATE TRIGGER update_contract_sync_status_updated_at 
  BEFORE UPDATE ON contract_sync_status 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create webhook configurations table for Alchemy Notify webhooks
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

-- Create index for webhook configs
CREATE INDEX IF NOT EXISTS idx_webhook_configs_network ON webhook_configs(network);
CREATE INDEX IF NOT EXISTS idx_webhook_configs_chain_id ON webhook_configs(chain_id);

-- Create trigger to update webhook configs updated_at timestamp
CREATE TRIGGER update_webhook_configs_updated_at 
  BEFORE UPDATE ON webhook_configs 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create view for event metrics
CREATE OR REPLACE VIEW event_metrics AS
SELECT 
  DATE_TRUNC('hour', timestamp) as hour,
  DATE_TRUNC('day', timestamp) as day,
  event_type,
  contract_address,
  COUNT(*) as event_count,
  COUNT(DISTINCT user_address) as unique_users,
  SUM(CASE WHEN amount IS NOT NULL THEN amount ELSE 0 END) as total_amount,
  SUM(CASE WHEN size IS NOT NULL THEN size ELSE 0 END) as total_size,
  SUM(CASE WHEN value IS NOT NULL THEN value ELSE 0 END) as total_value
FROM contract_events 
GROUP BY 
  DATE_TRUNC('hour', timestamp),
  DATE_TRUNC('day', timestamp),
  event_type,
  contract_address;

-- Verify tables were created
SELECT 
  table_name,
  table_schema
FROM information_schema.tables 
WHERE table_schema = 'public' 
  AND table_name IN ('contract_events', 'event_subscriptions', 'contract_sync_status')
ORDER BY table_name; 