-- =============================================
-- Migration: 009_create_markets_table.sql
-- Create unified markets table and migrate data
-- =============================================

-- 1. CREATE THE NEW MARKETS TABLE

CREATE TABLE IF NOT EXISTS markets (
  -- Primary Identification (Using UUID instead of text for metric_id)
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  market_identifier VARCHAR(100) UNIQUE NOT NULL, -- Human readable identifier (replaces metric_id)
  
  -- Market Metadata
  symbol VARCHAR(30) NOT NULL,  -- Trading symbol (e.g. "ALU-USD", "BTC-USD")
  name VARCHAR(100) NOT NULL,    -- Display name
  description TEXT NOT NULL,     -- Detailed description
  category VARCHAR(50) NOT NULL, -- Market category
  
  -- Trading Parameters
  decimals INTEGER NOT NULL CHECK (decimals >= 1 AND decimals <= 18),
  minimum_order_size NUMERIC(20,8) NOT NULL CHECK (minimum_order_size > 0),
  tick_size NUMERIC(20,8) NOT NULL DEFAULT 0.01 CHECK (tick_size > 0),
  requires_kyc BOOLEAN NOT NULL DEFAULT false,
  
  -- Settlement Configuration
  settlement_date TIMESTAMPTZ,
  trading_end_date TIMESTAMPTZ,
  data_request_window_seconds INTEGER CHECK (data_request_window_seconds > 0),
  auto_settle BOOLEAN DEFAULT true,
  oracle_provider VARCHAR(42),
  
  -- Smart Contract Addresses
  market_id_bytes32 VARCHAR(66), -- On-chain bytes32 market identifier
  market_address VARCHAR(42),    -- OrderBook contract address
  factory_address VARCHAR(42),   -- MetricsMarketFactory contract address
  central_vault_address VARCHAR(42), -- CentralVault contract address
  order_router_address VARCHAR(42),  -- OrderRouter contract address
  position_manager_address VARCHAR(42), -- PositionManager contract address
  liquidation_manager_address VARCHAR(42), -- LiquidationManager contract address
  vault_analytics_address VARCHAR(42), -- VaultAnalytics contract address
  usdc_token_address VARCHAR(42), -- USDC token address
  uma_oracle_manager_address VARCHAR(42), -- UMA Oracle Manager address
  
  -- Blockchain Information
  chain_id INTEGER NOT NULL,
  network VARCHAR(50) NOT NULL DEFAULT 'Unknown',  -- Network name (e.g. "Arbitrum", "Optimism")
  deployment_transaction_hash VARCHAR(66), -- Transaction hash of market creation
  deployment_block_number BIGINT,
  deployment_gas_used BIGINT,
  
  -- Market Configuration (stored as JSONB for flexibility)
  initial_order JSONB,
  market_config JSONB, -- Additional configuration options
  
  -- Media and Display
  banner_image_url TEXT,
  icon_image_url TEXT,
  supporting_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Market Status and Analytics
  market_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
    market_status IN ('PENDING', 'DEPLOYING', 'ACTIVE', 'TRADING_ENDED', 'SETTLEMENT_REQUESTED', 'SETTLED', 'EXPIRED', 'PAUSED', 'ERROR')
  ),
  deployment_status VARCHAR(20) DEFAULT 'PENDING' CHECK (
    deployment_status IN ('PENDING', 'DEPLOYING', 'DEPLOYED', 'FAILED')
  ),
  is_active BOOLEAN NOT NULL DEFAULT true,
  total_volume NUMERIC(30,8) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  open_interest_long NUMERIC(30,8) DEFAULT 0,
  open_interest_short NUMERIC(30,8) DEFAULT 0,
  last_trade_price NUMERIC(20,8),
  settlement_value NUMERIC(20,8), -- Final settlement value
  settlement_timestamp TIMESTAMPTZ, -- When market was settled
  
  -- Creator Information
  creator_wallet_address VARCHAR(42),
  creator_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- AI Metric Resolution Link (if used during creation)
  metric_resolution_id UUID,
  
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_at TIMESTAMPTZ, -- When smart contracts were deployed
  
  -- Constraints
  CONSTRAINT check_market_identifier_format CHECK (
    market_identifier ~* '^[A-Z0-9_-]{3,100}$'
  ),
  CONSTRAINT check_oracle_provider_format CHECK (
    oracle_provider IS NULL OR oracle_provider ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_creator_wallet_format CHECK (
    creator_wallet_address IS NULL OR creator_wallet_address ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_settlement_dates CHECK (
    trading_end_date IS NULL OR settlement_date IS NULL OR trading_end_date <= settlement_date
  ),
  CONSTRAINT check_contract_addresses CHECK (
    (market_status = 'PENDING' AND market_address IS NULL) OR
    (market_status != 'PENDING' AND market_address IS NOT NULL) OR
    (deployment_status = 'PENDING')
  ),
  CONSTRAINT check_deployment_data CHECK (
    (deployment_status IN ('PENDING', 'DEPLOYING', 'FAILED') AND deployed_at IS NULL) OR
    (deployment_status = 'DEPLOYED' AND deployed_at IS NOT NULL)
  ),
  CONSTRAINT check_settlement_data CHECK (
    (market_status != 'SETTLED' AND settlement_value IS NULL AND settlement_timestamp IS NULL) OR
    (market_status = 'SETTLED' AND settlement_value IS NOT NULL AND settlement_timestamp IS NOT NULL)
  )
);

-- 2. CREATE INDEXES FOR PERFORMANCE

CREATE INDEX IF NOT EXISTS idx_markets_market_identifier ON markets(market_identifier);
CREATE INDEX IF NOT EXISTS idx_markets_symbol ON markets(symbol);
CREATE INDEX IF NOT EXISTS idx_markets_category ON markets(category);
CREATE INDEX IF NOT EXISTS idx_markets_status ON markets(market_status);
CREATE INDEX IF NOT EXISTS idx_markets_chain ON markets(chain_id);
CREATE INDEX IF NOT EXISTS idx_markets_active ON markets(is_active);
CREATE INDEX IF NOT EXISTS idx_markets_deployed ON markets(deployed_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_created ON markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_markets_volume ON markets(total_volume DESC);
CREATE INDEX IF NOT EXISTS idx_markets_market_address ON markets(market_address);
CREATE INDEX IF NOT EXISTS idx_markets_market_id_bytes32 ON markets(market_id_bytes32);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_markets_text_search ON markets 
USING GIN (to_tsvector('english', market_identifier || ' ' || symbol || ' ' || name || ' ' || description));

-- JSONB indexes
CREATE INDEX IF NOT EXISTS idx_markets_market_config_gin ON markets USING GIN (market_config);
CREATE INDEX IF NOT EXISTS idx_markets_initial_order_gin ON markets USING GIN (initial_order);

-- 3. MIGRATE DATA FROM EXISTING TABLES

-- Migrate from orderbook_markets
INSERT INTO markets (
  id, 
  market_identifier,
  symbol,
  name, 
  description, 
  category,
  decimals, 
  minimum_order_size, 
  tick_size,
  requires_kyc,
  settlement_date, 
  trading_end_date,
  data_request_window_seconds,
  auto_settle,
  oracle_provider,
  market_id_bytes32,
  market_address,
  factory_address,
  central_vault_address,
  order_router_address,
  uma_oracle_manager_address,
  chain_id,
  network,
  deployment_transaction_hash,
  deployment_block_number,
  deployment_gas_used,
  initial_order,
  banner_image_url,
  icon_image_url,
  supporting_photo_urls,
  market_status,
  deployment_status,
  is_active,
  total_volume,
  total_trades,
  open_interest_long,
  open_interest_short,
  last_trade_price,
  settlement_value,
  settlement_timestamp,
  creator_wallet_address,
  creator_user_id,
  metric_resolution_id,
  created_at,
  updated_at,
  deployed_at
)
SELECT
  id,
  metric_id,
  COALESCE(
    (CASE 
      WHEN metric_id LIKE '%BTC%' THEN 'BTC-USD'
      WHEN metric_id LIKE '%ETH%' THEN 'ETH-USD'
      WHEN metric_id LIKE '%ALU%' THEN 'ALU-USD'
      ELSE metric_id || '-USD'
    END),
    metric_id
  ),
  INITCAP(REPLACE(metric_id, '_', ' ')),
  description,
  category,
  decimals,
  minimum_order_size,
  tick_size,
  requires_kyc,
  settlement_date,
  trading_end_date,
  data_request_window_seconds,
  auto_settle,
  oracle_provider,
  NULL, -- market_id_bytes32 will be populated from orderbook_markets_resolved
  market_address,
  factory_address,
  central_vault_address,
  order_router_address,
  uma_oracle_manager_address,
  chain_id,
  CASE 
    WHEN chain_id = 1 THEN 'Ethereum'
    WHEN chain_id = 137 THEN 'Polygon'
    WHEN chain_id = 42161 THEN 'Arbitrum'
    WHEN chain_id = 10 THEN 'Optimism'
    WHEN chain_id = 8453 THEN 'Base'
    WHEN chain_id = 421613 THEN 'Arbitrum Goerli'
    WHEN chain_id = 31337 THEN 'Local Hardhat'
    ELSE 'Unknown'
  END,
  deployment_transaction_hash,
  deployment_block_number,
  deployment_gas_used,
  initial_order,
  banner_image_url,
  icon_image_url,
  supporting_photo_urls,
  market_status,
  CASE
    WHEN market_address IS NOT NULL THEN 'DEPLOYED'
    ELSE 'PENDING'
  END,
  is_active,
  total_volume,
  total_trades,
  open_interest_long,
  open_interest_short,
  last_trade_price,
  settlement_value,
  settlement_timestamp,
  creator_wallet_address,
  creator_user_id,
  metric_resolution_id,
  created_at,
  updated_at,
  deployed_at
FROM orderbook_markets;

-- Update records with data from orderbook_markets_resolved
UPDATE markets m
SET
  market_id_bytes32 = omr.market_id_bytes32,
  position_manager_address = omr.position_manager_address,
  liquidation_manager_address = omr.liquidation_manager_address,
  vault_analytics_address = omr.vault_analytics_address,
  usdc_token_address = omr.usdc_token_address
FROM orderbook_markets_resolved omr
WHERE m.market_identifier = omr.metric_id
  OR m.market_address = omr.market_address;

-- 4. UPDATE FOREIGN KEYS

-- Update market_orders to reference new markets table
ALTER TABLE market_orders
DROP CONSTRAINT IF EXISTS market_orders_market_id_fkey;

-- Create a temporary column for the migration
ALTER TABLE market_orders ADD COLUMN IF NOT EXISTS new_market_id UUID;

-- Update the temporary column with the new market IDs
UPDATE market_orders mo
SET new_market_id = m.id
FROM markets m
JOIN orderbook_markets om ON om.id = mo.market_id
WHERE m.market_identifier = om.metric_id;

-- Drop the old foreign key column and rename the new one
ALTER TABLE market_orders DROP COLUMN market_id;
ALTER TABLE market_orders RENAME COLUMN new_market_id TO market_id;

-- Add the constraint back
ALTER TABLE market_orders ADD CONSTRAINT market_orders_market_id_fkey 
FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;

-- Update market_positions to reference new markets table
ALTER TABLE market_positions
DROP CONSTRAINT IF EXISTS market_positions_market_id_fkey;

-- Create a temporary column for the migration
ALTER TABLE market_positions ADD COLUMN IF NOT EXISTS new_market_id UUID;

-- Update the temporary column with the new market IDs
UPDATE market_positions mp
SET new_market_id = m.id
FROM markets m
JOIN orderbook_markets om ON om.id = mp.market_id
WHERE m.market_identifier = om.metric_id;

-- Drop the old foreign key column and rename the new one
ALTER TABLE market_positions DROP COLUMN market_id;
ALTER TABLE market_positions RENAME COLUMN new_market_id TO market_id;

-- Add the constraint back
ALTER TABLE market_positions ADD CONSTRAINT market_positions_market_id_fkey 
FOREIGN KEY (market_id) REFERENCES markets(id) ON DELETE CASCADE;

-- 5. CREATE UPDATED_AT TRIGGER

CREATE TRIGGER update_markets_updated_at 
  BEFORE UPDATE ON markets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. CREATE HELPFUL VIEWS

-- Active markets with basic info
CREATE OR REPLACE VIEW active_markets AS
SELECT 
  id,
  market_identifier,
  symbol,
  name,
  description,
  category,
  market_status,
  deployment_status,
  settlement_date,
  trading_end_date,
  total_volume,
  total_trades,
  last_trade_price,
  creator_wallet_address,
  market_address,
  market_id_bytes32,
  chain_id,
  network,
  created_at,
  deployed_at
FROM markets
WHERE is_active = true AND market_status NOT IN ('ERROR', 'EXPIRED')
ORDER BY created_at DESC;

-- Market summary with statistics
CREATE OR REPLACE VIEW market_summary AS
SELECT 
  m.id,
  m.market_identifier,
  m.symbol,
  m.name,
  m.description,
  m.category,
  m.market_status,
  m.settlement_date,
  m.total_volume,
  m.total_trades,
  m.open_interest_long,
  m.open_interest_short,
  m.last_trade_price,
  COUNT(DISTINCT mo.trader_wallet_address) as unique_traders,
  COUNT(mp.id) as total_positions,
  SUM(CASE WHEN mp.is_settled THEN 1 ELSE 0 END) as settled_positions,
  m.created_at
FROM markets m
LEFT JOIN market_orders mo ON m.id = mo.market_id
LEFT JOIN market_positions mp ON m.id = mp.market_id
WHERE m.is_active = true
GROUP BY m.id, m.market_identifier, m.symbol, m.name, m.description, m.category, 
         m.market_status, m.settlement_date, m.total_volume, m.total_trades, 
         m.open_interest_long, m.open_interest_short, m.last_trade_price, m.created_at
ORDER BY m.created_at DESC;

-- 7. ENABLE ROW LEVEL SECURITY

ALTER TABLE markets ENABLE ROW LEVEL SECURITY;

-- 8. CREATE RLS POLICIES

-- Markets Policies
CREATE POLICY "Public markets are viewable by everyone" 
ON markets FOR SELECT 
USING (is_active = true OR auth.role() = 'service_role');

CREATE POLICY "Service role can manage all markets" 
ON markets FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Users can insert markets they create" 
ON markets FOR INSERT 
WITH CHECK (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
);

CREATE POLICY "Users can update their own markets" 
ON markets FOR UPDATE 
USING (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
)
WITH CHECK (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
);

-- 9. GRANT PERMISSIONS

GRANT SELECT ON markets TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON markets TO authenticated;
GRANT ALL ON markets TO service_role;

GRANT SELECT ON active_markets TO authenticated, anon;
GRANT SELECT ON market_summary TO authenticated, anon;

-- 10. ADD FOREIGN KEY CONSTRAINT FOR METRIC RESOLUTION

-- Add foreign key constraint for metric resolution if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_oracle_resolutions') THEN
    ALTER TABLE markets 
    ADD CONSTRAINT fk_markets_metric_resolution 
    FOREIGN KEY (metric_resolution_id) 
    REFERENCES metric_oracle_resolutions(id) 
    ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore if constraint already exists or table doesn't exist
    NULL;
END $$;

-- 11. ADD COMMENTS FOR DOCUMENTATION

COMMENT ON TABLE markets IS 'Unified markets table that combines orderbook_markets and orderbook_markets_resolved';
COMMENT ON COLUMN markets.market_identifier IS 'Human readable identifier (formerly metric_id)';
COMMENT ON COLUMN markets.symbol IS 'Trading symbol (e.g. "ALU-USD", "BTC-USD")';
COMMENT ON COLUMN markets.market_id_bytes32 IS 'On-chain bytes32 market identifier';
COMMENT ON COLUMN markets.market_address IS 'OrderBook contract address';
COMMENT ON COLUMN markets.market_status IS 'Current lifecycle status of the market';
COMMENT ON COLUMN markets.deployment_status IS 'Status of contract deployment process';

-- 12. CREATE HELPER FUNCTIONS

-- Function to create a new market
CREATE OR REPLACE FUNCTION create_market(
  p_market_identifier VARCHAR(100),
  p_symbol VARCHAR(30),
  p_name VARCHAR(100),
  p_description TEXT,
  p_category VARCHAR(50),
  p_decimals INTEGER,
  p_minimum_order_size NUMERIC,
  p_requires_kyc BOOLEAN,
  p_settlement_date TIMESTAMPTZ,
  p_trading_end_date TIMESTAMPTZ,
  p_data_request_window_seconds INTEGER,
  p_auto_settle BOOLEAN,
  p_oracle_provider VARCHAR(42),
  p_initial_order JSONB,
  p_chain_id INTEGER,
  p_network VARCHAR(50),
  p_creator_wallet_address VARCHAR(42),
  p_banner_image_url TEXT DEFAULT NULL,
  p_icon_image_url TEXT DEFAULT NULL,
  p_supporting_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[]
)
RETURNS UUID AS $$
DECLARE
  market_uuid UUID;
  creator_profile_id UUID;
BEGIN
  -- Get or create user profile
  SELECT id INTO creator_profile_id 
  FROM user_profiles 
  WHERE wallet_address = p_creator_wallet_address;
  
  -- Insert market
  INSERT INTO markets (
    market_identifier,
    symbol,
    name,
    description,
    category,
    decimals,
    minimum_order_size,
    tick_size,
    requires_kyc,
    settlement_date,
    trading_end_date,
    data_request_window_seconds,
    auto_settle,
    oracle_provider,
    initial_order,
    banner_image_url,
    icon_image_url,
    supporting_photo_urls,
    chain_id,
    network,
    creator_wallet_address,
    creator_user_id
  ) VALUES (
    p_market_identifier,
    p_symbol,
    p_name,
    p_description,
    p_category,
    p_decimals,
    p_minimum_order_size,
    0.01, -- Fixed tick size
    p_requires_kyc,
    p_settlement_date,
    p_trading_end_date,
    p_data_request_window_seconds,
    p_auto_settle,
    p_oracle_provider,
    p_initial_order,
    p_banner_image_url,
    p_icon_image_url,
    p_supporting_photo_urls,
    p_chain_id,
    p_network,
    p_creator_wallet_address,
    creator_profile_id
  ) RETURNING id INTO market_uuid;
  
  RETURN market_uuid;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Function to update market after deployment
CREATE OR REPLACE FUNCTION update_market_deployment(
  p_market_id UUID,
  p_market_address VARCHAR(42),
  p_factory_address VARCHAR(42),
  p_central_vault_address VARCHAR(42),
  p_order_router_address VARCHAR(42),
  p_position_manager_address VARCHAR(42),
  p_liquidation_manager_address VARCHAR(42),
  p_vault_analytics_address VARCHAR(42),
  p_usdc_token_address VARCHAR(42),
  p_uma_oracle_manager_address VARCHAR(42),
  p_market_id_bytes32 VARCHAR(66),
  p_transaction_hash VARCHAR(66),
  p_block_number BIGINT,
  p_gas_used BIGINT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE markets SET
    market_address = p_market_address,
    factory_address = p_factory_address,
    central_vault_address = p_central_vault_address,
    order_router_address = p_order_router_address,
    position_manager_address = p_position_manager_address,
    liquidation_manager_address = p_liquidation_manager_address,
    vault_analytics_address = p_vault_analytics_address,
    usdc_token_address = p_usdc_token_address,
    uma_oracle_manager_address = p_uma_oracle_manager_address,
    market_id_bytes32 = p_market_id_bytes32,
    deployment_transaction_hash = p_transaction_hash,
    deployment_block_number = p_block_number,
    deployment_gas_used = p_gas_used,
    deployed_at = NOW(),
    market_status = 'ACTIVE',
    deployment_status = 'DEPLOYED'
  WHERE id = p_market_id;
  
  RETURN FOUND;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Function to search markets
CREATE OR REPLACE FUNCTION search_markets(
  search_term TEXT,
  p_category VARCHAR(50) DEFAULT NULL,
  p_status VARCHAR(20) DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  market_identifier VARCHAR(100),
  symbol VARCHAR(30),
  name VARCHAR(100),
  description TEXT,
  category VARCHAR(50),
  market_status VARCHAR(20),
  total_volume NUMERIC,
  total_trades INTEGER,
  last_trade_price NUMERIC,
  settlement_date TIMESTAMPTZ,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.market_identifier,
    m.symbol,
    m.name,
    m.description,
    m.category,
    m.market_status,
    m.total_volume,
    m.total_trades,
    m.last_trade_price,
    m.settlement_date,
    m.created_at
  FROM markets m
  WHERE 
    m.is_active = true AND
    (p_category IS NULL OR m.category = p_category) AND
    (p_status IS NULL OR m.market_status = p_status) AND
    (
      search_term IS NULL OR
      search_term = '' OR
      m.market_identifier ILIKE '%' || search_term || '%' OR
      m.symbol ILIKE '%' || search_term || '%' OR
      m.name ILIKE '%' || search_term || '%' OR
      m.description ILIKE '%' || search_term || '%' OR
      to_tsvector('english', m.market_identifier || ' ' || m.symbol || ' ' || m.name || ' ' || m.description) @@ plainto_tsquery('english', search_term)
    )
  ORDER BY 
    CASE 
      WHEN m.market_identifier ILIKE search_term THEN 1
      WHEN m.market_identifier ILIKE search_term || '%' THEN 2
      WHEN m.symbol = search_term THEN 3
      WHEN m.name ILIKE '%' || search_term || '%' THEN 4
      WHEN m.description ILIKE '%' || search_term || '%' THEN 5
      ELSE 6
    END,
    m.total_volume DESC,
    m.created_at DESC
  LIMIT p_limit;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- 13. GRANT FUNCTION PERMISSIONS
GRANT EXECUTE ON FUNCTION create_market TO authenticated;
GRANT EXECUTE ON FUNCTION update_market_deployment TO service_role;
GRANT EXECUTE ON FUNCTION search_markets TO authenticated, anon;

