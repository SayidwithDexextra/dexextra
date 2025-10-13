# Hyperliquid OrderBook Protocol

A production-ready smart contract system implementing a sophisticated futures-style order book protocol on the Hyper Liquid Blockchain. This system combines the best of Binance Futures with Polymarket-style custom metric trading, featuring a full order book matching engine, comprehensive portfolio management, and support for both traditional price-based markets and custom metric markets.

## 🏗️ Architecture Overview

The protocol consists of four main components:

### Core Contracts

1. **MockUSDC.sol** - ERC20 token for testing with unlimited minting
2. **VaultRouter.sol** - Centralized vault for collateral management and portfolio tracking
3. **OrderBook.sol** - Sophisticated order book with matching engine for individual markets
4. **OrderBookFactory.sol** - Factory for deploying and managing OrderBook instances

### Key Features

- 🔄 **Sophisticated Order Book**: Full bid/ask matching with limit and market orders
- 💰 **Comprehensive Portfolio Management**: Real-time PnL tracking, margin requirements
- 📊 **Dual Market Types**: Traditional price markets (ETH/USD) and custom metrics (world population)
- ⚡ **Real-time Settlement**: Periodic PnL realization and funding calculations
- 🛡️ **Risk Management**: Margin requirements, liquidation protection, collateral management
- 📈 **Front-end Ready**: Rich getter functions for portfolio and market data

## 📋 Contract Specifications

### VaultRouter.sol

**Central collateral management and portfolio tracking system**

#### Key Functions
```solidity
// Collateral Management
function depositCollateral(uint256 amount) external
function withdrawCollateral(uint256 amount) external

// Portfolio Queries (Front-end Ready)
function getPortfolioValue(address user) public view returns (int256)
function getAvailableCollateral(address user) public view returns (uint256)
function getMarginSummary(address user) external view returns (MarginSummary memory)

// Position Management (Called by OrderBooks)
function lockMargin(address user, bytes32 marketId, uint256 amount) external
function releaseMargin(address user, bytes32 marketId, uint256 amount) external
function updatePosition(address user, bytes32 marketId, int256 sizeDelta, uint256 entryPrice) external
```

#### MarginSummary Struct
```solidity
struct MarginSummary {
    uint256 totalCollateral;      // Total deposited collateral
    uint256 marginUsed;           // Margin locked in open positions
    uint256 marginReserved;       // Margin reserved for pending orders
    uint256 availableCollateral;  // Free collateral
    int256 realizedPnL;          // Realized profit/loss
    int256 unrealizedPnL;        // Unrealized profit/loss
    int256 portfolioValue;       // Total portfolio value
}
```

### OrderBook.sol

**Individual market order book with matching engine**

#### Key Functions
```solidity
// Order Placement
function placeLimitOrder(OrderSide side, uint256 size, uint256 price) external returns (bytes32)
function placeMarketOrder(OrderSide side, uint256 size) external returns (bytes32)
function cancelOrder(bytes32 orderId) external

// Custom Metrics (Oracle/Updater Role)
function updateMetricValue(uint256 newValue) external
function settleMarket(uint256 settlementPrice) external

// Market Data
function getBestPrices() external view returns (uint256 bestBid, uint256 bestAsk)
function getOrderBookDepth(uint256 levels) external view returns (...)
function getMarketInfo() external view returns (Market memory)
```

### OrderBookFactory.sol

**Factory for deploying and managing markets**

#### Key Functions
```solidity
// Market Creation
function createTraditionalMarket(string memory symbol) external payable returns (bytes32, address)
function createCustomMetricMarket(string memory symbol, string memory metricId) external payable returns (bytes32, address)

// Market Management
function setMarketStatus(bytes32 marketId, bool isActive) external
function getMarket(bytes32 marketId) external view returns (MarketInfo memory)
function getAllMarkets() external view returns (bytes32[] memory)
```

## 🚀 Quick Start

### Prerequisites

- Node.js v18+
- npm or yarn
- Hardhat

