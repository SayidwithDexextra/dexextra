# DexContractsV2 Database Deployment Guide (Optimized Schema)

This guide covers the **optimized database deployment** for DexContractsV2 that **maximizes efficiency** while minimizing table creation.

## 📋 Overview

The **Optimized DexV2 Schema** achieves maximum efficiency with minimal table creation:
- **Enhanced user_profiles**: JSONB portfolio data + key indexed fields
- **Enhanced contract_events**: JSONB market/trading data + key indexed fields  
- **Only 2 New Tables**: `positions` (essential) + `orders` (essential)
- **No Separate Tables**: Markets derived from events, config stored as events
- **Materialized Views**: High-performance analytics without table overhead
- **JSONB Flexibility**: Schema changes without migrations

## 🎯 Maximum Efficiency Benefits

### ✅ **Minimal Table Creation**
- **Just 2 new tables** instead of 5+ separate tables
- **JSONB flexibility** for version-specific data without schema changes
- **Derived views** for market data instead of static tables
- **Configuration as data** in existing events table

### ✅ **Performance Optimized**
- **GIN indexes** on JSONB for fast flexible queries
- **Materialized views** for analytics (faster than regular views)
- **Essential indexes only** on frequently queried fields
- **No table joins** for configuration data

### ✅ **Future-Proof Design**
- **JSONB metadata** accommodates any future fields
- **Version-aware** without schema changes
- **Easy V3/V4 addition** with same pattern
- **Zero downtime** field additions via JSONB

## 🚀 Quick Deployment

### 1. Run Optimized Database Migration

```bash
# Connect to your Supabase/PostgreSQL database
psql -h your-db-host -U your-username -d your-database

# Run base migrations (if not already done)
\i database/migrations/001_create_event_tables.sql
\i database/migrations/002_create_user_profiles.sql
\i database/migrations/002_create_webhook_configs.sql
\i database/migrations/003_create_storage_bucket.sql

# Run the OPTIMIZED migration
\i database/migrations/004_create_optimized_trading_tables.sql
```

### 2. Verify Optimized Schema

```sql
-- Check enhanced user_profiles (should have portfolio_data JSONB)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'user_profiles' 
  AND column_name IN ('portfolio_data', 'total_collateral', 'health_factor')
ORDER BY column_name;

-- Check enhanced contract_events (should have market_data, trading_data JSONB)
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'contract_events' 
  AND column_name IN ('market_data', 'trading_data', 'contract_version')
ORDER BY column_name;

-- Check new essential tables (only 2!)
SELECT table_name 
FROM information_schema.tables 
WHERE table_name IN ('positions', 'orders')
  AND table_schema = 'public';

-- Check materialized views
SELECT schemaname, matviewname 
FROM pg_matviews 
WHERE matviewname IN ('portfolio_dashboard', 'system_health');
```

## 📊 Optimized Database Schema

### Enhanced Existing Tables

#### **user_profiles** (Enhanced with JSONB)
```sql
-- Core indexed fields for performance
total_collateral NUMERIC(36,6)
total_unrealized_pnl NUMERIC(36,18) 
health_factor NUMERIC(10,4)
last_activity TIMESTAMPTZ
trading_tier VARCHAR(20)

-- Flexible JSONB for all other portfolio data
portfolio_data JSONB DEFAULT '{}'
-- Contains: total_positions, active_positions, total_volume, win_rate, etc.
```

**Usage Example:**
```sql
-- Update portfolio with flexible data
SELECT update_user_portfolio_data('0x...', jsonb_build_object(
  'total_positions', 5,
  'active_positions', 3,
  'total_volume', '10000.50',
  'win_rate', 0.65,
  'active_markets', 2
));

-- Query portfolio data
SELECT 
  username,
  total_collateral,
  portfolio_data->>'total_positions' as positions,
  portfolio_data->>'win_rate' as win_rate
FROM user_profiles 
WHERE wallet_address = '0x...';
```

