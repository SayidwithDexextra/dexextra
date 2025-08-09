-- =============================================
-- OPTIMIZED DATABASE SCHEMA MIGRATION
-- Migration: 004_create_optimized_trading_tables.sql
-- 
-- EFFICIENCY-FIRST APPROACH: Minimal table creation with maximum functionality
-- - Enhances existing user_profiles with JSONB portfolio data
-- - Enhances existing contract_events with comprehensive trading data
-- - Creates only 2 essential new tables: positions + orders
-- - Uses materialized views for analytics performance
-- - Leverages JSONB for flexible data without schema changes
-- =============================================

-- =============================================
-- 1. ENHANCE EXISTING USER_PROFILES TABLE
-- =============================================

-- Add trading portfolio as flexible JSONB + essential indexed fields
ALTER TABLE user_profiles 
ADD COLUMN IF NOT EXISTS portfolio_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS total_collateral NUMERIC(36,6) DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_unrealized_pnl NUMERIC(36,18) DEFAULT 0,
ADD COLUMN IF NOT EXISTS health_factor NUMERIC(10,4) DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_activity TIMESTAMPTZ DEFAULT NOW(),
ADD COLUMN IF NOT EXISTS trading_tier VARCHAR(20) DEFAULT 'bronze';

-- Create GIN index for fast JSONB queries
CREATE INDEX IF NOT EXISTS idx_user_profiles_portfolio_gin ON user_profiles USING GIN (portfolio_data);

-- Essential performance indexes
CREATE INDEX IF NOT EXISTS idx_user_profiles_last_activity ON user_profiles(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_user_profiles_health_factor ON user_profiles(health_factor);
CREATE INDEX IF NOT EXISTS idx_user_profiles_collateral ON user_profiles(total_collateral DESC);

-- =============================================
-- 2. ENHANCE CONTRACT_EVENTS TABLE  
-- =============================================

-- Add comprehensive trading data as JSONB + key indexed fields
ALTER TABLE contract_events 
ADD COLUMN IF NOT EXISTS contract_version VARCHAR(10) DEFAULT 'v1',
ADD COLUMN IF NOT EXISTS market_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS trading_data JSONB DEFAULT '{}',
ADD COLUMN IF NOT EXISTS position_id BIGINT,
ADD COLUMN IF NOT EXISTS order_id BIGINT,
ADD COLUMN IF NOT EXISTS price NUMERIC(36,18),
ADD COLUMN IF NOT EXISTS leverage BIGINT;

-- Create GIN indexes for fast JSONB queries  
CREATE INDEX IF NOT EXISTS idx_contract_events_market_gin ON contract_events USING GIN (market_data);
CREATE INDEX IF NOT EXISTS idx_contract_events_trading_gin ON contract_events USING GIN (trading_data);

-- Performance indexes for common queries
CREATE INDEX IF NOT EXISTS idx_contract_events_version ON contract_events(contract_version);
CREATE INDEX IF NOT EXISTS idx_contract_events_position_id ON contract_events(position_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_order_id ON contract_events(order_id);
CREATE INDEX IF NOT EXISTS idx_contract_events_price ON contract_events(price);

-- =============================================
-- 3. POSITIONS TABLE (Essential - Core Trading Data)
-- =============================================

CREATE TABLE IF NOT EXISTS positions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  position_id BIGINT NOT NULL,
  user_address VARCHAR(42) NOT NULL,
  contract_address VARCHAR(42) NOT NULL,
  contract_version VARCHAR(10) NOT NULL DEFAULT 'v1',
  
  -- Core Position Data
  size NUMERIC(36,18) NOT NULL,
  is_long BOOLEAN NOT NULL,
  entry_price NUMERIC(36,18) NOT NULL,
  leverage BIGINT NOT NULL,
  collateral_amount NUMERIC(36,6) NOT NULL,
  
  -- Current State  
  current_price NUMERIC(36,18),
  unrealized_pnl NUMERIC(36,18) DEFAULT 0,
  funding_paid NUMERIC(36,18) DEFAULT 0,
  fees_paid NUMERIC(36,18) DEFAULT 0,
  
  -- Flexible data for version-specific fields
  position_metadata JSONB DEFAULT '{}',
  
  -- Status & Lifecycle
  is_active BOOLEAN NOT NULL DEFAULT true,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ,
  opening_tx VARCHAR(66) NOT NULL,
  closing_tx VARCHAR(66),
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(position_id, contract_address)
);

-- Optimized indexes for positions
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_address);
CREATE INDEX IF NOT EXISTS idx_positions_contract ON positions(contract_address);
CREATE INDEX IF NOT EXISTS idx_positions_active ON positions(is_active);
CREATE INDEX IF NOT EXISTS idx_positions_version ON positions(contract_version);
CREATE INDEX IF NOT EXISTS idx_positions_user_active ON positions(user_address, is_active);
CREATE INDEX IF NOT EXISTS idx_positions_opened ON positions(opened_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_metadata_gin ON positions USING GIN (position_metadata);

-- =============================================
-- 4. ORDERS TABLE (Essential - Different Lifecycle)
-- =============================================

CREATE TABLE IF NOT EXISTS orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id BIGINT NOT NULL,
  user_address VARCHAR(42) NOT NULL,
  contract_address VARCHAR(42),
  contract_version VARCHAR(10) NOT NULL DEFAULT 'v1',
  
  -- Core Order Data
  order_type SMALLINT NOT NULL,
  side VARCHAR(10) NOT NULL,
  is_long BOOLEAN NOT NULL,
  collateral_amount NUMERIC(36,6) NOT NULL,
  leverage BIGINT NOT NULL,
  trigger_price NUMERIC(36,18),
  
  -- Status
  status SMALLINT NOT NULL DEFAULT 0,
  expiry TIMESTAMPTZ,
  
  -- Execution
  executed_price NUMERIC(36,18),
  executed_at TIMESTAMPTZ,
  execution_tx VARCHAR(66),
  resulting_position_id BIGINT,
  
  -- Flexible data for version-specific fields
  order_metadata JSONB DEFAULT '{}',
  
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(order_id, contract_address)
);

