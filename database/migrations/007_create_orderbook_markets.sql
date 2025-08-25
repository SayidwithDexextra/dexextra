-- =============================================
-- Migration: 007_create_orderbook_markets.sql
-- Create OrderBook DEX Markets system tables
-- =============================================

-- 1. CREATE ORDERBOOK MARKETS TABLE
CREATE TABLE IF NOT EXISTS orderbook_markets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Step 1: Market Information
  metric_id VARCHAR(100) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category VARCHAR(50) NOT NULL,
  
  -- Step 2: Trading Configuration
  decimals INTEGER NOT NULL CHECK (decimals >= 1 AND decimals <= 18),
  minimum_order_size NUMERIC(20,8) NOT NULL CHECK (minimum_order_size > 0),
  tick_size NUMERIC(20,8) NOT NULL DEFAULT 0.01 CHECK (tick_size > 0),
  requires_kyc BOOLEAN NOT NULL DEFAULT false,
  
  -- Step 3: Settlement Configuration
  settlement_date TIMESTAMPTZ NOT NULL,
  trading_end_date TIMESTAMPTZ NOT NULL,
  data_request_window_seconds INTEGER NOT NULL CHECK (data_request_window_seconds > 0),
  auto_settle BOOLEAN NOT NULL DEFAULT true,
  oracle_provider VARCHAR(42) NOT NULL,
  
  -- Step 3: Initial Order Configuration (stored as JSONB for flexibility)
  initial_order JSONB,
  
  -- Step 4: Market Images (URLs to storage bucket)
  banner_image_url TEXT,
  icon_image_url TEXT,
  supporting_photo_urls TEXT[] DEFAULT ARRAY[]::TEXT[],
  
  -- Step 5: Advanced Settings
  creation_fee NUMERIC(20,8) NOT NULL CHECK (creation_fee >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  
  -- Smart Contract Addresses (populated after deployment)
  market_address VARCHAR(42), -- OrderBook contract address
  factory_address VARCHAR(42), -- MetricsMarketFactory contract address
  central_vault_address VARCHAR(42), -- CentralVault contract address
  order_router_address VARCHAR(42), -- OrderRouter contract address
  uma_oracle_manager_address VARCHAR(42), -- UMA Oracle Manager contract address
  
  -- Blockchain Information
  chain_id INTEGER NOT NULL,
  deployment_transaction_hash VARCHAR(66), -- Transaction hash of market creation
  deployment_block_number BIGINT,
  deployment_gas_used BIGINT,
  
  -- Market Status and Analytics
  market_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
    market_status IN ('PENDING', 'DEPLOYING', 'ACTIVE', 'TRADING_ENDED', 'SETTLEMENT_REQUESTED', 'SETTLED', 'EXPIRED', 'PAUSED', 'ERROR')
  ),
  total_volume NUMERIC(30,8) DEFAULT 0,
  total_trades INTEGER DEFAULT 0,
  open_interest_long NUMERIC(30,8) DEFAULT 0,
  open_interest_short NUMERIC(30,8) DEFAULT 0,
  last_trade_price NUMERIC(20,8),
  settlement_value NUMERIC(20,8), -- Final settlement value
  settlement_timestamp TIMESTAMPTZ, -- When market was settled
  
  -- User Information
  creator_wallet_address VARCHAR(42) NOT NULL,
  creator_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  
  -- AI Metric Resolution Link (if used during creation)
  metric_resolution_id UUID, -- Reference to metric_oracle_resolutions(id)
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deployed_at TIMESTAMPTZ, -- When smart contracts were deployed
  
  -- Constraints
  CONSTRAINT check_metric_id_format CHECK (
    metric_id ~* '^[A-Z0-9_]{3,100}$'
  ),
  CONSTRAINT check_oracle_provider_format CHECK (
    oracle_provider ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_creator_wallet_format CHECK (
    creator_wallet_address ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_settlement_dates CHECK (
    trading_end_date <= settlement_date
  ),
  CONSTRAINT check_future_dates CHECK (
    settlement_date > NOW() OR market_status != 'PENDING'
  ),
  CONSTRAINT check_contract_addresses CHECK (
    (market_status = 'PENDING' AND market_address IS NULL) OR
    (market_status != 'PENDING' AND market_address IS NOT NULL)
  ),
  CONSTRAINT check_deployment_data CHECK (
    (market_status IN ('PENDING', 'DEPLOYING', 'ERROR') AND deployed_at IS NULL) OR
    (market_status NOT IN ('PENDING', 'DEPLOYING', 'ERROR') AND deployed_at IS NOT NULL)
  ),
  CONSTRAINT check_settlement_data CHECK (
    (market_status != 'SETTLED' AND settlement_value IS NULL AND settlement_timestamp IS NULL) OR
    (market_status = 'SETTLED' AND settlement_value IS NOT NULL AND settlement_timestamp IS NOT NULL)
  )
);

-- 2. CREATE MARKET ORDERS TABLE (for tracking initial and user orders)
CREATE TABLE IF NOT EXISTS market_orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Order Identification
  order_id BIGINT NOT NULL, -- On-chain order ID
  market_id UUID NOT NULL REFERENCES orderbook_markets(id) ON DELETE CASCADE,
  
  -- Order Details
  trader_wallet_address VARCHAR(42) NOT NULL,
  trader_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  order_type VARCHAR(20) NOT NULL CHECK (
    order_type IN ('MARKET', 'LIMIT', 'STOP_LOSS', 'TAKE_PROFIT', 'STOP_LIMIT', 'ICEBERG', 'FILL_OR_KILL', 'IMMEDIATE_OR_CANCEL', 'ALL_OR_NONE')
  ),
  side VARCHAR(10) NOT NULL CHECK (side IN ('BUY', 'SELL')),
  quantity NUMERIC(30,8) NOT NULL CHECK (quantity > 0),
  price NUMERIC(20,8), -- NULL for market orders
  filled_quantity NUMERIC(30,8) NOT NULL DEFAULT 0,
  
  -- Order Status and Timing
  order_status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (
    order_status IN ('PENDING', 'PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXPIRED', 'REJECTED')
  ),
  time_in_force VARCHAR(10) NOT NULL DEFAULT 'GTC' CHECK (
    time_in_force IN ('GTC', 'IOC', 'FOK', 'GTD')
  ),
  expiry_time TIMESTAMPTZ,
  
  -- Trading Specifics
  stop_price NUMERIC(20,8), -- For stop orders
  iceberg_quantity NUMERIC(30,8), -- For iceberg orders
  post_only BOOLEAN DEFAULT false,
  is_initial_order BOOLEAN DEFAULT false,
  
  -- Transaction Information
  creation_transaction_hash VARCHAR(66),
  creation_block_number BIGINT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  -- Constraints
  CONSTRAINT check_trader_wallet_format CHECK (
    trader_wallet_address ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_filled_quantity CHECK (
    filled_quantity <= quantity
  ),
  CONSTRAINT check_gtd_expiry CHECK (
    (time_in_force != 'GTD') OR (time_in_force = 'GTD' AND expiry_time IS NOT NULL)
  ),
  CONSTRAINT check_stop_orders CHECK (
    (order_type NOT IN ('STOP_LOSS', 'TAKE_PROFIT', 'STOP_LIMIT')) OR 
    (order_type IN ('STOP_LOSS', 'TAKE_PROFIT', 'STOP_LIMIT') AND stop_price IS NOT NULL)
  ),
  CONSTRAINT check_iceberg_orders CHECK (
    (order_type != 'ICEBERG') OR 
    (order_type = 'ICEBERG' AND iceberg_quantity IS NOT NULL AND iceberg_quantity < quantity)
  )
);

-- 3. CREATE MARKET POSITIONS TABLE (for tracking user positions)
CREATE TABLE IF NOT EXISTS market_positions (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  
  -- Position Identification
  position_id BIGINT NOT NULL, -- On-chain position ID
  market_id UUID NOT NULL REFERENCES orderbook_markets(id) ON DELETE CASCADE,
  
  -- Position Details
  trader_wallet_address VARCHAR(42) NOT NULL,
  trader_user_id UUID REFERENCES user_profiles(id) ON DELETE SET NULL,
  is_long BOOLEAN NOT NULL,
  quantity NUMERIC(30,8) NOT NULL CHECK (quantity > 0),
  entry_price NUMERIC(20,8) NOT NULL CHECK (entry_price > 0),
  collateral NUMERIC(30,8) NOT NULL CHECK (collateral > 0),
  
  -- Position Status
  is_settled BOOLEAN NOT NULL DEFAULT false,
  settlement_payout NUMERIC(30,8),
  settlement_pnl NUMERIC(30,8), -- Can be negative
  
  -- Transaction Information
  creation_transaction_hash VARCHAR(66),
  creation_block_number BIGINT,
  settlement_transaction_hash VARCHAR(66),
  settlement_block_number BIGINT,
  
  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  settled_at TIMESTAMPTZ,
  
  -- Constraints
  CONSTRAINT check_trader_wallet_format_positions CHECK (
    trader_wallet_address ~* '^0x[a-fA-F0-9]{40}$'
  ),
  CONSTRAINT check_settlement_consistency CHECK (
    (NOT is_settled AND settlement_payout IS NULL AND settlement_pnl IS NULL AND settled_at IS NULL) OR
    (is_settled AND settlement_payout IS NOT NULL AND settlement_pnl IS NOT NULL AND settled_at IS NOT NULL)
  ),
  CONSTRAINT unique_position_per_market UNIQUE (market_id, position_id)
);

-- 4. CREATE INDEXES FOR PERFORMANCE

-- Orderbook Markets Indexes
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_metric_id ON orderbook_markets(metric_id);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_creator ON orderbook_markets(creator_wallet_address);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_category ON orderbook_markets(category);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_status ON orderbook_markets(market_status);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_chain ON orderbook_markets(chain_id);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_active ON orderbook_markets(is_active);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_settlement_date ON orderbook_markets(settlement_date);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_created ON orderbook_markets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_volume ON orderbook_markets(total_volume DESC);
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_market_address ON orderbook_markets(market_address);

-- Full-text search index
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_text_search ON orderbook_markets 
USING GIN (to_tsvector('english', metric_id || ' ' || description));

-- JSONB index for initial_order
CREATE INDEX IF NOT EXISTS idx_orderbook_markets_initial_order_gin ON orderbook_markets 
USING GIN (initial_order);

-- Market Orders Indexes
CREATE INDEX IF NOT EXISTS idx_market_orders_market_id ON market_orders(market_id);
CREATE INDEX IF NOT EXISTS idx_market_orders_trader ON market_orders(trader_wallet_address);
CREATE INDEX IF NOT EXISTS idx_market_orders_status ON market_orders(order_status);
CREATE INDEX IF NOT EXISTS idx_market_orders_side ON market_orders(side);
CREATE INDEX IF NOT EXISTS idx_market_orders_initial ON market_orders(is_initial_order);
CREATE INDEX IF NOT EXISTS idx_market_orders_created ON market_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_orders_order_id ON market_orders(order_id);

-- Market Positions Indexes
CREATE INDEX IF NOT EXISTS idx_market_positions_market_id ON market_positions(market_id);
CREATE INDEX IF NOT EXISTS idx_market_positions_trader ON market_positions(trader_wallet_address);
CREATE INDEX IF NOT EXISTS idx_market_positions_is_long ON market_positions(is_long);
CREATE INDEX IF NOT EXISTS idx_market_positions_settled ON market_positions(is_settled);
CREATE INDEX IF NOT EXISTS idx_market_positions_created ON market_positions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_positions_position_id ON market_positions(position_id);

-- 5. CREATE UPDATED_AT TRIGGERS

-- Create trigger for orderbook_markets
CREATE TRIGGER update_orderbook_markets_updated_at 
  BEFORE UPDATE ON orderbook_markets 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for market_orders
CREATE TRIGGER update_market_orders_updated_at 
  BEFORE UPDATE ON market_orders 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Create trigger for market_positions
CREATE TRIGGER update_market_positions_updated_at 
  BEFORE UPDATE ON market_positions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 6. CREATE HELPFUL VIEWS

-- Active markets with basic info
CREATE OR REPLACE VIEW active_orderbook_markets AS
SELECT 
  id,
  metric_id,
  description,
  category,
  market_status,
  settlement_date,
  trading_end_date,
  total_volume,
  total_trades,
  last_trade_price,
  creator_wallet_address,
  market_address,
  created_at,
  deployed_at
FROM orderbook_markets
WHERE is_active = true AND market_status NOT IN ('ERROR', 'EXPIRED')
ORDER BY created_at DESC;

-- Market summary with statistics
CREATE OR REPLACE VIEW market_summary AS
SELECT 
  om.id,
  om.metric_id,
  om.description,
  om.category,
  om.market_status,
  om.settlement_date,
  om.total_volume,
  om.total_trades,
  om.open_interest_long,
  om.open_interest_short,
  om.last_trade_price,
  COUNT(DISTINCT mo.trader_wallet_address) as unique_traders,
  COUNT(mp.id) as total_positions,
  SUM(CASE WHEN mp.is_settled THEN 1 ELSE 0 END) as settled_positions,
  om.created_at
FROM orderbook_markets om
LEFT JOIN market_orders mo ON om.id = mo.market_id
LEFT JOIN market_positions mp ON om.id = mp.market_id
WHERE om.is_active = true
GROUP BY om.id, om.metric_id, om.description, om.category, om.market_status, 
         om.settlement_date, om.total_volume, om.total_trades, om.open_interest_long,
         om.open_interest_short, om.last_trade_price, om.created_at
ORDER BY om.created_at DESC;

-- User trading activity
CREATE OR REPLACE VIEW user_trading_activity AS
SELECT 
  trader_wallet_address,
  COUNT(DISTINCT market_id) as markets_traded,
  COUNT(*) as total_orders,
  SUM(CASE WHEN order_status = 'FILLED' THEN 1 ELSE 0 END) as filled_orders,
  SUM(CASE WHEN order_status = 'FILLED' THEN filled_quantity * COALESCE(price, 0) ELSE 0 END) as total_volume_traded,
  MAX(created_at) as last_trade_date,
  MIN(created_at) as first_trade_date
FROM market_orders
GROUP BY trader_wallet_address;

-- 7. ENABLE ROW LEVEL SECURITY

ALTER TABLE orderbook_markets ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE market_positions ENABLE ROW LEVEL SECURITY;

-- 8. CREATE RLS POLICIES

-- Orderbook Markets Policies
CREATE POLICY "Public markets are viewable by everyone" 
ON orderbook_markets FOR SELECT 
USING (is_active = true);

CREATE POLICY "Users can insert markets they create" 
ON orderbook_markets FOR INSERT 
WITH CHECK (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
);

CREATE POLICY "Users can update their own markets" 
ON orderbook_markets FOR UPDATE 
USING (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
)
WITH CHECK (
  auth.uid()::text = creator_wallet_address OR 
  auth.role() = 'service_role'
);

-- Market Orders Policies
CREATE POLICY "Orders are viewable by everyone" 
ON market_orders FOR SELECT 
USING (true);

CREATE POLICY "Users can insert their own orders" 
ON market_orders FOR INSERT 
WITH CHECK (
  auth.uid()::text = trader_wallet_address OR 
  auth.role() = 'service_role'
);

CREATE POLICY "Users can update their own orders" 
ON market_orders FOR UPDATE 
USING (
  auth.uid()::text = trader_wallet_address OR 
  auth.role() = 'service_role'
)
WITH CHECK (
  auth.uid()::text = trader_wallet_address OR 
  auth.role() = 'service_role'
);

-- Market Positions Policies
CREATE POLICY "Positions are viewable by everyone" 
ON market_positions FOR SELECT 
USING (true);

CREATE POLICY "Service role can manage positions" 
ON market_positions FOR ALL 
USING (auth.role() = 'service_role')
WITH CHECK (auth.role() = 'service_role');

-- 9. CREATE FUNCTIONS FOR COMMON OPERATIONS

-- Function to create a new market
CREATE OR REPLACE FUNCTION create_orderbook_market(
  p_metric_id VARCHAR(100),
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
  p_creation_fee NUMERIC,
  p_chain_id INTEGER,
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
  INSERT INTO orderbook_markets (
    metric_id,
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
    creation_fee,
    chain_id,
    creator_wallet_address,
    creator_user_id
  ) VALUES (
    p_metric_id,
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
    p_creation_fee,
    p_chain_id,
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
  p_uma_oracle_manager_address VARCHAR(42),
  p_transaction_hash VARCHAR(66),
  p_block_number BIGINT,
  p_gas_used BIGINT
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE orderbook_markets SET
    market_address = p_market_address,
    factory_address = p_factory_address,
    central_vault_address = p_central_vault_address,
    order_router_address = p_order_router_address,
    uma_oracle_manager_address = p_uma_oracle_manager_address,
    deployment_transaction_hash = p_transaction_hash,
    deployment_block_number = p_block_number,
    deployment_gas_used = p_gas_used,
    deployed_at = NOW(),
    market_status = 'ACTIVE'
  WHERE id = p_market_id;
  
  RETURN FOUND;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- Function to search markets
CREATE OR REPLACE FUNCTION search_orderbook_markets(
  search_term TEXT,
  p_category VARCHAR(50) DEFAULT NULL,
  p_status VARCHAR(20) DEFAULT NULL,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  metric_id VARCHAR(100),
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
    om.id,
    om.metric_id,
    om.description,
    om.category,
    om.market_status,
    om.total_volume,
    om.total_trades,
    om.last_trade_price,
    om.settlement_date,
    om.created_at
  FROM orderbook_markets om
  WHERE 
    om.is_active = true AND
    (p_category IS NULL OR om.category = p_category) AND
    (p_status IS NULL OR om.market_status = p_status) AND
    (
      search_term IS NULL OR
      search_term = '' OR
      om.metric_id ILIKE '%' || search_term || '%' OR
      om.description ILIKE '%' || search_term || '%' OR
      to_tsvector('english', om.metric_id || ' ' || om.description) @@ plainto_tsquery('english', search_term)
    )
  ORDER BY 
    CASE 
      WHEN om.metric_id ILIKE search_term THEN 1
      WHEN om.metric_id ILIKE search_term || '%' THEN 2
      WHEN om.description ILIKE '%' || search_term || '%' THEN 3
      ELSE 4
    END,
    om.total_volume DESC,
    om.created_at DESC
  LIMIT p_limit;
END;
$$ language 'plpgsql' SECURITY DEFINER;

-- 10. GRANT PERMISSIONS

GRANT SELECT ON orderbook_markets TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON orderbook_markets TO authenticated;
GRANT SELECT ON market_orders TO authenticated, anon;
GRANT SELECT, INSERT, UPDATE ON market_orders TO authenticated;
GRANT SELECT ON market_positions TO authenticated, anon;
GRANT ALL ON market_positions TO service_role;

GRANT SELECT ON active_orderbook_markets TO authenticated, anon;
GRANT SELECT ON market_summary TO authenticated, anon;
GRANT SELECT ON user_trading_activity TO authenticated, anon;

GRANT EXECUTE ON FUNCTION create_orderbook_market TO authenticated;
GRANT EXECUTE ON FUNCTION update_market_deployment TO service_role;
GRANT EXECUTE ON FUNCTION search_orderbook_markets TO authenticated, anon;

-- 11. ADD FOREIGN KEY CONSTRAINTS (after table creation to avoid dependency issues)

-- Add foreign key constraint for metric resolution if the table exists
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'metric_oracle_resolutions') THEN
    ALTER TABLE orderbook_markets 
    ADD CONSTRAINT fk_orderbook_markets_metric_resolution 
    FOREIGN KEY (metric_resolution_id) 
    REFERENCES metric_oracle_resolutions(id) 
    ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore if constraint already exists or table doesn't exist
    NULL;
END $$;

-- 12. ADD COMMENTS FOR DOCUMENTATION

COMMENT ON TABLE orderbook_markets IS 'OrderBook DEX markets created through MarketWizard';
COMMENT ON TABLE market_orders IS 'Orders placed in orderbook markets';
COMMENT ON TABLE market_positions IS 'User positions in orderbook markets';

COMMENT ON COLUMN orderbook_markets.metric_id IS 'Unique identifier matching the on-chain metric ID';
COMMENT ON COLUMN orderbook_markets.tick_size IS 'Fixed at 0.01 for all markets';
COMMENT ON COLUMN orderbook_markets.initial_order IS 'Initial order configuration from Step 3 stored as JSONB';
COMMENT ON COLUMN orderbook_markets.market_address IS 'Deployed OrderBook contract address';
COMMENT ON COLUMN orderbook_markets.market_status IS 'Current lifecycle status of the market';

COMMENT ON FUNCTION create_orderbook_market IS 'Creates a new orderbook market from MarketWizard data';
COMMENT ON FUNCTION update_market_deployment IS 'Updates market with contract addresses after deployment';
COMMENT ON FUNCTION search_orderbook_markets IS 'Searches markets by text, category, and status';