#### **contract_events** (Enhanced with JSONB)
```sql
-- Core indexed fields for performance  
contract_version VARCHAR(10) -- 'v1' or 'v2'
position_id BIGINT
order_id BIGINT
price NUMERIC(36,18)
leverage BIGINT

-- Flexible JSONB for market and trading data
market_data JSONB DEFAULT '{}'
trading_data JSONB DEFAULT '{}'
```

**Usage Examples:**
```sql
-- Store market deployment event
INSERT INTO contract_events (..., market_data) VALUES (..., 
  jsonb_build_object(
    'market_identifier', 'btc-price',
    'name', 'Bitcoin Price',
    'category', 'Financial',
    'max_leverage', 50,
    'trading_fee', 30
  )
);

-- Query markets from events  
SELECT DISTINCT
  (market_data->>'market_identifier') as market_id,
  (market_data->>'name') as name,
  contract_address
FROM contract_events 
WHERE event_type LIKE '%Deploy%' AND market_data IS NOT NULL;
```

### Essential New Tables (Only 2!)

#### **positions** Table
```sql
-- Core position data (essential)
position_id BIGINT
user_address VARCHAR(42)
contract_address VARCHAR(42)  
contract_version VARCHAR(10)
size NUMERIC(36,18)
entry_price NUMERIC(36,18)
leverage BIGINT
collateral_amount NUMERIC(36,6)

-- Flexible metadata for version-specific fields
position_metadata JSONB DEFAULT '{}'
-- V1: entry_funding_index, last_funding_payment
-- V2: position_type, target_value, settlement_price
```

#### **orders** Table  
```sql
-- Core order data (essential)
order_id BIGINT
user_address VARCHAR(42)
contract_address VARCHAR(42)
contract_version VARCHAR(10)
order_type SMALLINT
collateral_amount NUMERIC(36,6)
trigger_price NUMERIC(36,18)
status SMALLINT

-- Flexible metadata for version-specific fields
order_metadata JSONB DEFAULT '{}'
-- V1: basic market/limit orders
-- V2: keeper_fee, automation_fee, executed_by, max_slippage
```

### No Separate Tables Needed

#### **Markets** → Derived from `contract_events`
```sql
-- Markets view (no table overhead)
CREATE VIEW markets_view AS
SELECT DISTINCT
  (market_data->>'market_identifier') as market_identifier,
  contract_address,
  contract_version,
  (market_data->>'name') as name,
  (market_data->>'symbol') as symbol,
  -- Real-time stats calculated
  (SELECT COUNT(*) FROM positions p WHERE p.contract_address = ce.contract_address) as total_positions
FROM contract_events ce
WHERE event_type LIKE '%Deploy%' AND market_data IS NOT NULL;
```

#### **System Config** → Stored as special events
```sql
-- Get system configuration (no table needed)
SELECT get_system_config('v2'); -- Returns JSONB config

-- Example result:
{
  "network": "polygon",
  "metric_vamm_factory_address": "0x...",
  "centralized_vault_address": "0x...",
  "usdc_address": "0x...",
  "max_leverage": 50
}
```

### High-Performance Analytics

#### **Materialized Views** (Better than tables)
```sql
-- Portfolio dashboard (materialized for speed)
SELECT * FROM portfolio_dashboard 
WHERE user_address = '0x...' AND health_factor < 1.2;

-- System health (materialized for speed)
SELECT * FROM system_health 
WHERE network = 'polygon';

-- Refresh views when needed
SELECT refresh_analytics_views();
```

## 🔧 Integration Benefits

### Ultra-Efficient Queries

**Portfolio Data (Single Query):**
```sql
-- Get complete user portfolio in one query
SELECT 
  username,
  total_collateral,
  health_factor,
  portfolio_data->>'total_positions' as positions,
  portfolio_data->>'win_rate' as win_rate,
  v1_positions,
  v2_positions,
  active_orders
FROM portfolio_dashboard 
WHERE user_address = '0x...';
```

**Market Data (No Table Joins):**
```sql
-- Get market info from events (no separate market table)
SELECT 
  (market_data->>'name') as name,
  (market_data->>'symbol') as symbol,
  contract_address,
  contract_version
FROM contract_events 
WHERE event_type LIKE '%Deploy%' 
  AND market_data->>'category' = 'Financial';
```