### Installation

```bash
# Clone and setup
cd Hyperliquid
npm install

# Copy environment file
cp env.example .env

# Compile contracts
npm run compile
```

### Deployment

```bash
# Deploy to local network
npx hardhat node

# In another terminal
npm run deploy

# Deploy with test data
SETUP_TEST_DATA=true npm run deploy
```

### Setting up Test Environment

```bash
# Set contract addresses in .env after deployment
export MOCK_USDC_ADDRESS="0x..."
export VAULT_ROUTER_ADDRESS="0x..."
export FACTORY_ADDRESS="0x..."

# Setup test users and data
npx hardhat run scripts/setup-test-environment.ts --network localhost
```

## 📊 Usage Examples

### Portfolio Management

```typescript
// Get user portfolio summary
const summary = await vaultRouter.getMarginSummary(userAddress);
console.log("Portfolio Value:", ethers.formatUnits(summary.portfolioValue, 6));
console.log("Available Collateral:", ethers.formatUnits(summary.availableCollateral, 6));

// Deposit collateral
await mockUSDC.approve(vaultRouterAddress, amount);
await vaultRouter.depositCollateral(amount);
```

### Trading

```typescript
// Get market OrderBook contract
const ethMarketId = await factory.getMarketBySymbol("ETH/USD");
const marketInfo = await factory.getMarket(ethMarketId);
const orderBook = await ethers.getContractAt("OrderBook", marketInfo.orderBookAddress);

// Place limit order
const orderId = await orderBook.placeLimitOrder(
  0, // BUY
  ethers.parseUnits("1", 0), // 1 ETH
  ethers.parseUnits("2000", 0) // $2000
);

// Place market order
await orderBook.placeMarketOrder(
  1, // SELL
  ethers.parseUnits("0.5", 0) // 0.5 ETH
);
```

### Custom Metrics

```typescript
// Create custom metric market
const [marketId, orderBookAddress] = await factory.createCustomMetricMarket(
  "WORLD_POP",
  "world_population",
  { value: marketCreationFee }
);

// Update metric value (Oracle/Updater role)
const orderBook = await ethers.getContractAt("OrderBook", orderBookAddress);
await orderBook.updateMetricValue(ethers.parseUnits("8000000000", 0)); // 8 billion
```

### Portfolio Queries

```bash
# Query portfolio information
USER_ADDRESS=0x... npx hardhat run scripts/query-portfolio.ts --network localhost
```

## 🔧 Configuration

### Market Creation

- **Creation Fee**: 0.1 ETH per market (configurable)
- **Creator Fee**: 1% of trading fees (configurable)
- **Margin Requirements**: 10% initial margin (configurable per market)

### Supported Market Types

1. **Traditional Markets**: ETH/USD, BTC/USD, etc.
2. **Custom Metrics**: World population, Spotify listeners, weather data, etc.

### Role-Based Access

- **DEFAULT_ADMIN_ROLE**: Full system administration
- **MARKET_CREATOR_ROLE**: Can create new markets
- **ORACLE_ROLE**: Can update prices and settle markets
- **UPDATER_ROLE**: Can update custom metric values
- **ORDERBOOK_ROLE**: OrderBook contracts (auto-granted)
- **SETTLEMENT_ROLE**: Can trigger settlement and realize PnL

## 🔄 Settlement & PnL

### Periodic Settlement

The system supports periodic settlement to realize unrealized PnL:

```solidity
// Admin calls settlement for a market
await vaultRouter.realizePnL(user, marketId, pnlAmount);

// Update mark prices
await vaultRouter.updateMarkPrice(marketId, newPrice);
```

### Funding Calculations

```solidity
// Calculate and apply funding (every 8 hours)
await orderBook.calculateFunding();
```

## 📈 Events & Indexing

### Key Events

