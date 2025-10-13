# HyperLiquid OrderBook DEX Contract Summary

**Deployment Date**: September 2, 2025  
**Network**: Polygon Mainnet (Chain ID: 137)  
**Deployer Address**: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`  
**Verification Status**: ✅ All contracts verified on Polygonscan  
**Latest Update**: Complete redeploy with scaling fixes deployed and verified on September 2, 2025  

---

## 🏭 Core HyperLiquid Smart Contracts

### 1. **MockUSDC (Test Collateral)**
- **Address**: [`0xA2258Ff3aC4f5c77ca17562238164a0205A5b289`]( mode)
- **Purpose**: Mock USDC token for testing and collateral management
- **Key Features**:
  - Standard ERC-20 implementation with 6 decimal precision
  - Minting functionality for testing purposes
  - Primary collateral token for all trading operations
- **Constructor Arguments**:
  - `admin`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

### 2. **VaultRouter** *(UPDATED)*
- **Address**: [`0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`](https://polygonscan.com/address/0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7#code)
- **Purpose**: Secure asset custody and management for all trading operations
- **Key Features**:
  - Multi-asset support with primary collateral (MockUSDC)
  - Asset allocation and deallocation for trading positions
  - Risk management with withdrawal delays and limits
  - Emergency pause functionality and role-based access control
- **Constructor Arguments**:
  - `collateralToken`: `0xA2258Ff3aC4f5c77ca17562238164a0205A5b289` (MockUSDC)
  - `admin`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

### 3. **OrderBookFactoryMinimal** *(UPDATED)*
- **Address**: [`0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75`](https://polygonscan.com/address/0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75#code)
- **Purpose**: Optimized factory for creating and managing OrderBook instances
- **Key Features**:
  - Gas-efficient market deployment (under 24KB contract limit)
  - Traditional market creation (ETH/USD, BTC/USD, Aluminum V1)
  - Market status management and fee collection
  - Simplified access control using Ownable pattern
- **Constructor Arguments**:
  - `vaultRouter`: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
  - `owner`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

### 4. **TradingRouter** *(UPDATED WITH SCALING FIXES)*
- **Address**: [`0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B`](https://polygonscan.com/address/0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B#code)
- **Purpose**: Unified trading interface and order execution across all markets
- **Key Features**:
  - Advanced order types (Market, Limit, Stop-Loss, Take-Profit)
  - Multi-market order placement and batch operations
  - Portfolio rebalancing and risk management
  - Real-time P&L tracking and position management
- **Constructor Arguments**:
  - `vaultRouter`: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
  - `factory`: `0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75`
  - `admin`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

### 5. **UpgradeManager** *(UPDATED)*
- **Address**: [`0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9`](https://polygonscan.com/address/0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9#code)
- **Purpose**: Contract upgrade management and system administration
- **Key Features**:
  - Batch upgrade functionality for system components
  - Timelock mechanisms for security
  - System health monitoring and checks
  - Role-based upgrade authorization
- **Constructor Arguments**:
  - `vaultRouter`: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
  - `factory`: `0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75`
  - `tradingRouter`: `0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B`
  - `collateralToken`: `0xA2258Ff3aC4f5c77ca17562238164a0205A5b289`
  - `admin`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

### 6. **Aluminum V1 OrderBook** *(UPDATED WITH SCALING FIXES)*
- **Address**: [`0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE`](https://polygonscan.com/address/0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE#code)
- **Purpose**: Dedicated orderbook for Aluminum V1 futures trading
- **Key Features**:
  - Optimized order matching algorithm with Red-Black trees
  - Linked list order management for O(1) operations
  - Cached best bid/ask for O(1) price discovery
  - Comprehensive position and PnL tracking
- **Constructor Arguments**:
  - `marketId`:     `0x0ec5e3d580bc0eed6b9c47dc4f8b142f8b72a1ca1b87e4caa8b3ae2b0fd90b08`
  - `symbol`: "Aluminum V1"
  - `metricId`: "" (empty for traditional markets)
  - `isCustomMetric`: false
  - `vaultRouter`: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
  - `admin`: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`

---

## 🧪 System Architecture

### Contract Interaction Flow
1. **User deposits MockUSDC** → VaultRouter (collateral management)
2. **User places orders** → TradingRouter (unified interface)
3. **Orders route to** → OrderBookFactoryMinimal → Aluminum V1 OrderBook
4. **Order matching** → Optimized matching engine with Red-Black trees
5. **Settlement** → VaultRouter updates positions and collateral
6. **System upgrades** → UpgradeManager handles contract upgrades

