# Market Creation Wizard

A comprehensive, step-by-step wizard for creating orderbook-based markets for custom real-world metrics using the orderbook-dex smart contract system with UMA Oracle integration.

## Overview

This wizard replaces the previous VAMM-based market creation system and provides a streamlined interface for deploying markets on the orderbook DEX infrastructure. It supports custom metrics trading with settlement via UMA's Optimistic Oracle V3.

## Features

- **5-Step Process**: Guided workflow for market creation
- **Orderbook DEX Integration**: Full support for orderbook-dex smart contracts
- **UMA Oracle Integration**: Settlement via UMA Optimistic Oracle V3
- **Real-time Validation**: Form validation on each step
- **Clean Design**: Follows the minimal, professional design system
- **Fixed Footer Navigation**: Non-intrusive step progress at bottom of screen
- **Database Integration**: Saves market data for discoverability
- **Type Safety**: Full TypeScript support

## Smart Contract Integration

### Supported Contracts
- **MetricsMarketFactory**: Creates and manages custom metric markets
- **CentralVault**: Secure asset custody and management
- **OrderRouter**: Order routing and P&L tracking
- **UMAOracleManager**: UMA Optimistic Oracle V3 integration
- **OrderBook**: Order matching and execution for specific metrics

### Key Features
- **Settlement-based Markets**: Markets settle at specific dates with real-world data
- **UMA Oracle Resolution**: Decentralized data verification and dispute resolution
- **Initial Order Placement**: Bootstrap liquidity with optional initial orders
- **Time-based Trading**: Markets with defined trading periods and settlement dates

## Components Structure

```
src/components/MarketWizard/
├── MarketWizard.tsx                # Main wizard orchestrator  
├── FixedStepFooter.tsx            # Fixed bottom step navigation
├── types.ts                       # TypeScript definitions for orderbook-dex
├── validation.ts                  # Form validation logic
├── MarketWizard.module.css       # Styling with fixed footer support
├── steps/
│   ├── Step1MarketInfo.tsx        # Metric ID, description, category
│   ├── Step2TradingConfig.tsx     # Order book parameters (decimals, tick size, etc.)
│   ├── Step3SettlementConfig.tsx  # UMA oracle and settlement timeline
│   ├── Step4MarketImages.tsx      # Market image uploads (banner, icon, supporting photos)
│   └── Step5ReviewDeploy.tsx      # Review and MetricsMarketFactory deployment
└── README.md                      # This file
```

## Step-by-Step Breakdown

### Step 1: Market Information
- **Metric ID**: Unique identifier for the metric (e.g., WORLD_POPULATION_2024)
- **Description**: Detailed description of the metric and settlement criteria
- **Category**: Market category for organization and discoverability

### Step 2: Trading Configuration  
- **Decimals**: Decimal precision for the metric (1-18)
- **Minimum Order Size**: Smallest tradeable quantity
- **Tick Size**: Minimum price increment for orders
- **KYC Requirement**: Whether market requires identity verification

### Step 3: Settlement Configuration
- **Trading End Date**: When trading stops in the market
- **Settlement Date**: When the market settles with UMA oracle data
- **Data Request Window**: How long before settlement to request oracle data
- **Oracle Provider**: UMA Oracle Manager contract address
- **Auto Settlement**: Whether to automatically settle when oracle resolves
- **Initial Order** (Optional): Bootstrap liquidity with an initial buy/sell order

### Step 4: Market Images
- **Banner Image**: Hero image for market display
- **Icon Image**: Market icon for lists and navigation
- **Supporting Photos**: Additional images for context

### Step 5: Review & Deploy
- **Configuration Review**: Complete summary of all settings
- **Cost Breakdown**: Creation fees and estimated gas costs
- **Wallet Integration**: Connect wallet for deployment
- **MetricsMarketFactory Deployment**: Deploy market to smart contracts
- **Database Integration**: Save market data for frontend discoverability

## Market Configuration Types

### Settlement Timeline Options
- **1 Week Settlement**: Trading ends 1 day before settlement
- **1 Month Settlement**: Trading ends 3 days before settlement  
- **3 Month Settlement**: Trading ends 1 week before settlement
- **Custom Timeline**: Set your own trading and settlement dates

### Order Configuration
- **Order Sides**: BUY (bidding) or SELL (offering)
- **Time in Force**: GTC, IOC, FOK, or GTD
- **Expiry Times**: For GTD (Good Till Date) orders

### Supported Categories
- Demographics & Population
- Economic Indicators
- Environmental Metrics
- Technology Adoption
- Health & Medical Data
- Social Metrics
- Financial Markets
- Sports & Events
- Weather & Climate
- Custom Metrics

## Usage

### Production Route
```tsx
// Integrated at /create-market
import { MarketWizard } from '@/components/MarketWizard';

<MarketWizard 
  onSuccess={(result) => {
    console.log('Market deployed:', result.marketAddress);
    router.push(`/market/${result.metricId}`);
  }}
  onError={(error) => {
    console.error('Deployment failed:', error);
  }}
/>
```

### Custom Implementation
```tsx
import { MarketWizard, MarketFormData, DeploymentResult } from '@/components/MarketWizard';

const handleSuccess = (result: DeploymentResult) => {
  console.log('New market created:', {
    metricId: result.metricId,
    marketAddress: result.marketAddress,
    transactionHash: result.transactionHash
  });
};

<MarketWizard onSuccess={handleSuccess} />
```

## Environment Configuration

Required environment variables:

