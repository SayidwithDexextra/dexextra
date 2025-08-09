# DexContractsV2 Limit Order System

A comprehensive limit order system for DexExtra's metric trading platform with Chainlink Automation integration and hybrid fee model.

## 🏗️ Architecture Overview

The limit order system consists of several interconnected smart contracts and frontend components:

### Smart Contracts

1. **MetricLimitOrderManager** - Core limit order management
2. **AutomationFundingManager** - Hybrid Chainlink fee model
3. **MetricLimitOrderKeeper** - Chainlink Automation integration
4. **MetricVAMMRouter** - Unified trading interface

### Key Features

- ✅ **Gasless Orders** - EIP-712 signature support for zero-gas order creation
- ✅ **Automated Execution** - Chainlink Automation for reliable order execution
- ✅ **Hybrid Fee Model** - Users pay in USDC, protocol handles LINK conversion
- ✅ **Multiple Order Types** - LIMIT, MARKET_IF_TOUCHED, STOP_LOSS, TAKE_PROFIT
- ✅ **Batch Operations** - Efficient multiple order management
- ✅ **Real-time Updates** - Event-driven UI updates

## 🚀 Quick Start

### Prerequisites

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local
```

### Environment Variables

```bash
# Contract Addresses
NEXT_PUBLIC_LIMIT_ORDER_MANAGER=0x...
NEXT_PUBLIC_AUTOMATION_FUNDING=0x...
NEXT_PUBLIC_LIMIT_ORDER_KEEPER=0x...
NEXT_PUBLIC_ROUTER=0x...
NEXT_PUBLIC_VAULT=0x...
NEXT_PUBLIC_FACTORY=0x...
NEXT_PUBLIC_USDC=0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174

# Deployment Settings (for scripts)
FACTORY_ADDRESS=0x...
VAULT_ADDRESS=0x...
ROUTER_ADDRESS=0x...
```

### Deploy Contracts

```bash
# Deploy the entire limit order system
npx hardhat run scripts/deployLimitOrderSystem.js --network polygon

# The script will output environment variables for your frontend
```

## 📋 Contract Architecture

### MetricLimitOrderManager

**Core functionality for limit order management**

```solidity
struct LimitOrder {
    bytes32 orderHash;
    address user;
    bytes32 metricId;
    bool isLong;
    uint256 collateralAmount;
    uint256 leverage;
    uint256 triggerPrice;
    uint256 targetValue;
    PositionType positionType;
    OrderType orderType;
    uint256 expiry;
    uint256 maxSlippage;
    uint256 keeperFee;
    bool isActive;
    uint256 createdAt;
    uint256 nonce;
}
```

**Key Functions:**
- `createLimitOrder()` - Create order with gas
- `createLimitOrderWithSignature()` - Gasless order creation
- `cancelLimitOrder()` - Cancel existing order
- `executeLimitOrder()` - Execute order (keepers only)

### AutomationFundingManager

**Manages hybrid Chainlink fee model**

**Features:**
- Collects USDC fees from users
- Converts USDC to LINK via Uniswap V3
- Funds Chainlink Automation upkeeps
- Revenue distribution (70% LINK funding, 30% protocol)

### MetricLimitOrderKeeper

**Chainlink Automation integration**

```solidity
function checkUpkeep(bytes calldata checkData)
    external view returns (bool upkeepNeeded, bytes memory performData)

function performUpkeep(bytes calldata performData) external
```

**Configuration:**
- Max 20 orders per check
- Max 10 orders per execution
- 30-second minimum execution interval
- Gas optimization for batch execution

## 💰 Fee Structure

### User Fees (in USDC)
- **Automation Fee**: $2.00 per order creation
- **Execution Fee**: $3.00 per order execution
- **Trading Fees**: Standard 0.3% on position size

### Revenue Distribution
- **70%** → LINK funding for automation
- **30%** → Protocol revenue

## 🎯 Usage Examples

### Frontend Integration

#### 1. Create Limit Order

```typescript
import { useLimitOrders, CreateLimitOrderParams } from '@/hooks/useLimitOrders';

const limitOrders = useLimitOrders();