### Key Optimizations
- **Contract Size**: OrderBookFactoryMinimal optimized to <24KB
- **Gas Efficiency**: Red-Black tree + Linked list order management
- **Modular Design**: Separable components for maintainability
- **Access Control**: Role-based permissions with granular access

---

## 📊 Critical Smart Contract Events & Topic Hashes

> **For Order Book & Transaction Table Integration**  
> The following events are prioritized for real-time order book display and transaction history.

### 🎯 **Primary Order Book Events** (Aluminum V1 OrderBook Contract)

#### **OrderPlaced** 🟢 *HIGHEST PRIORITY*
- **Event Signature**: `OrderPlaced(bytes32,address,uint8,uint256,uint256,uint256)`  
- **Topic0 Hash**: `0xb18a04414e157e27a7bd658d83da50aeed90007f362102747b7d7f34b8b75ce1`  
- **Description**: Emitted when a new order is placed in the order book  
- **Indexed Parameters**: `orderId`, `user`, `side`  
- **Non-Indexed**: `size`, `price`, `timestamp`  
- **Use Case**: Live order book updates, pending orders table

#### **OrderFilled** 🟢 *HIGHEST PRIORITY*  
- **Event Signature**: `OrderFilled(bytes32,address,address,uint256,uint256,uint256)`  
- **Topic0 Hash**: `0xec7abeea99156aa60ed39992d78c95b0082f64d3469447a70c7fd11981912b9f`  
- **Description**: Emitted when an order is matched and filled  
- **Indexed Parameters**: `orderId`, `taker`, `maker`  
- **Non-Indexed**: `size`, `price`, `timestamp`  
- **Use Case**: Trade history, order execution confirmations

#### **OrderCancelled** 🟡 *HIGH PRIORITY*
- **Event Signature**: `OrderCancelled(bytes32,address,uint256)`  
- **Topic0 Hash**: `0xdc408a4b23cfe0edfa69e1ccca52c3f9e60bc441b3b25c09ec6defb38896a4f3`  
- **Description**: Emitted when an order is cancelled by the trader  
- **Indexed Parameters**: `orderId`, `user`  
- **Non-Indexed**: `timestamp`  
- **Use Case**: Order book removal, cancelled orders history

#### **TradeExecuted** 🟢 *HIGHEST PRIORITY*
- **Event Signature**: `TradeExecuted(address,address,uint256,uint256,uint256)`  
- **Topic0 Hash**: `0xb0100c4a25ad7c8bfaa42766f529176b9340f45755da88189bd092353fe50f0b`  
- **Description**: Emitted when a trade is executed between two parties  
- **Indexed Parameters**: `buyer`, `seller`  
- **Non-Indexed**: `size`, `price`, `timestamp`  
- **Use Case**: Recent trades table, market activity feed

#### **PositionChanged** 🟡 *HIGH PRIORITY*
- **Event Signature**: `PositionChanged(address,int256,uint256,uint256)`  
- **Topic0 Hash**: `0x0c8435a0f8411018cf19a0463e3df6a28eaf6be12047606d6a194d4eef7941e5`  
- **Description**: Emitted when a user's position size changes  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `newSize`, `avgEntryPrice`, `timestamp`  
- **Use Case**: Position tracking, portfolio updates

### 💰 **VaultRouter Events** (Collateral & Margin Management)

#### **CollateralDeposited** 🟡 *HIGH PRIORITY*
- **Event Signature**: `CollateralDeposited(address,uint256,uint256)`  
- **Topic0 Hash**: `0x56bf5f326bb68ef9ee892959743daa870afd33ec3251e5136317ae3cb1c6ccc6`  
- **Description**: Emitted when collateral is deposited  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `amount`, `newBalance`  
- **Use Case**: Deposit history, balance updates

#### **CollateralWithdrawn** 🟡 *HIGH PRIORITY*
- **Event Signature**: `CollateralWithdrawn(address,uint256,uint256)`  
- **Topic0 Hash**: `0x781581308889fe2553086d915caa15566aa19d071c47a980e90b71a7a45113d2`  
- **Description**: Emitted when collateral is withdrawn  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `amount`, `newBalance`  
- **Use Case**: Withdrawal history, balance updates

#### **MarginLocked** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `MarginLocked(address,bytes32,uint256)`  
- **Topic0 Hash**: `0xb49fb973544011a77b6a5c6415d43a539c5da97e438a67b29d0eb31214fda7b8`  
- **Description**: Emitted when margin is locked for trading  
- **Indexed Parameters**: `user`, `marketId`  
- **Non-Indexed**: `amount`  
- **Use Case**: Margin utilization tracking