```solidity
// Portfolio Events
event PortfolioUpdated(address user, int256 portfolioValue, uint256 availableCollateral, uint256 timestamp);
event CollateralDeposited(address user, uint256 amount, uint256 newBalance);
event CollateralWithdrawn(address user, uint256 amount, uint256 newBalance);

// Trading Events
event OrderPlaced(bytes32 orderId, address user, OrderSide side, uint256 size, uint256 price, uint256 timestamp);
event TradeExecuted(address buyer, address seller, uint256 size, uint256 price, uint256 timestamp);
event OrderFilled(bytes32 orderId, address taker, address maker, uint256 size, uint256 price, uint256 timestamp);

// Market Events
event MarketCreated(bytes32 marketId, address orderBook, string symbol, string metricId, bool isCustomMetric, address creator, uint256 timestamp);
event MetricUpdated(bytes32 marketId, uint256 newValue, uint256 timestamp);
event Settlement(bytes32 marketId, uint256 settlementPrice, uint256 timestamp);
```

## 🧪 Testing

### Run Tests

```bash
npm test
```

### Local Development

```bash
# Start local node
npx hardhat node

# Deploy contracts
npm run deploy

# Setup test environment
npx hardhat run scripts/setup-test-environment.ts --network localhost

# Query portfolios
npx hardhat run scripts/query-portfolio.ts --network localhost
```

## 🛠️ Frontend Integration

### Contract Addresses

After deployment, use these addresses in your frontend:

```typescript
const MOCK_USDC = "0x...";
const VAULT_ROUTER = "0x...";
const ORDERBOOK_FACTORY = "0x...";
```

### Key Frontend Functions

```typescript
// Portfolio Management
const summary = await vaultRouter.getMarginSummary(userAddress);
const portfolioValue = await vaultRouter.getPortfolioValue(userAddress);
const availableCollateral = await vaultRouter.getAvailableCollateral(userAddress);

// Market Data
const markets = await factory.getAllMarkets();
const marketInfo = await factory.getMarket(marketId);
const [bestBid, bestAsk] = await orderBook.getBestPrices();
const depth = await orderBook.getOrderBookDepth(10);

// Trading
const orderId = await orderBook.placeLimitOrder(side, size, price);
await orderBook.cancelOrder(orderId);
```

## 📚 Advanced Features

### Custom Metric Markets

The system's unique feature is support for custom metrics:

- **World Population**: Bet on demographic trends
- **Spotify Listeners**: Trade on artist popularity
- **Weather Data**: Climate and weather derivatives
- **Social Media Metrics**: Twitter followers, Instagram engagement
- **Economic Indicators**: GDP, inflation rates, employment data

### Order Book Matching Engine

- **Price-Time Priority**: Orders matched by price first, then time
- **Partial Fills**: Orders can be partially filled
- **Market Impact**: Real-time market impact calculation
- **Slippage Protection**: Built-in slippage limits for market orders

### Risk Management

- **Margin Requirements**: Dynamic margin based on volatility
- **Position Limits**: Per-user and per-market position limits
- **Auto-Liquidation**: Automatic position liquidation on margin calls
- **Circuit Breakers**: Trading halts on extreme price movements

## 🚨 Security Considerations

### Access Control

- Role-based permissions using OpenZeppelin AccessControl
- Timelock for admin functions (recommended for production)
- Multi-signature wallet for admin roles

### Reentrancy Protection

- All external calls protected with ReentrancyGuard
- Checks-Effects-Interactions pattern followed
- Safe ERC20 transfers using OpenZeppelin SafeERC20

### Testing & Audits

- Comprehensive test suite covering all functionality
- Formal verification recommended for production
- Third-party security audit recommended

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality
4. Ensure all tests pass
5. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🔗 Links

- [Hyperliquid Documentation](https://hyperliquid.gitbook.io/)
- [OpenZeppelin Contracts](https://docs.openzeppelin.com/contracts/)
- [Hardhat Documentation](https://hardhat.org/docs)

---

**⚠️ Disclaimer**: This system is for educational and testing purposes. Conduct thorough testing and security audits before any production deployment. Trading involves risk of loss.