-- Optimized indexes for orders
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_address);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_contract ON orders(contract_address);
CREATE INDEX IF NOT EXISTS idx_orders_version ON orders(contract_version);
CREATE INDEX IF NOT EXISTS idx_orders_user_status ON orders(user_address, status);
CREATE INDEX IF NOT EXISTS idx_orders_expiry ON orders(expiry);
CREATE INDEX IF NOT EXISTS idx_orders_metadata_gin ON orders USING GIN (order_metadata);

-- =============================================
-- 5. SYSTEM CONFIGURATION TABLE
-- =============================================

CREATE TABLE IF NOT EXISTS system_config (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  network VARCHAR(20) NOT NULL,
  contract_version VARCHAR(10) NOT NULL DEFAULT 'v1',
  
  -- V1 Contract Addresses
  vamm_factory_address VARCHAR(42),
  vault_factory_address VARCHAR(42),
  price_oracle_address VARCHAR(42),
  
  -- V2 Contract Addresses  
  metric_vamm_factory_address VARCHAR(42),
  centralized_vault_address VARCHAR(42),
  metric_vamm_router_address VARCHAR(42),
  limit_order_manager_address VARCHAR(42),
  automation_funding_manager_address VARCHAR(42),
  limit_order_keeper_address VARCHAR(42),
  metric_registry_address VARCHAR(42),
  
  -- Shared Critical Addresses
  usdc_address VARCHAR(42) NOT NULL,
  weth_address VARCHAR(42),
  
  -- System Parameters
  min_collateral_usd NUMERIC(36,6) DEFAULT 10,
  max_leverage BIGINT DEFAULT 50,
  default_trading_fee BIGINT DEFAULT 30, -- basis points
  automation_fee_usd NUMERIC(36,6) DEFAULT 5,
  keeper_reward_rate BIGINT DEFAULT 100, -- basis points
  
  -- Network Info
  chain_id BIGINT NOT NULL,
  rpc_url TEXT,
  block_explorer_url TEXT,
  
  -- Status
  is_active BOOLEAN NOT NULL DEFAULT true,
  deployed_at TIMESTAMPTZ NOT NULL,
  deployment_block BIGINT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints for data integrity
  UNIQUE(network, contract_version),
  CHECK (usdc_address ~* '^0x[a-fA-F0-9]{40}$'),
  CHECK (network IN ('polygon', 'mumbai', 'localhost', 'mainnet')),
  CHECK (contract_version IN ('v1', 'v2'))
);