#### **PositionUpdated** 🟡 *HIGH PRIORITY*
- **Event Signature**: `PositionUpdated(address,bytes32,int256,uint256)`  
- **Topic0 Hash**: `0x98186e5bd1f3f83b0feafb1ba9482dc65f678d929b705c7d7714cec6bee0ab5c`  
- **Description**: Emitted when a position is updated (VaultRouter version)  
- **Indexed Parameters**: `user`, `marketId`  
- **Non-Indexed**: `size`, `entryPrice`  
- **Use Case**: Cross-market position tracking

#### **PnLRealized** 🟡 *HIGH PRIORITY*
- **Event Signature**: `PnLRealized(address,bytes32,int256)`  
- **Topic0 Hash**: `0x908b4f47c9e48e3e3235843a31b7b41edf3cb7ed92150bd411b134f5c4f61f8a`  
- **Description**: Emitted when profit/loss is realized  
- **Indexed Parameters**: `user`, `marketId`  
- **Non-Indexed**: `pnl`  
- **Use Case**: P&L history, settlement records

### 🎛️ **TradingRouter Events** (Unified Trading Interface)

#### **MultiMarketOrderExecuted** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `MultiMarketOrderExecuted(address,uint256,uint256)`  
- **Topic0 Hash**: `0xe713fe8d6e47a5cf53ff5369b736d221611ea9e7df22f147e0d460bce80ee062`  
- **Description**: Emitted when multiple orders across markets are executed  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `orderCount`, `timestamp`  
- **Use Case**: Batch operation tracking

#### **PortfolioRebalanced** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `PortfolioRebalanced(address,uint256,uint256)`  
- **Topic0 Hash**: `0xdba6ecf824e543f91f2d9fce7c656c9eab3ed8706327214db08cf062e24b1e4b`  
- **Description**: Emitted when a user's portfolio is rebalanced  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `marketCount`, `timestamp`  
- **Use Case**: Portfolio management history

### 🏭 **Factory Events** (Market Management)

#### **MarketCreated** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `MarketCreated(bytes32,address,string,address)`  
- **Topic0 Hash**: `0x355c14b2f991e42aebf9be15844bf25fa28d4d47a02cd508a5141353c6bfeaef`  
- **Description**: Emitted when a new market is created  
- **Indexed Parameters**: `marketId`, `orderBookAddress`, `creator`  
- **Non-Indexed**: `symbol`  
- **Use Case**: Market discovery, new market notifications

#### **MarketStatusChanged** 🟠 *LOW PRIORITY*
- **Event Signature**: `MarketStatusChanged(bytes32,bool)`  
- **Topic0 Hash**: `0x2fe175d8a5496760dce9de310be00b77da4ba8987c02080d990eecd60483f779`  
- **Description**: Emitted when market status changes  
- **Indexed Parameters**: `marketId`  
- **Non-Indexed**: `isActive`  
- **Use Case**: Market availability updates

### 🔧 **Advanced Events** (System Features)

#### **Settlement** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `Settlement(bytes32,uint256,uint256)`  
- **Topic0 Hash**: `0x37dba88ea5264be0d4a78806b74e898954cd8ef396c56e39ac02eece3d6a0153`  
- **Description**: Emitted when market settlement occurs  
- **Indexed Parameters**: `marketId`  
- **Non-Indexed**: `settlementPrice`, `timestamp`  
- **Use Case**: Settlement history, market closure tracking

#### **FundingPaid** 🔵 *MEDIUM PRIORITY*
- **Event Signature**: `FundingPaid(address,int256,uint256)`  
- **Topic0 Hash**: `0xfae2baddaa94e837150738d427308d76342e805fc340f1fe409ba9340366add9`  
- **Description**: Emitted when funding payments are made  
- **Indexed Parameters**: `user`  
- **Non-Indexed**: `fundingAmount`, `timestamp`  
- **Use Case**: Funding rate tracking, fee calculations

#### **MetricUpdated** 🟠 *LOW PRIORITY*
- **Event Signature**: `MetricUpdated(bytes32,uint256,uint256)`  
- **Topic0 Hash**: `0xc9b9ffad8730284464be6e51b98f9f9a61f9656c3a4891e5e2805b56e734a189`  
- **Description**: Emitted when custom metric values are updated  
- **Indexed Parameters**: `marketId`  
- **Non-Indexed**: `newValue`, `timestamp`  
- **Use Case**: Custom metrics tracking, oracle updates

