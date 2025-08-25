# OrderBook DEX Deployment & Verification Guide

This guide covers how to deploy the OrderBook DEX contracts to various networks with automatic contract verification.

## 🔧 Prerequisites

### 1. Environment Setup

1. Copy the environment template:
   ```bash
   cp env.example .env
   ```

2. Fill in your configuration:
   ```bash
   # Required for deployment
   PRIVATE_KEY=your_private_key_without_0x_prefix
   
   # Required for verification (get free API keys)
   POLYGONSCAN_API_KEY=your_polygonscan_api_key
   ETHERSCAN_API_KEY=your_etherscan_api_key
   ```

### 2. Install Dependencies

```bash
npm install
```

### 3. Compile Contracts

```bash
npm run compile
```

## 🌐 Supported Networks

| Network | Chain ID | RPC URL | Block Explorer | API Key Required |
|---------|----------|---------|----------------|------------------|
| **Ethereum Mainnet** | 1 | Infura/Alchemy | Etherscan | `ETHERSCAN_API_KEY` |
| **Ethereum Sepolia** | 11155111 | Infura/Alchemy | Etherscan | `ETHERSCAN_API_KEY` |
| **Polygon Mainnet** | 137 | Public RPC | Polygonscan | `POLYGONSCAN_API_KEY` |
| **Polygon Mumbai** | 80001 | Public RPC | Polygonscan | `POLYGONSCAN_API_KEY` |
| **Arbitrum One** | 42161 | Public RPC | Arbiscan | `ARBISCAN_API_KEY` |
| **Optimism** | 10 | Public RPC | Optimistic Etherscan | `OPTIMISM_API_KEY` |
| **BSC Mainnet** | 56 | Public RPC | BSCScan | `BSCSCAN_API_KEY` |
| **BSC Testnet** | 97 | Public RPC | BSCScan | `BSCSCAN_API_KEY` |
| **Avalanche** | 43114 | Public RPC | Snowtrace | `SNOWTRACE_API_KEY` |

## 🚀 Deployment Commands

### Quick Deployment (Recommended)

Deploy to any supported network with automatic verification:

```bash
# Polygon Mainnet
npx hardhat run scripts/deploy.ts --network polygon

# Polygon Mumbai Testnet  
npx hardhat run scripts/deploy.ts --network polygonMumbai

# Ethereum Sepolia Testnet
npx hardhat run scripts/deploy.ts --network sepolia

# Ethereum Mainnet
npx hardhat run scripts/deploy.ts --network mainnet
```

### Polygon-Specific Deployment

For production Polygon deployment with real UMA integration:

```bash
npx hardhat run scripts/deploy-polygon.ts --network polygon
```

### Test Verification Setup

Test that verification works on your chosen network:

```bash
npx hardhat run scripts/test-verification.ts --network polygonMumbai
```

## 🔍 Contract Verification

### Automatic Verification

Verification happens automatically during deployment if:
1. ✅ Network supports verification  
2. ✅ Correct API key is configured
3. ✅ Network connection is stable

### Manual Verification

If automatic verification fails, use these commands:

```bash
# Verify a single contract
npx hardhat verify --network polygon CONTRACT_ADDRESS "constructor_arg1" "constructor_arg2"

# Example: Verify MockUSDC (no constructor args)
npx hardhat verify --network polygon 0x1234567890123456789012345678901234567890

# Example: Verify UMAOracleManager (with constructor args)
npx hardhat verify --network polygon 0x1234567890123456789012345678901234567890 \
  "0xUMA_FINDER_ADDRESS" \
  "0xBOND_CURRENCY_ADDRESS" \
  "0xADMIN_ADDRESS"
```

### Verification Status

After deployment, check verification status:

1. **Automatic verification output** - Shows success/failure for each contract
2. **Manual verification instructions** - Generated if any contracts fail
3. **Block explorer links** - Included in deployment output

## 📋 API Key Setup

### 1. Polygonscan (Polygon & Mumbai)

