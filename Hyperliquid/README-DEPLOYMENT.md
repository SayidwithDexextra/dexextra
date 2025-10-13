# HyperLiquid Polygon Deployment Guide

This guide covers the complete deployment and verification process for HyperLiquid contracts on Polygon blockchain.

## 📋 Prerequisites

### Required Tools
- Node.js (v18 or higher)
- npm or yarn
- Git

### Required Accounts
- Polygon wallet with MATIC for gas fees
- [Polygonscan API key](https://polygonscan.com/apis) for contract verification
- [Infura account](https://infura.io/) (optional, for RPC)

### Estimated Costs
- **Polygon Mainnet**: ~$10-20 MATIC for full deployment
- **Mumbai Testnet**: Free (use [faucet](https://faucet.polygon.technology/))

## 🚀 Quick Start

### 1. Environment Setup

Copy the environment template:
```bash
cp env.polygon.example .env.polygon
```

Edit `.env.polygon` with your configuration:
```bash
# Required
PRIVATE_KEY=your_private_key_here
POLYGONSCAN_API_KEY=your_polygonscan_api_key

# Optional (will use defaults)
POLYGON_RPC_URL=https://polygon-rpc.com
GAS_PRICE=30
```

### 2. One-Command Deployment

For Polygon mainnet:
```bash
./scripts/deploy.sh full polygon
```

For Mumbai testnet:
```bash
./scripts/deploy.sh full mumbai
```

## 📚 Detailed Instructions

### Step 1: Install Dependencies

```bash
npm install
```

### Step 2: Configure Environment

Create your environment file:
```bash
cp env.polygon.example .env.polygon
```

**Required Environment Variables:**
```bash
PRIVATE_KEY=your_deployer_private_key
POLYGONSCAN_API_KEY=your_api_key_for_verification
```

**Optional Environment Variables:**
```bash
POLYGON_RPC_URL=https://polygon-rpc.com
GAS_PRICE=30                    # Gas price in gwei
GAS_LIMIT=8000000              # Gas limit
INITIAL_COLLATERAL=1000000     # Test USDC amount
VERIFICATION_DELAY=5000        # Delay between verifications
```

### Step 3: Compile and Test

```bash
# Compile contracts
./scripts/deploy.sh compile

# Run tests
./scripts/deploy.sh test
```

### Step 4: Deploy

Choose your network:

**Polygon Mainnet:**
```bash
./scripts/deploy.sh deploy polygon
```

**Mumbai Testnet:**
```bash
./scripts/deploy.sh deploy mumbai
```

**Local Development:**
```bash
./scripts/deploy.sh deploy localhost
```

### Step 5: Verify Contracts

If verification wasn't done automatically:
```bash
./scripts/deploy.sh verify polygon
```

Or use batch verification:
```bash
./scripts/deploy.sh batch-verify polygon
```

## 🛠 Advanced Usage

### Manual Script Execution

```bash
# Deploy and verify manually
npx hardhat run scripts/deploy-and-verify.ts --network polygon

# Verify only
npx hardhat run scripts/verify-contracts.ts --network polygon

# Batch verify from deployment file
npx hardhat run scripts/batch-verify.ts --network polygon
```

### Custom Gas Configuration

Set gas price and limit:
```bash
export GAS_PRICE=50  # 50 gwei
export GAS_LIMIT=10000000
./scripts/deploy.sh deploy polygon
```

### Deployment Options

```bash
# Skip tests during deployment
./scripts/deploy.sh deploy polygon --skip-tests

# Skip verification
./scripts/deploy.sh deploy polygon --skip-verify

# Full pipeline with custom options
./scripts/deploy.sh full polygon --skip-tests
```

## 📊 Contract Verification

### Automatic Verification

The deployment script automatically verifies contracts after deployment with:
- 30-second delay for contract indexing
- 3 retry attempts for failed verifications
- 5-second delay between verifications to avoid rate limits

### Manual Verification

If automatic verification fails:

```bash
# Verify specific contract
npx hardhat verify --network polygon CONTRACT_ADDRESS "constructor" "arguments"

# Example for MockUSDC
npx hardhat verify --network polygon 0x123... "0xYourAddress"
```

### Batch Verification

Verify all contracts from a deployment file:
```bash
DEPLOYMENT_FILE=deployments-polygon-1234567890.json ./scripts/deploy.sh batch-verify polygon
```

## 📁 Generated Files

After deployment, you'll find:

### Deployment Files
- `deployments-polygon-TIMESTAMP.json` - Complete deployment data
- `.env.deployment` - Environment variables with addresses
- `verification-report-polygon-TIMESTAMP.json` - Verification results

### Example Deployment File
```json
{
  "network": "polygon",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "deployer": "0x...",
  "addresses": {
    "mockUSDC": "0x...",
    "vaultRouter": "0x...",
    "orderBookFactory": "0x...",
    "tradingRouter": "0x...",
    "upgradeManager": "0x...",
    "orderBooks": {
      "ETH/USD": "0x...",
      "BTC/USD": "0x..."
    }
  }
}
```

## 🔧 Troubleshooting

### Common Issues

**1. "Insufficient funds for gas"**
```bash
# Check your MATIC balance
npx hardhat run scripts/check-balance.ts --network polygon

# Get MATIC from faucet (Mumbai only)
# Visit: https://faucet.polygon.technology/
```

**2. "nonce too low"**
```bash
# Reset nonce in MetaMask or wait a few minutes
```

**3. "Contract verification failed"**
```bash
# Check your API key
echo $POLYGONSCAN_API_KEY

# Try manual verification
npx hardhat verify --network polygon ADDRESS CONSTRUCTOR_ARGS

# Use batch verification with retries
./scripts/deploy.sh batch-verify polygon
```

**4. "Contract size exceeds limit"**
```bash
# Enable optimizer in hardhat.config.polygon.ts
optimizer: {
  enabled: true,
  runs: 200
}
```

### Network Issues

**RPC Rate Limiting:**
```bash
# Use alternative RPC
export POLYGON_RPC_URL=https://rpc-mainnet.matic.network
```

**High Gas Prices:**
```bash
# Check current gas prices
curl https://gasstation-mainnet.matic.network/v2

# Set lower gas price
export GAS_PRICE=20
```

### Verification Issues

**API Rate Limiting:**
```bash
# Increase delay between verifications
export VERIFICATION_DELAY=10000  # 10 seconds
```

**Already Verified:**
```bash
# Skip already verified contracts
export SKIP_VERIFIED=true
```

## 🔍 Verification Status

Check contract verification on Polygonscan:

1. **Polygon Mainnet**: https://polygonscan.com/address/YOUR_CONTRACT_ADDRESS
2. **Mumbai Testnet**: https://mumbai.polygonscan.com/address/YOUR_CONTRACT_ADDRESS

Verified contracts will show:
- ✅ Green checkmark
- "Contract" tab with source code
- Ability to interact directly

## 🎯 Production Deployment Checklist

### Pre-Deployment
- [ ] All tests passing
- [ ] Security audit completed
- [ ] Gas optimization reviewed
- [ ] Multi-sig wallet setup (if required)
- [ ] Sufficient MATIC for deployment (~$20)

### Deployment
- [ ] Deploy to Mumbai testnet first
- [ ] Verify all contracts work correctly
- [ ] Deploy to Polygon mainnet
- [ ] Verify all contracts on Polygonscan
- [ ] Test basic functionality

### Post-Deployment
- [ ] Update frontend with contract addresses
- [ ] Set up monitoring and alerting
- [ ] Update documentation
- [ ] Announce deployment
- [ ] Set up governance (if applicable)

## 📞 Support

### Resources
- [Polygon Documentation](https://docs.polygon.technology/)
- [Hardhat Documentation](https://hardhat.org/docs)
- [Polygonscan API](https://polygonscan.com/apis)

### Community
- [Polygon Discord](https://discord.gg/polygon)
- [Hardhat Discord](https://discord.gg/hardhat)

### Troubleshooting
If you encounter issues:
1. Check the troubleshooting section above
2. Review deployment logs
3. Check network status
4. Consult community resources

---

## 🏗 Architecture Overview

The HyperLiquid system consists of:

1. **MockUSDC** - Test USDC token for collateral
2. **VaultRouter** - Manages user collateral and positions
3. **OrderBookFactory** - Creates and manages OrderBook instances
4. **OrderBook** - Optimized order matching engine
5. **TradingRouter** - Unified trading interface
6. **UpgradeManager** - Handles contract upgrades

All contracts are designed for modularity and upgradeability while maintaining security and gas efficiency.

Happy deploying! 🚀