---

### 🎯 **Event Integration Priority Guide**

**🟢 HIGHEST PRIORITY** - Essential for order book UI:
- `OrderPlaced`, `OrderFilled`, `TradeExecuted` - Core trading activity

**🟡 HIGH PRIORITY** - Important for transaction tables:
- `OrderCancelled`, `PositionChanged`, `CollateralDeposited/Withdrawn`, `PositionUpdated`, `PnLRealized`

**🔵 MEDIUM PRIORITY** - Advanced features:
- Multi-market operations, portfolio management, settlements

**🟠 LOW PRIORITY** - System administration:
- Market management, metric updates, system configuration

### 📡 **Event Filtering Recommendations**

For **real-time order book updates**, filter by:
```
Topic0: [
  "0xb18a04414e157e27a7bd658d83da50aeed90007f362102747b7d7f34b8b75ce1", // OrderPlaced
  "0xec7abeea99156aa60ed39992d78c95b0082f64d3469447a70c7fd11981912b9f", // OrderFilled  
  "0xdc408a4b23cfe0edfa69e1ccca52c3f9e60bc441b3b25c09ec6defb38896a4f3"  // OrderCancelled
]
```

For **recent transactions table**, filter by:
```
Topic0: [
  "0xb0100c4a25ad7c8bfaa42766f529176b9340f45755da88189bd092353fe50f0b", // TradeExecuted
  "0x56bf5f326bb68ef9ee892959743daa870afd33ec3251e5136317ae3cb1c6ccc6", // CollateralDeposited
  "0x781581308889fe2553086d915caa15566aa19d071c47a980e90b71a7a45113d2"  // CollateralWithdrawn
]
```

---

## ⚙️ HyperLiquid System Configuration

### Trading Parameters
- **Creation Fee**: 0.1 MATIC (configurable via OrderBookFactoryMinimal)
- **Tick Size**: Fixed at 0.01 for all markets
- **Primary Collateral**: MockUSDC (6 decimals)
- **Market Symbol**: "Aluminum V1" futures trading

### Contract Optimizations
- **OrderBookFactory Size**: Optimized to <24KB (deployable on mainnet)
- **Order Matching**: Red-Black tree + Linked list for O(log n) + O(1) operations
- **Gas Optimization**: Solidity 0.8.20 with `runs: 1` and `viaIR: true`
- **Access Control**: Simplified Ownable pattern for reduced bytecode

### Risk Management
- **Collateral Management**: Centralized through VaultRouter
- **Position Tracking**: Real-time P&L calculation in OrderBook
- **Margin Requirements**: Configurable per market
- **Emergency Controls**: Pause functionality across all contracts

---

## 🔐 HyperLiquid Access Control & Roles

### Role Hierarchies

#### **OrderBookFactoryMinimal Roles**
- `Owner`: Full contract administration and market creation (Ownable pattern)

#### **VaultRouter Roles**
- `DEFAULT_ADMIN_ROLE`: Contract administration and configuration
- `ORDERBOOK_ROLE`: Authorized OrderBooks for collateral operations

#### **TradingRouter Roles**
- `DEFAULT_ADMIN_ROLE`: Contract administration and configuration
- `MARKET_ROLE`: Authorized markets for trade execution

#### **UpgradeManager Roles**
- `DEFAULT_ADMIN_ROLE`: System administration
- `UPGRADER_ROLE`: Authorized to execute contract upgrades

#### **Aluminum V1 OrderBook Roles**
- `DEFAULT_ADMIN_ROLE`: OrderBook administration
- `VAULT_ROLE`: Authorized VaultRouter for position updates

---

## 🛠️ Technical Specifications

### Gas Optimization Features
- **Minimal Proxy Pattern**: OrderBook implementation uses clones for efficient deployment
- **Packed Structs**: Optimized data structures to reduce gas costs
- **Batch Operations**: Multiple orders can be placed/cancelled in single transaction
- **Overflow Protection**: SafeMath operations throughout for security

### Security Features
- **ReentrancyGuard**: Protection against reentrancy attacks
- **AccessControl**: Role-based permissions with granular access
- **Pausable**: Emergency pause functionality across all contracts
- **Input Validation**: Comprehensive parameter validation
- **Overflow Checks**: Protection against arithmetic overflow/underflow

### Integration Points
- **UMA Oracle V3**: Decentralized oracle for settlement data
- **ERC-20 Compatibility**: Full support for standard tokens
- **Event-Driven Architecture**: Comprehensive event emission for indexing
- **Modular Design**: Separable components for maintainability