1. Go to [https://polygonscan.com/apis](https://polygonscan.com/apis)
2. Create a free account
3. Generate an API key
4. Add to `.env`: `POLYGONSCAN_API_KEY=your_key_here`

### 2. Etherscan (Ethereum Networks)

1. Go to [https://etherscan.io/apis](https://etherscan.io/apis)
2. Create a free account  
3. Generate an API key
4. Add to `.env`: `ETHERSCAN_API_KEY=your_key_here`

### 3. Other Networks

- **Arbiscan**: [https://arbiscan.io/apis](https://arbiscan.io/apis) → `ARBISCAN_API_KEY`
- **Optimistic Etherscan**: [https://optimistic.etherscan.io/apis](https://optimistic.etherscan.io/apis) → `OPTIMISM_API_KEY`
- **BSCScan**: [https://bscscan.com/apis](https://bscscan.com/apis) → `BSCSCAN_API_KEY`
- **Snowtrace**: [https://snowtrace.io/apis](https://snowtrace.io/apis) → `SNOWTRACE_API_KEY`

## 🔧 Configuration Options

### Environment Variables

```bash
# Deployment
PRIVATE_KEY=your_private_key_here
DEPLOY_MOCK_TOKENS=true  # Deploy mocks for testing

# Network RPCs (optional, fallback to public RPCs)
POLYGON_RPC_URL=https://polygon-rpc.com
MAINNET_RPC_URL=https://mainnet.infura.io/v3/YOUR_KEY

# UMA Protocol (for mainnet)
UMA_FINDER_ADDRESS=0x... # UMA Finder contract
BOND_CURRENCY_ADDRESS=0x... # Bond currency (USDC)

# DEX Settings
DEFAULT_CREATION_FEE=1.0  # Market creation fee in ETH/MATIC
TRADING_FEE_RATE=20       # 0.2% trading fee (20 basis points)
```

### Gas Settings

```bash
# Gas reporting
REPORT_GAS=true
COINMARKETCAP_API_KEY=your_cmc_key  # For USD gas costs
```

## 📊 Deployment Output

### Successful Deployment

```
🎉 Deployment completed successfully!

📋 Contract Addresses:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
UMA Oracle Manager:      0x1234...
Central Vault:           0x5678...
Order Router:            0x9abc...
OrderBook Implementation: 0xdef0...
Metrics Market Factory:  0x1357...
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔍 Starting contract verification...
✅ Contract verified successfully at 0x1234...
✅ Contract verified successfully at 0x5678...

📊 Verification Summary:
   ✅ Verified: 5
   ❌ Failed: 0
   📈 Success Rate: 100.0%
```

### Failed Verification

If verification fails, manual instructions are generated:

```
⚠️  Some contracts failed verification. Generating manual verification instructions...

📝 Manual Verification Instructions for polygon:
════════════════════════════════════════════════════════════

1. UMAOracleManager:
   Address: 0x1234567890123456789012345678901234567890
   Contract Path: contracts/core/UMAOracleManager.sol:UMAOracleManager
   Constructor Args: ["0xUMA_FINDER","0xBOND_CURRENCY","0xADMIN"]
   Command: npx hardhat verify --network polygon 0x1234... "0xUMA_FINDER" "0xBOND_CURRENCY" "0xADMIN"
```

## 🛠 Troubleshooting

### Common Issues

1. **"Invalid API key"**
   - Check API key is correct in `.env`
   - Ensure API key is active (not expired)

2. **"Already Verified"**
   - Contract is already verified ✅
   - This is normal for redeployments

3. **"Compilation failed"**  
   - Contract source doesn't match deployed bytecode
   - Ensure same compiler settings

4. **"Network timeout"**
   - Block explorer is overloaded
   - Automatic retry will attempt verification again

5. **"Rate limited"**
   - Too many requests to block explorer API
   - Wait and try manual verification later

### Debug Tips

```bash
# Test verification setup
npx hardhat run scripts/test-verification.ts --network polygonMumbai

# Verify specific contract manually
npx hardhat verify --network polygon 0xCONTRACT_ADDRESS

# Check network configuration
npx hardhat console --network polygon
```

## 📁 File Outputs

After deployment, these files are created:

- `deployments/deployment-{timestamp}.json` - Full deployment data
- `deployments/verification-instructions-{timestamp}.txt` - Manual verification commands (if needed)

## 🔐 Security Considerations

1. **Private Keys**: Never commit private keys to version control
2. **API Keys**: Keep API keys secure, they're free but rate-limited
3. **Mainnet Deployment**: Double-check all configurations before mainnet deployment
4. **Gas Costs**: Monitor gas prices, especially on Ethereum mainnet

## 📞 Support

If you encounter issues:

1. Check the troubleshooting section above
2. Review deployment logs for specific errors
3. Test on testnets first (Mumbai, Sepolia)
4. Verify API keys are correctly configured

## 🎯 Quick Start Example

```bash
# 1. Setup environment
cp env.example .env
# Edit .env with your keys

# 2. Install and compile
npm install
npm run compile

# 3. Test verification
npx hardhat run scripts/test-verification.ts --network polygonMumbai

# 4. Deploy to mainnet
npx hardhat run scripts/deploy.ts --network polygon
```

All contracts will be automatically verified and ready for use! 🚀
