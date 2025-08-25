# Polygon Mainnet Deployment Documentation

## 🚀 Deployment Overview

**Network**: Polygon Mainnet (Chain ID: 137)  
**Deployment Date**: August 22, 2024  
**Deployer Address**: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`  
**Total Gas Used**: ~2.5M MATIC  
**Verification Status**: ✅ All contracts verified on Polygonscan

---

## 🏭 Core Smart Contracts

### 1. **MetricsMarketFactory**
- **Address**: `0x354f188944eF514eEEf05d8a31E63B33f87f16E0`
- **Purpose**: Factory contract for creating new prediction markets
- **Key Features**:
  - Zero creation fee (0 MATIC)
  - Market creation with custom metrics
  - Integration with UMA Oracle system
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0x354f188944eF514eEEf05d8a31E63B33f87f16E0)

### 2. **CentralVault**
- **Address**: `0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C`
- **Purpose**: Central treasury and collateral management
- **Key Features**:
  - Manages user deposits and withdrawals
  - Collateral backing for all positions
  - Emergency pause functionality (24-hour duration)
  - Uses Mock USDC as primary collateral
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C)

### 3. **OrderRouter**
- **Address**: `0x516a1790a04250FC6A5966A528D02eF20E1c1891`
- **Purpose**: Order matching and trade execution engine
- **Key Features**:
  - 0.2% trading fee (20 basis points)
  - Automated order matching
  - Position size validation
  - Integration with oracle pricing
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0x516a1790a04250FC6A5966A528D02eF20E1c1891)

### 4. **UMAOracleManager**
- **Address**: `0xCa1B94AD513097fC17bBBdB146787e026E62132b`
- **Purpose**: Oracle integration and price resolution
- **Key Features**:
  - UMA OptimisticOracle integration
  - Dispute resolution mechanism
  - Settlement price determination
  - Mock UMA system for testing
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0xCa1B94AD513097fC17bBBdB146787e026E62132b)

### 5. **OrderBook Implementation**
- **Address**: `0x57404e18375abB60c643009D2aE6fa8f61FBd646`
- **Purpose**: Template contract for individual market orderbooks
- **Key Features**:
  - Cloneable implementation pattern
  - Gas-efficient market deployment
  - Standardized trading interface
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0x57404e18375abB60c643009D2aE6fa8f61FBd646)

---

## 🧪 Mock Contracts (Testing Infrastructure)

### 6. **MockUMAFinder**
- **Address**: `0x52512884CB360dd466c4935C9dd8089233F0f5B9`
- **Purpose**: Mock UMA protocol finder for testing
- **Key Features**:
  - Simulates UMA protocol discovery
  - Enables testing without mainnet UMA dependency
  - Development and testing environment support
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0x52512884CB360dd466c4935C9dd8089233F0f5B9)

### 7. **MockUSDC**
- **Address**: `0xff541e2AEc7716725f8EDD02945A1Fe15664588b`
- **Purpose**: Mock USDC token for testing and development
- **Key Features**:
  - Standard ERC-20 implementation
  - Faucet functionality for testing
  - 6 decimal precision (matches real USDC)
  - Unlimited minting for development
- **Polygonscan**: [View Contract](https://polygonscan.com/address/0xff541e2AEc7716725f8EDD02945A1Fe15664588b)

---

## 📊 Sample Markets

### Silver V1 Market
- **Market Address**: `0x07d317C87E6d8AF322463aCF024f1e28D38F6117`
- **Metric ID**: `SILVER_V1`
- **Description**: Premium Silver Price Tracking Market
- **Category**: Commodities
- **Starting Price**: $10.00
- **Trading Period**: 30 days
- **Settlement Date**: September 28, 2025
- **Status**: ✅ Active and ready for trading
- **Polygonscan**: [View Market](https://polygonscan.com/address/0x07d317C87E6d8AF322463aCF024f1e28D38F6117)

---

## ⚙️ Configuration Parameters

### Factory Settings
```javascript
{
  "defaultCreationFee": "0 MATIC",        // Free market creation
  "tradingFeeRate": 20,                   // 0.2% trading fee
  "emergencyPauseDuration": 86400,        // 24 hours
  "maxLeverage": "10x",                   // Maximum position leverage
  "minimumOrderSize": "1 USDC"            // Minimum trade size
}
```

### Oracle Settings
```javascript
{
  "disputePeriod": 7200,                  // 2 hours in seconds
  "bondAmount": "100 USDC",               // Oracle bond requirement
  "optimisticPeriod": 3600,               // 1 hour optimistic period
  "priceRequestLiveness": 86400           // 24 hours for price requests
}
```

---

## 🔐 Security Features

### Access Control
- **Owner Role**: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`
- **Governance**: Timelock-based upgrades
- **Emergency Pause**: 24-hour pause mechanism
- **Role-Based Permissions**: Granular access control

### Audit Status
- **Contracts**: Self-audited ⚠️
- **Testing**: Comprehensive test suite ✅
- **Verification**: All contracts verified on Polygonscan ✅

---

## 🛠️ Developer Integration

### Contract ABIs
All contract ABIs are available in the `artifacts/` directory after compilation.

### Environment Variables Required
```bash
# Deployment
PRIVATE_KEY=your_deployer_private_key
POLYGONSCAN_API_KEY=your_polygonscan_api_key

# Optional: Custom RPC
POLYGON_RPC_URL=https://polygon-rpc.com

# Optional: Supabase Integration
SUPABASE_URL=your_supabase_url
SUPABASE_SERVICE_ROLE_KEY=your_service_key
```

### Quick Start
```bash
# Clone and setup
git clone <repository>
cd orderbook-dex
npm install

# Deploy to polygon
npx hardhat run scripts/deploy-polygon.ts --network polygon

# Create a market
npx hardhat run scripts/create-sample-market.ts --network polygon
```

---

## 📝 Transaction Hashes

### Deployment Transactions
- **Factory Creation**: Transaction included in deployment
- **Vault Deployment**: Transaction included in deployment  
- **Router Setup**: Transaction included in deployment
- **Oracle Manager**: Transaction included in deployment
- **Silver Market**: `0x...` (Transaction hash from market creation)

---

## 🎯 Next Steps

### Immediate Tasks
1. ✅ Contracts deployed and verified
2. ✅ Sample market created (Silver V1)
3. 🔄 Frontend integration
4. 🔄 User onboarding system
5. 🔄 Market maker incentives

### Future Enhancements
- [ ] Additional commodity markets (Gold, Oil, etc.)
- [ ] Real UMA Oracle integration
- [ ] Advanced trading features
- [ ] Mobile application
- [ ] Governance token launch

---

## 📞 Support & Resources

### Documentation
- [Architecture Guide](./docs/ARCHITECTURE.md)
- [Getting Started](./docs/GETTING_STARTED.md)
- [Settlement Workflow](./docs/SETTLEMENT_WORKFLOW.md)

### Contact
- **GitHub**: [Repository Issues](https://github.com/your-repo/issues)
- **Discord**: [Community Server](https://discord.gg/your-server)

---

**⚠️ Disclaimer**: This deployment includes mock contracts for testing purposes. Always verify contract addresses and conduct thorough testing before mainnet usage with real funds.

**Last Updated**: August 22, 2024  
**Document Version**: 1.0.0