---

## 📝 Deployment Information

### Transaction Details
- **Deployment Block**: Latest deployment block on Polygon
- **Total Gas Used**: Approximately 10M+ gas units
- **Contract Verification**: All contracts verified on Polygonscan
- **Source Code**: Available on Polygonscan for transparency

### Environment
- **Network**: Polygon Mainnet
- **Solidity Version**: 0.8.19
- **Optimization**: Enabled with 200 runs
- **License**: MIT

### Development Status
- **Contract Status**: ✅ Production ready
- **Testing Status**: ✅ Comprehensive test suite
- **Security Status**: ⚠️ Self-audited (recommend professional audit for production)
- **Documentation**: ✅ Complete API documentation

---

## 🔄 Contract Upgrade History

### Complete System Redeploy with Scaling Fixes - September 2, 2025
- **Reason**: Applied comprehensive scaling fixes from ORDERBOOK_SCALING_ISSUES.md analysis
- **Previous System**: All contracts except MockUSDC redeployed
- **MockUSDC**: `0xA2258Ff3aC4f5c77ca17562238164a0205A5b289` *(REUSED)*
- **New System Addresses**:
  - **VaultRouter**: `0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`
  - **OrderBookFactoryMinimal**: `0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75`
  - **TradingRouter**: `0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B`
  - **UpgradeManager**: `0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9`
  - **Aluminum V1 OrderBook**: `0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE`
- **Status**: ✅ Successfully deployed & verified
- **Verification**: ✅ All contracts verified on Polygonscan
- **Critical Fixes Applied**:
  - ✅ **TradingRouter._getOrderBook()** function implemented (fixes market order failures)
  - ✅ **Decimal precision standardized** to 6 decimals (USDC compatibility)
  - ✅ **Market order price bounds** validation (prevents pricing explosions)
  - ✅ **Enhanced input validation** and error messages
  - ✅ **Proper margin calculations** with PRICE_PRECISION constants
  - ✅ **Overflow protection** and reasonable price limits
- **Impact**: 
  - Market orders now function correctly without "Array index out of bounds" errors
  - User-friendly dollar amounts ($1-$1000) work without frontend scaling workarounds
  - Improved error messages for better debugging
  - Enhanced security with proper input validation

### Previous TradingRouter Upgrade - September 1, 2025
- **Reason**: Fixed ABI compatibility issue with OrderBookFactoryMinimal interface
- **Old Address**: `0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6`
- **New Address**: `0xd5e8D39Fa0D9e64dff46e1607C4E9A1f4AD9EB0F`
- **Status**: ✅ Superseded by September 2 complete redeploy

---

## 🔗 HyperLiquid Contract Links

### Core Contracts *(UPDATED SEPTEMBER 2, 2025)*
- **MockUSDC**: [0xA2258Ff3aC4f5c77ca17562238164a0205A5b289](https://polygonscan.com/address/0xA2258Ff3aC4f5c77ca17562238164a0205A5b289) *(REUSED)*
- **VaultRouter**: [0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7](https://polygonscan.com/address/0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7#code) *(NEW)*
- **OrderBookFactoryMinimal**: [0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75](https://polygonscan.com/address/0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75#code) *(NEW)*
- **TradingRouter**: [0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B](https://polygonscan.com/address/0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B#code) *(NEW WITH SCALING FIXES)*
- **UpgradeManager**: [0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9](https://polygonscan.com/address/0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9#code) *(NEW)*

### Market Contracts *(UPDATED)*
- **Aluminum V1 OrderBook**: [0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE](https://polygonscan.com/address/0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE#code) *(NEW WITH SCALING FIXES)*

### Development Resources
- **Deployment Script**: `scripts/deploy-and-verify.ts`
- **Verification Script**: `scripts/verify-polygon.js`
- **Supabase Integration**: Configured for contract data storage
- **GitHub Repository**: HyperLiquid OrderBook DEX

---

**⚠️ Important Notice**: This deployment includes MockUSDC for testing purposes. For production usage with real funds, this should be replaced with actual USDC tokens.

**✅ Production Status**: All contracts redeployed with scaling fixes and verified on Polygon mainnet
**🎯 Market Status**: Aluminum V1 futures trading is LIVE with enhanced performance
**🔧 Scaling Fixes**: Applied comprehensive fixes for market orders, decimal precision, and user experience

**Last Updated**: September 2, 2025  
**Document Version**: 3.0.0 - Complete System Redeploy with Scaling Fixes
