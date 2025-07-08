# Production-Ready vAMM Smart Contracts

A comprehensive virtual Automated Market Maker (vAMM) system for perpetual futures trading with funding rate mechanism and modular vault architecture.

## 🚀 Features

### Core Features
- **Virtual AMM**: Price discovery through virtual reserves without requiring actual liquidity
- **Funding Rate Mechanism**: Automatic funding payments to keep perpetual contract prices aligned with spot prices
- **Modular Vault System**: Separate vault contract for margin handling and risk management
- **Leverage Trading**: Support for up to 100x leverage
- **Liquidation System**: Automatic liquidation of undercollateralized positions

### Production Features
- **Access Control**: Role-based permissions for administrative functions
- **Emergency Pause**: Circuit breaker mechanism for emergency situations
- **Price Impact Protection**: Slippage protection for large trades
- **Comprehensive Events**: Full event logging for monitoring and analytics
- **Fee Management**: Configurable trading and liquidation fees
- **Oracle Integration**: Flexible price oracle system

## 📁 Contract Architecture

```
contracts/
├── IPriceOracle.sol          # Price oracle interface
├── IVault.sol               # Vault interface  
├── IvAMM.sol                # vAMM interface
├── Vault.sol                # Modular margin vault implementation
├── vAMM.sol                 # Main vAMM contract with funding rates
├── vAMMFactory.sol          # Factory for deploying vAMM instances
├── MockPriceOracle.sol      # Mock oracle for testing
└── MockUSDC.sol             # Mock USDC token for testing
```

## 🔧 Technical Specifications

### vAMM Contract (`vAMM.sol`)
- **Funding Rate**: Hourly funding payments based on premium/discount to index price
- **Virtual Reserves**: 1M base and quote token virtual liquidity pools
- **Leverage**: 1x to 100x leverage support
- **Fees**: 0.3% trading fee, 5% liquidation fee (configurable)
- **Margin**: 5% maintenance margin, 10% initial margin (configurable)

### Vault Contract (`Vault.sol`)
- **Margin Management**: Collateral deposits, reserves, and withdrawals
- **PnL Tracking**: Real-time unrealized profit and loss calculations
- **Funding Integration**: Automatic funding payment applications
- **Liquidation Logic**: Risk-based liquidation triggers

### Factory Contract (`vAMMFactory.sol`)
- **Market Deployment**: One-click deployment of vAMM + Vault pairs
- **Market Registry**: Central registry of all deployed markets
- **Fee Collection**: Deployment fee mechanism

## 🚀 Quick Start

### Prerequisites
- Node.js 16+
- Truffle Suite
- Web3.js

### Installation

```bash
cd DexContracts
npm install -g truffle
```

### Deployment

1. **Configure Network** (update `truffle-config.js`):
```javascript
module.exports = {
  networks: {
    development: {
      host: "127.0.0.1",
      port: 8545,
      network_id: "*"
    }
  },
  compilers: {
    solc: {
      version: "0.8.20"
    }
  }
};
```

2. **Deploy Contracts**:
```bash
truffle migrate --network development
```

3. **Verify Deployment**:
```bash
truffle console --network development
```

## 📊 Usage Examples

### Opening a Long Position

```javascript
// Get contracts
const factory = await vAMMFactory.deployed();
const markets = await factory.getActiveMarkets();
const marketInfo = await factory.getMarket(markets[0]);
const vamm = await vAMM.at(marketInfo.vamm);
const vault = await Vault.at(marketInfo.vault);

// Deposit collateral
const collateralAmount = web3.utils.toWei("1000", "mwei"); // 1000 USDC
await usdc.approve(vault.address, collateralAmount);
await vault.depositCollateral(user, collateralAmount);

// Open long position with 10x leverage
const leverage = 10;
const minPrice = 0; // No slippage protection for this example
const maxPrice = web3.utils.toWei("100000", "ether"); // Max price
await vamm.openPosition(collateralAmount, true, leverage, minPrice, maxPrice);
```

### Closing a Position

```javascript
// Get current position
const position = await vamm.getPosition(user);
const sizeToClose = position.size; // Close entire position

// Close position
await vamm.closePosition(sizeToClose, 0, web3.utils.toWei("100000", "ether"));
```

### Checking Funding Rate

```javascript
// Update funding (can be called by anyone)
await vamm.updateFunding();

// Get current funding rate
const fundingRate = await vamm.getFundingRate();
console.log("Current funding rate:", fundingRate.toString());
```

## 🔐 Security Features

### Access Control
- **Owner-only functions**: Parameter updates, emergency controls
- **Authorized contracts**: Vault can only be called by authorized contracts
- **User permissions**: Users can only manage their own positions

### Emergency Mechanisms
- **Pause functionality**: Disable trading during emergencies
- **Emergency withdrawal**: Owner can recover funds when paused
- **Circuit breakers**: Automatic protections against extreme market conditions

### Risk Management
- **Liquidation system**: Automatic liquidation of risky positions
- **Margin requirements**: Configurable initial and maintenance margins
- **Price validation**: Oracle price freshness and sanity checks

## 📈 Funding Rate Mechanism

The funding rate mechanism ensures perpetual contract prices stay close to spot prices:

1. **Premium Calculation**: Compare mark price (vAMM price) to index price (oracle)
2. **Funding Rate**: Calculate hourly funding rate based on premium
3. **Payment Direction**: 
   - When mark > index: Longs pay shorts
   - When mark < index: Shorts pay longs
4. **Automatic Application**: Funding applied on position updates

## ⚙️ Configuration

### Trading Parameters
- `tradingFeeRate`: 30 basis points (0.3%)
- `liquidationFeeRate`: 500 basis points (5%)
- `maintenanceMarginRatio`: 500 basis points (5%)
- `initialMarginRatio`: 1000 basis points (10%)

### Funding Parameters
- `FUNDING_INTERVAL`: 1 hour
- `MAX_FUNDING_RATE`: 1% per hour
- `FUNDING_PRECISION`: 1e8

### Leverage Limits
- `MIN_LEVERAGE`: 1x
- `MAX_LEVERAGE`: 100x

## 🧪 Testing

### Run Tests
```bash
truffle test
```

### Test Coverage
- Unit tests for all core functions
- Integration tests for cross-contract interactions
- Edge case testing for extreme market conditions
- Gas optimization tests

## 📝 Events

### vAMM Events
- `PositionOpened`: New position created
- `PositionClosed`: Position closed
- `FundingUpdated`: Funding rate updated
- `FundingPaid`: Funding payment applied
- `PositionLiquidated`: Position liquidated

### Vault Events
- `CollateralDeposited`: Collateral added
- `CollateralWithdrawn`: Collateral removed
- `MarginReserved`: Margin reserved for position
- `PnLUpdated`: Profit/loss updated

## 🔮 Future Enhancements

1. **Multiple Collateral Support**: Support for various collateral tokens
2. **Advanced Oracle Integration**: Chainlink or other decentralized oracles
3. **Cross-Margin Trading**: Portfolio-based margin calculations
4. **Insurance Fund**: Protocol-level risk management
5. **Governance Token**: Decentralized parameter management

## 📄 License

MIT License - see LICENSE file for details.

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add comprehensive tests
4. Submit pull request

## ⚠️ Disclaimer

This is a complex DeFi protocol. Please conduct thorough testing and audits before using in production. Trading perpetual futures involves significant risk of loss. 