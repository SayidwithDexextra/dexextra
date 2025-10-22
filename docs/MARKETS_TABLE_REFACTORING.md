# Markets Table Refactoring

This document outlines the refactoring of the market data storage in our application to improve data organization, eliminate redundancy, and enhance type safety.

## Overview

Previously, our application used two separate tables for market data:
- `orderbook_markets`: Primary table for storing market details
- `orderbook_markets_resolved`: Additional table with redundant data and some extra contract addresses

The refactoring introduces a new unified `markets` table with UUID primary keys and proper data organization, eliminating the redundancy between the two tables.

## Database Changes

### New Markets Table

The new `markets` table has the following improvements:

1. **UUID Primary Keys**: Uses UUIDs as primary keys instead of text-based identifiers
2. **Market Identifier Field**: Replaces `metric_id` with `market_identifier` as a human-readable identifier
3. **Improved Structure**: Better organization of related fields
4. **Proper Symbol Field**: Dedicated field for trading symbols (e.g., "BTC-USD")
5. **Comprehensive Contract Addresses**: All contract addresses in one table
6. **Network Information**: Explicit network name field
7. **Market Configuration**: Flexible JSONB field for additional configuration
8. **Consistent Constraints**: Improved check constraints
9. **Better Indexing**: More efficient index structure

### Compatibility Views

Two compatibility views are provided for a smooth transition:
- `orderbook_markets_view`: Compatible with the old `orderbook_markets` table
- `orderbook_markets_resolved`: Compatible with the old `orderbook_markets_resolved` table

These views allow existing code to continue functioning while you transition to the new table structure.

## Helper Functions

The refactoring includes several SQL helper functions for common operations:

- `create_market`: Function to create new markets
- `update_market_deployment_v2`: Function to update market deployment information
- `search_markets`: Function to search markets by various criteria
- `get_market_by_identifier_or_address`: Function to resolve a market by identifier or address

## Migration Process

The data migration process:

1. Create the new `markets` table
2. Migrate data from `orderbook_markets` to `markets`
3. Update foreign keys in `market_orders` and `market_positions` tables
4. Create compatibility views for a smooth transition
5. Update application code to use the new table

## Application Code Changes

### Updated Files

1. `src/lib/marketService.ts`: New service for interacting with the markets table
2. `src/lib/contractConfig.ts`: Updated to use the new market service
3. `src/lib/env.ts`: Updated environment variable definitions

### Code Update Process

Follow these steps to update your code:

1. Use the `marketService` instead of direct database queries
2. Replace `metric_id` references with `market_identifier`
3. Update API routes to use the new table
4. Update services and webhook processors

### Example: Before and After

Before:
```typescript
const { data: market } = await supabase
  .from('orderbook_markets')
  .select('*')
  .eq('metric_id', metricId)
  .single();
```

After:
```typescript
import marketService from '../lib/marketService';
const market = await marketService.getMarketByIdentifier(marketIdentifier);
```

## Environment Variables

New environment variables for market defaults:

```
# Market Defaults
DEFAULT_MARKET_DECIMALS=8
DEFAULT_TICK_SIZE=0.01
DEFAULT_MINIMUM_ORDER_SIZE=0.1
DEFAULT_DATA_REQUEST_WINDOW_SECONDS=3600  # 1 hour
```

## Deployment Notes

To deploy this change:

1. Apply the migration scripts in the following order:
   - `009_create_markets_table.sql`

2. If needed, run a rollback script to revert changes:
   ```sql
   DROP TABLE IF EXISTS markets CASCADE;
   ```

3. Monitor for any issues after deployment