**Configuration (Function Call):**
```sql
-- Get V2 configuration instantly
SELECT get_system_config('v2')->>'centralized_vault_address' as vault;
```

### Frontend Simplification

**Before (Multiple Tables):**
```typescript
// Had to query multiple tables
const markets = await getMarkets();
const config = await getSystemConfig();
const portfolio = await getPortfolio();
// Complex data combining logic...
```

**After (Optimized Schema):**
```typescript
// Single queries with JSONB flexibility
const portfolio = await supabase
  .from('portfolio_dashboard')
  .select('*')
  .eq('user_address', address)
  .single();

const config = await supabase.rpc('get_system_config', { p_version: 'v2' });

// All data already structured and ready to use
```

## 📈 JSONB Usage Patterns

### Flexible Data Storage

```sql
-- Store any portfolio data without schema changes
UPDATE user_profiles 
SET portfolio_data = portfolio_data || jsonb_build_object(
  'new_metric', 'new_value',
  'custom_field', 123,
  'feature_flag', true
) WHERE wallet_address = '0x...';

-- Query nested JSONB data efficiently
SELECT * FROM user_profiles 
WHERE portfolio_data->>'trading_strategy' = 'aggressive'
  AND (portfolio_data->>'risk_score')::NUMERIC > 80;
```

### Version-Specific Metadata

```sql
-- V1 position metadata
UPDATE positions SET position_metadata = jsonb_build_object(
  'entry_funding_index', '1234567890',
  'last_funding_payment', '100.50'
) WHERE contract_version = 'v1';

-- V2 position metadata  
UPDATE positions SET position_metadata = jsonb_build_object(
  'position_type', 2,
  'target_value', '50000.00',
  'settlement_price', '49500.00'
) WHERE contract_version = 'v2';
```

## 🔍 Performance Monitoring

### Optimized Queries

```sql
-- Fast user lookup (indexed)
SELECT * FROM portfolio_dashboard WHERE user_address = '0x...';

-- Fast JSONB queries (GIN indexed)
SELECT * FROM user_profiles 
WHERE portfolio_data @> '{"trading_tier": "gold"}';

-- Fast position queries (indexed)
SELECT * FROM positions 
WHERE user_address = '0x...' AND is_active = true;
```

### Analytics Performance

```sql
-- System health (materialized - instant results)
SELECT v1_markets, v2_markets, total_tvl, users_at_risk 
FROM system_health;

-- Market stats (derived view - efficient)
SELECT market_identifier, total_positions, total_volume 
FROM markets_view 
WHERE contract_version = 'v2'
ORDER BY total_volume DESC;
```

## 🛠️ Deployment Checklist

- [ ] **Enhanced Tables**: user_profiles and contract_events have JSONB fields
- [ ] **Essential Tables**: Only positions and orders tables created
- [ ] **No Extra Tables**: Markets derived from events, config stored as events
- [ ] **Materialized Views**: portfolio_dashboard and system_health created
- [ ] **JSONB Indexes**: GIN indexes on all JSONB fields for performance
- [ ] **Helper Functions**: update_user_portfolio_data, get_system_config working
- [ ] **Environment Variables**: DexV2 contract addresses configured
- [ ] **System Config**: V1 and V2 configs stored as contract events
- [ ] **API Integration**: Endpoints updated to use optimized schema
- [ ] **Frontend Testing**: JSONB queries working correctly

## 📞 Support

For issues with the optimized schema:
1. **JSONB Queries**: Use `->` for JSON object, `->>` for text extraction
2. **GIN Indexes**: Ensure `@>`, `?`, `?&`, `?|` operators are used for fast JSONB queries
3. **Materialized Views**: Refresh with `SELECT refresh_analytics_views()` as needed
4. **Helper Functions**: Use provided functions for consistent data updates
5. **Configuration**: Use `get_system_config()` function instead of table queries

The optimized schema provides **maximum efficiency** with **minimal table overhead** while maintaining **full functionality** and **future flexibility** through JSONB storage patterns. 🚀 