-- Create indexes for system_config
CREATE INDEX IF NOT EXISTS idx_system_config_network ON system_config(network);
CREATE INDEX IF NOT EXISTS idx_system_config_version ON system_config(contract_version);
CREATE INDEX IF NOT EXISTS idx_system_config_active ON system_config(is_active);

-- Insert V1 system config (using valid placeholder addresses)
INSERT INTO system_config (
  network, contract_version, chain_id,
  vamm_factory_address, vault_factory_address, price_oracle_address,
  usdc_address, deployed_at
) VALUES (
  'polygon', 'v1', 137,
  '0x1111111111111111111111111111111111111111', -- PLACEHOLDER: Replace with real V1 VAMM factory
  '0x2222222222222222222222222222222222222222', -- PLACEHOLDER: Replace with real V1 vault factory
  '0x3333333333333333333333333333333333333333', -- PLACEHOLDER: Replace with real V1 price oracle
  '0xA0b86a33E6843b496C5f87ac3e41abDB5eFB97Dc', -- Real USDC address on Polygon
  NOW()
) ON CONFLICT (network, contract_version) DO NOTHING;

-- Insert V2 system config (using valid placeholder addresses)
INSERT INTO system_config (
  network, contract_version, chain_id,
  metric_vamm_factory_address, centralized_vault_address, metric_vamm_router_address,
  limit_order_manager_address, automation_funding_manager_address, 
  limit_order_keeper_address, metric_registry_address,
  usdc_address, deployed_at
) VALUES (
  'polygon', 'v2', 137,
  '0x4444444444444444444444444444444444444444', -- PLACEHOLDER: Replace with real metric VAMM factory
  '0x5555555555555555555555555555555555555555', -- PLACEHOLDER: Replace with real centralized vault
  '0x6666666666666666666666666666666666666666', -- PLACEHOLDER: Replace with real metric VAMM router
  '0x7777777777777777777777777777777777777777', -- PLACEHOLDER: Replace with real limit order manager
  '0x8888888888888888888888888888888888888888', -- PLACEHOLDER: Replace with real automation funding
  '0x9999999999999999999999999999999999999999', -- PLACEHOLDER: Replace with real limit order keeper
  '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', -- PLACEHOLDER: Replace with real metric registry
  '0xA0b86a33E6843b496C5f87ac3e41abDB5eFB97Dc', -- Real USDC address on Polygon
  NOW()
) ON CONFLICT (network, contract_version) DO NOTHING;

-- =============================================
-- 6. UPDATE TRIGGERS (Reuse Existing Function)
-- =============================================

-- Drop triggers if they exist, then recreate (makes migration idempotent)
DROP TRIGGER IF EXISTS update_positions_updated_at ON positions;
CREATE TRIGGER update_positions_updated_at 
  BEFORE UPDATE ON positions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_orders_updated_at ON orders;
CREATE TRIGGER update_orders_updated_at 
  BEFORE UPDATE ON orders 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_system_config_updated_at ON system_config;