```env
# Orderbook DEX Contract Addresses
NEXT_PUBLIC_METRICS_MARKET_FACTORY=0x...
NEXT_PUBLIC_CENTRAL_VAULT=0x...
NEXT_PUBLIC_ORDER_ROUTER=0x...
NEXT_PUBLIC_UMA_ORACLE_MANAGER=0x...

# Database Configuration
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

## Database Schema

The wizard saves market data to support frontend discoverability:

```sql
CREATE TABLE orderbook_markets (
  id SERIAL PRIMARY KEY,
  metric_id VARCHAR(50) NOT NULL UNIQUE,
  description TEXT NOT NULL,
  category TEXT[] NOT NULL,
  
  -- Trading Configuration
  decimals INTEGER NOT NULL,
  minimum_order_size DECIMAL NOT NULL,
  tick_size DECIMAL NOT NULL,
  requires_kyc BOOLEAN DEFAULT false,
  
  -- Settlement Configuration
  settlement_date TIMESTAMP NOT NULL,
  trading_end_date TIMESTAMP NOT NULL,
  data_request_window_hours INTEGER NOT NULL,
  auto_settle BOOLEAN DEFAULT true,
  oracle_provider VARCHAR(42) NOT NULL,
  
  -- Market Images
  banner_image_url TEXT,
  icon_image_url TEXT,
  supporting_photo_urls TEXT[],
  
  -- Deployment Details
  market_address VARCHAR(42) NOT NULL,
  factory_address VARCHAR(42) NOT NULL,
  transaction_hash VARCHAR(66) NOT NULL,
  block_number BIGINT,
  gas_used VARCHAR(20),
  deployment_status VARCHAR(20) DEFAULT 'deployed',
  
  -- Initial Order Configuration
  initial_order_enabled BOOLEAN DEFAULT false,
  initial_order_side VARCHAR(4),
  initial_order_quantity DECIMAL,
  initial_order_price DECIMAL,
  initial_order_time_in_force VARCHAR(3),
  
  -- Metadata
  creation_fee DECIMAL NOT NULL,
  is_active BOOLEAN DEFAULT true,
  user_address VARCHAR(42) NOT NULL,
  network VARCHAR(20) DEFAULT 'hyperliquid',
  chain_id INTEGER DEFAULT 999,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## API Integration

### Market Creation Endpoint
```typescript
POST /api/orderbook-markets

interface CreateMarketRequest {
  metric_id: string;
  description: string;
  category: string[];
  decimals: number;
  minimum_order_size: number;
  tick_size: number;
  requires_kyc: boolean;
  settlement_date: string; // ISO timestamp
  trading_end_date: string; // ISO timestamp
  data_request_window_hours: number;
  auto_settle: boolean;
  oracle_provider: string;
  // ... additional fields
}
```

### Market Discovery
```typescript
GET /api/orderbook-markets
GET /api/orderbook-markets?category=Demographics
GET /api/orderbook-markets?user_address=0x...
```

## Smart Contract Deployment Flow

1. **Configuration Validation**: Validate all market parameters
2. **Image Upload**: Upload market images to Supabase storage
3. **MetricsMarketFactory Call**: Deploy market via factory contract
4. **UMA Oracle Configuration**: Configure metric in UMA Oracle Manager
5. **Initial Order Placement**: Place optional initial order for liquidity
6. **Database Recording**: Save market data for frontend integration
7. **Success Confirmation**: Provide transaction details and market links

## Testing

The wizard includes comprehensive validation for:
- Metric ID format validation (uppercase, alphanumeric + underscores)
- Settlement date logic (trading must end before settlement)
- Order configuration validation (quantities, prices, time in force)
- Image file validation (types, sizes)
- Ethereum address validation for oracle providers
- Collateral sufficiency checks

## Error Handling

- **Smart Contract Errors**: User-friendly messages for common contract failures
- **Validation Errors**: Real-time field validation with helpful guidance
- **Network Errors**: Retry mechanisms and clear error states
- **Image Upload Failures**: Graceful fallbacks and error reporting

## Performance Optimizations

- **Lazy Loading**: Step components loaded as needed
- **Image Optimization**: Automatic compression and format conversion
- **Gas Estimation**: Real-time cost estimates before deployment
- **Batch Operations**: Efficient bulk operations where possible

## Browser Support

- Modern browsers with CSS Grid support
- Mobile responsive (iOS Safari, Android Chrome)
- Tested viewport heights from 320px to 1920px+
- Web3 wallet integration (MetaMask, WalletConnect, etc.)

## Accessibility

- Semantic HTML form structure
- Keyboard navigation support
- Screen reader friendly labels and descriptions
- Focus management between steps
- Error announcements
- ARIA labels for complex interactions

## Migration from VAMM Wizard

The MarketWizard represents a complete replacement of the previous VAMMWizard component:

### Key Changes
- **Contract System**: Moved from VAMM-based to orderbook-dex based markets
- **Settlement Model**: Time-based settlement with UMA oracle integration
- **Market Types**: Custom real-world metrics instead of synthetic assets
- **Trading Mechanism**: Order book matching instead of AMM curves
- **Oracle Integration**: UMA Optimistic Oracle V3 for data verification

### Migration Path
1. Update imports from `VAMMWizard` to `MarketWizard`
2. Update form data types from `VAMMFormData` to `MarketFormData`
3. Update API endpoints from `/api/markets` to `/api/orderbook-markets`
4. Update database schema to support orderbook-specific fields
5. Update contract integration to use MetricsMarketFactory

### Compatibility
- UI/UX remains largely unchanged for smooth user transition
- Same step-by-step workflow with updated content
- Same image upload and wallet integration patterns
- Same validation and error handling approaches