const createOrder = async () => {
  const params: CreateLimitOrderParams = {
    metricId: ethers.id('BTC'),
    isLong: true,
    collateralAmount: 100, // $100 USDC
    leverage: 2,
    triggerPrice: 45000,
    targetValue: 0,
    positionType: 'CONTINUOUS',
    orderType: 'LIMIT',
    expiry: Math.floor(Date.now() / 1000) + (24 * 3600), // 24 hours
    maxSlippage: 100 // 1%
  };

  const result = await limitOrders.createLimitOrder(params);
  
  if (result.success) {
    console.log('Order created:', result.orderHash);
  }
};
```

#### 2. Gasless Order Creation

```typescript
const createGaslessOrder = async () => {
  // Sign order
  const signed = await limitOrders.signOrder(params);
  
  if (signed) {
    // Submit via relayer or meta-transaction
    const result = await limitOrders.createLimitOrderWithSignature(
      signed.order, 
      signed.signature
    );
  }
};
```

#### 3. Cancel Order

```typescript
const cancelOrder = async (orderHash: string) => {
  const result = await limitOrders.cancelLimitOrder(
    orderHash, 
    'User cancelled'
  );
  
  if (result.success) {
    console.log('Order cancelled successfully');
  }
};
```

### TradingPanel Integration

The `TradingPanel.tsx` component now supports both market and limit orders:

```typescript
// Set order type
const [orderType, setOrderType] = useState<'market' | 'limit'>('market');

// Limit order specific states
const [triggerPrice, setTriggerPrice] = useState(0);
const [limitOrderType, setLimitOrderType] = useState<'LIMIT' | 'MARKET_IF_TOUCHED'>('LIMIT');
const [orderExpiry, setOrderExpiry] = useState(24);

// UI automatically switches between market and limit order forms
```

## 🔧 Smart Contract Deployment

### Manual Deployment

```bash
# 1. Deploy AutomationFundingManager
npx hardhat run scripts/deploy/AutomationFunding.js

# 2. Deploy MetricLimitOrderManager
npx hardhat run scripts/deploy/LimitOrderManager.js

# 3. Deploy MetricLimitOrderKeeper
npx hardhat run scripts/deploy/LimitOrderKeeper.js

# 4. Configure contracts
npx hardhat run scripts/configure/LimitOrderSystem.js
```

### Automated Deployment

```bash
# Deploy entire system
npx hardhat run scripts/deployLimitOrderSystem.js --network polygon

# Verify contracts
npx hardhat verify --network polygon <CONTRACT_ADDRESS> <CONSTRUCTOR_ARGS>
```

## ⚙️ Chainlink Automation Setup

### 1. Register Upkeep

1. Visit [Chainlink Automation](https://automation.chain.link/)
2. Connect wallet and select Polygon
3. Register new upkeep:
   - **Target Contract**: `MetricLimitOrderKeeper` address
   - **Gas Limit**: 2,000,000
   - **Starting Balance**: 5 LINK minimum
   - **Check Data**: Encoded metric IDs array

### 2. Fund Upkeep

```typescript
// Fund via AutomationFundingManager
await automationFunding.fundUpkeep(ethers.parseEther("20")); // 20 LINK
```

### 3. Monitor Performance

```typescript
// Get keeper stats
const stats = await limitOrderKeeper.getKeeperStats();
console.log('Executions:', stats.executions);
console.log('Orders executed:', stats.ordersExecuted);
console.log('Avg gas per order:', stats.avgGasPerOrder);
```

## 📊 Monitoring & Analytics

### Order Statistics

```typescript
const stats = await limitOrders.getOrderStats();
console.log('Total created:', stats.totalCreated);
console.log('Total executed:', stats.totalExecuted);
console.log('Total cancelled:', stats.totalCancelled);
console.log('Fees collected:', stats.totalFeesCollected);
```

### System Health

```typescript
// Check automation funding status
const fundingInfo = await automationFunding.getUpkeepInfo();
console.log('Upkeep balance:', fundingInfo.balance);
console.log('Needs funding:', fundingInfo.needsFunding);

// Check keeper readiness
const readiness = await limitOrderKeeper.getKeeperReadiness();
console.log('Is ready:', readiness.isReady);
console.log('Status:', readiness.status);
```

## 🔐 Security Considerations

### Smart Contract Security

- **Access Control**: Only authorized keepers can execute orders
- **Reentrancy Protection**: SafeERC20 for all token transfers
- **Signature Validation**: EIP-712 prevents replay attacks
- **Slippage Protection**: User-defined maximum slippage
- **Expiry Validation**: Orders automatically expire

### Frontend Security

- **Input Validation**: Comprehensive form validation
- **Transaction Simulation**: Pre-flight checks before submission
- **Error Handling**: Graceful failure handling
- **User Consent**: Clear fee disclosure

## 🧪 Testing

### Unit Tests

```bash
# Run contract tests
npx hardhat test test/LimitOrderManager.test.js
npx hardhat test test/AutomationFunding.test.js
npx hardhat test test/LimitOrderKeeper.test.js
```

### Integration Tests

```bash
# Test complete order lifecycle
npx hardhat test test/integration/OrderLifecycle.test.js

# Test automation execution
npx hardhat test test/integration/AutomationExecution.test.js
```

### Frontend Tests

```bash
# Test React components
npm run test