CREATE TRIGGER update_system_config_updated_at 
  BEFORE UPDATE ON system_config 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- =============================================
-- 7. EFFICIENT VIEWS (Using Materialized for Performance)
-- =============================================

-- Market data derived from contract_events (no separate table needed)
CREATE OR REPLACE VIEW markets_view AS
SELECT DISTINCT
  (market_data->>'market_identifier')::VARCHAR AS market_identifier,
  contract_address,
  contract_version,
  (market_data->>'name')::VARCHAR AS name,
  (market_data->>'symbol')::VARCHAR AS symbol,
  (market_data->>'category')::VARCHAR AS category,
  market_data->>'oracle_address' AS oracle_address,
  market_data->>'vault_address' AS vault_address,
  (market_data->>'max_leverage')::BIGINT AS max_leverage,
  (market_data->>'trading_fee')::BIGINT AS trading_fee,
  user_address AS creator_address,
  timestamp AS deployed_at,
  
  -- Real-time stats from positions
  (SELECT COUNT(*) FROM positions p WHERE p.contract_address = ce.contract_address) AS total_positions,
  (SELECT COUNT(*) FROM positions p WHERE p.contract_address = ce.contract_address AND p.is_active = true) AS active_positions,
  (SELECT COALESCE(SUM(p.collateral_amount), 0) FROM positions p WHERE p.contract_address = ce.contract_address) AS total_volume
FROM contract_events ce
WHERE event_type IN ('MarketDeployed', 'VAMMDeployed', 'MetricVAMMDeployed')
  AND market_data IS NOT NULL
  AND market_data->>'market_identifier' IS NOT NULL;

-- Portfolio dashboard (materialized for performance)
DROP MATERIALIZED VIEW IF EXISTS portfolio_dashboard;
CREATE MATERIALIZED VIEW portfolio_dashboard AS
SELECT 
  up.wallet_address as user_address,
  up.username,
  up.display_name,
  up.total_collateral,
  up.total_unrealized_pnl,
  up.health_factor,
  up.trading_tier,
  up.last_activity,
  
  -- Portfolio stats from JSONB
  (up.portfolio_data->>'total_positions')::INTEGER AS total_positions,
  (up.portfolio_data->>'active_positions')::INTEGER AS active_positions,
  (up.portfolio_data->>'total_volume')::NUMERIC AS total_volume,
  (up.portfolio_data->>'win_rate')::NUMERIC AS win_rate,
  
  -- Real-time position counts
  COUNT(DISTINCT p.contract_address) as active_markets,
  COUNT(DISTINCT CASE WHEN o.status IN (0,1) THEN o.id END) as active_orders,
  COUNT(DISTINCT CASE WHEN p.contract_version = 'v1' THEN p.id END) as v1_positions,
  COUNT(DISTINCT CASE WHEN p.contract_version = 'v2' THEN p.id END) as v2_positions
  
FROM user_profiles up
LEFT JOIN positions p ON p.user_address = up.wallet_address AND p.is_active = true
LEFT JOIN orders o ON o.user_address = up.wallet_address AND o.status IN (0,1)
WHERE up.is_active = true
GROUP BY up.wallet_address, up.username, up.display_name, up.total_collateral,
         up.total_unrealized_pnl, up.health_factor, up.trading_tier, up.last_activity,
         up.portfolio_data;

-- System health (materialized for performance)
DROP MATERIALIZED VIEW IF EXISTS system_health;
CREATE MATERIALIZED VIEW system_health AS
SELECT 
  'polygon' as network,
  
  -- Market stats from events
  (SELECT COUNT(DISTINCT contract_address) FROM contract_events 
   WHERE event_type LIKE '%Deploy%' AND contract_version = 'v1' AND chain_id = 137) as v1_markets,
  (SELECT COUNT(DISTINCT contract_address) FROM contract_events 
   WHERE event_type LIKE '%Deploy%' AND contract_version = 'v2' AND chain_id = 137) as v2_markets,
  
  -- User stats
  (SELECT COUNT(DISTINCT wallet_address) FROM user_profiles WHERE is_active = true) as total_users,
  (SELECT COUNT(DISTINCT user_address) FROM positions WHERE is_active = true) as active_traders,
  
  -- Financial stats
  (SELECT COALESCE(SUM(total_collateral), 0) FROM user_profiles WHERE total_collateral > 0) as total_tvl,
  (SELECT COUNT(DISTINCT wallet_address) FROM user_profiles 
   WHERE health_factor < 1.2 AND total_collateral > 0) as users_at_risk,
  (SELECT COALESCE(AVG(health_factor), 0) FROM user_profiles 
   WHERE total_collateral > 0) as avg_health_factor,
  
  -- Position stats
  (SELECT COUNT(*) FROM positions) as total_positions,
  (SELECT COUNT(*) FROM positions WHERE is_active = true) as active_positions,
  
  -- Order stats
  (SELECT COUNT(*) FROM orders WHERE status IN (0,1)) as active_orders,
  
  NOW() as calculated_at;

-- Create indexes on materialized views (drop first to handle recreation)
DROP INDEX IF EXISTS idx_portfolio_dashboard_user;
DROP INDEX IF EXISTS idx_portfolio_dashboard_health;
CREATE INDEX idx_portfolio_dashboard_user ON portfolio_dashboard(user_address);
CREATE INDEX idx_portfolio_dashboard_health ON portfolio_dashboard(health_factor);

-- =============================================
-- 8. HELPER FUNCTIONS FOR JSONB DATA
-- =============================================

-- Function to update user portfolio data
CREATE OR REPLACE FUNCTION update_user_portfolio_data(
  p_user_address TEXT,
  p_data JSONB
) RETURNS VOID AS $$
BEGIN
  UPDATE user_profiles 
  SET 
    portfolio_data = portfolio_data || p_data,
    total_collateral = COALESCE((p_data->>'total_collateral')::NUMERIC, total_collateral),
    total_unrealized_pnl = COALESCE((p_data->>'total_unrealized_pnl')::NUMERIC, total_unrealized_pnl),
    health_factor = COALESCE((p_data->>'health_factor')::NUMERIC, health_factor),
    last_activity = NOW()
  WHERE wallet_address = p_user_address;
END;
$$ language 'plpgsql';

-- Function to get system config
CREATE OR REPLACE FUNCTION get_system_config(p_version TEXT DEFAULT 'v2', p_network TEXT DEFAULT 'polygon')
RETURNS system_config AS $$
DECLARE
  config_record system_config;
BEGIN
  SELECT * INTO config_record
  FROM system_config
  WHERE contract_version = p_version 
    AND network = p_network
    AND is_active = true
  LIMIT 1;
  
  RETURN config_record;
END;
$$ language 'plpgsql';

-- Function to refresh materialized views
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW portfolio_dashboard;
  REFRESH MATERIALIZED VIEW system_health;
END;
$$ language 'plpgsql';

-- =============================================
-- 9. SCHEDULED REFRESH (Optional)
-- =============================================

-- You can set up pg_cron to refresh materialized views periodically
-- SELECT cron.schedule('refresh-analytics', '*/15 * * * *', 'SELECT refresh_analytics_views();');

-- =============================================
-- 10. GRANT PERMISSIONS
-- =============================================

GRANT SELECT, INSERT, UPDATE, DELETE ON positions TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON orders TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON system_config TO authenticated;
GRANT SELECT ON system_config TO anon;
GRANT SELECT ON markets_view TO authenticated, anon;
GRANT SELECT ON portfolio_dashboard TO authenticated;
GRANT SELECT ON system_health TO authenticated, anon;
GRANT EXECUTE ON FUNCTION update_user_portfolio_data(TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION get_system_config(TEXT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION refresh_analytics_views() TO authenticated; 