# Test limit order hook
npm run test -- useLimitOrders.test.tsx
```

## 🚨 Troubleshooting

### Common Issues

#### 1. Order Not Executing

**Symptoms**: Order created but not executed by automation

**Solutions**:
- Check Chainlink upkeep has sufficient LINK balance
- Verify trigger price conditions are met
- Ensure order hasn't expired
- Check keeper authorization

#### 2. Transaction Failures

**Symptoms**: Transaction reverts during order creation

**Solutions**:
- Verify sufficient USDC balance for fees
- Check USDC approval for LimitOrderManager
- Ensure valid metric ID and trigger price
- Verify expiry is in the future

#### 3. Automation Funding Issues

**Symptoms**: Upkeep running out of LINK

**Solutions**:
- Top up AutomationFundingManager with USDC
- Call `performMaintenance()` to trigger LINK purchase
- Check Uniswap V3 router approval

### Debug Tools

```typescript
// Debug order validation
const validation = limitOrders.validateOrder(orderParams);
console.log('Validation errors:', validation.errors);

// Check executable orders
const executable = await limitOrders.getExecutableOrders(metricId, 10);
console.log('Executable orders:', executable);

// Monitor automation performance
const keeperStats = await limitOrderKeeper.getKeeperStats();
console.log('Performance metrics:', keeperStats);
```

## 📈 Performance Optimization

### Gas Optimization

- **Batch Operations**: Process multiple orders per transaction
- **Storage Optimization**: Efficient struct packing
- **Event Indexing**: Optimized event filtering

### Frontend Optimization

- **React.memo**: Prevent unnecessary re-renders
- **useMemo**: Cache expensive calculations
- **Debounced API calls**: Reduce unnecessary contract calls

## 🔄 Upgrade Path

### Contract Upgrades

The system uses a proxy pattern for upgradeable contracts:

```bash
# Upgrade LimitOrderManager
npx hardhat run scripts/upgrade/LimitOrderManager.js
```

### Frontend Updates

```bash
# Update to latest version
npm install @dexextra/limit-orders@latest

# Migrate existing orders
npm run migrate-orders
```

## 📚 API Reference

### LimitOrderManager Contract

```solidity
// Create order with gas
function createLimitOrder(
    bytes32 metricId,
    bool isLong,
    uint256 collateralAmount,
    uint256 leverage,
    uint256 triggerPrice,
    uint256 targetValue,
    uint8 positionType,
    uint8 orderType,
    uint256 expiry,
    uint256 maxSlippage
) external returns (bytes32 orderHash)

// Create gasless order
function createLimitOrderWithSignature(
    LimitOrder memory order,
    bytes calldata signature
) external returns (bytes32 orderHash)

// Cancel order
function cancelLimitOrder(
    bytes32 orderHash,
    string calldata reason
) external

// Get user orders
function getUserActiveOrders(address user) 
    external view returns (LimitOrder[] memory)
```

### useLimitOrders Hook

```typescript
interface LimitOrderHookReturn {
  // State
  userOrders: LimitOrder[];
  activeOrders: LimitOrder[];
  stats: LimitOrderStats | null;
  isLoading: boolean;
  error: string | null;
  
  // Functions
  createLimitOrder: (params: CreateLimitOrderParams) => Promise<Result>;
  createLimitOrderWithSignature: (order: LimitOrder, sig: string) => Promise<Result>;
  cancelLimitOrder: (hash: string, reason: string) => Promise<Result>;
  signOrder: (params: Partial<LimitOrder>) => Promise<SignedOrder | null>;
  refreshData: () => Promise<void>;
}
```

## 🤝 Contributing

### Development Setup

```bash
git clone https://github.com/dexextra/dexextra
cd dexextra
npm install
npm run dev
```

### Contribution Guidelines

1. **Smart Contracts**: Follow Solidity style guide
2. **Frontend**: Use TypeScript and React best practices
3. **Testing**: Maintain >90% test coverage
4. **Documentation**: Update docs for all changes

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🆘 Support

- **Documentation**: [docs.dexextra.com](https://docs.dexextra.com)
- **Discord**: [discord.gg/dexextra](https://discord.gg/dexextra)
- **GitHub Issues**: [github.com/dexextra/dexextra/issues](https://github.com/dexextra/dexextra/issues)

---

## 🎉 Deployment Checklist

- [ ] Deploy smart contracts to Polygon
- [ ] Verify contracts on Polygonscan
- [ ] Register Chainlink Automation upkeep
- [ ] Fund AutomationFundingManager with USDC
- [ ] Update frontend environment variables
- [ ] Test order creation and execution
- [ ] Monitor system performance
- [ ] Set up alerting for low LINK balance

**🚀 Your limit order system is now ready for production!** 