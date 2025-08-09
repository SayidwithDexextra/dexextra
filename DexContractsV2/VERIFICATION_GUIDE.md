# Smart Contract Verification Guide for DexContractsV2

This guide explains how to verify your smart contracts on Polygonscan (and other block explorers) using the automated verification system.

## 🚀 Quick Start

### 1. Environment Setup

1. Copy the example environment file:
```bash
cp env.example .env
```

2. Add your API keys to `.env`:
```bash
# Required for deployment
ALCHEMY_API_KEY=your_alchemy_api_key_here
PRIVATE_KEY=your_private_key_here

# Required for verification
POLYGONSCAN_API_KEY=your_polygonscan_api_key_here
ETHERSCAN_API_KEY=your_etherscan_api_key_here
```

### 2. Get Your API Keys

- **Polygonscan API Key**: Visit [polygonscan.com/apis](https://polygonscan.com/apis) and create a free account
- **Etherscan API Key**: Visit [etherscan.io/apis](https://etherscan.io/apis) (for Ethereum networks)
- **Alchemy API Key**: Visit [alchemy.com](https://alchemy.com) for RPC endpoints

### 3. Verification Methods

## 📋 Method 1: Automatic Verification (Recommended)

Deploy contracts with automatic verification:

```bash
# Deploy and verify all contracts on Polygon
npx hardhat run scripts/deployWithVerification.js --network polygon

# Deploy and verify on Sepolia testnet
npx hardhat run scripts/deployWithVerification.js --network sepolia
```

## 🔍 Method 2: Verify Existing Contracts

### Verify All Contracts from Deployment File

```bash
# Verify all contracts from deployment artifacts
npx hardhat run scripts/verifyContracts.js --network polygon
```

### Quick Verify Single Contract

```bash
# Interactive mode
npx hardhat run scripts/quickVerify.js --network polygon

# Or with environment variables
CONTRACT_ADDRESS=0x1234... CONTRACT_NAME=CentralizedVault npx hardhat run scripts/quickVerify.js --network polygon
```

### Manual Verification with Constructor Args

```bash
CONTRACT_ADDRESS=0x1234... \
CONTRACT_NAME=CentralizedVault \
CONSTRUCTOR_ARGS='["0xUSDC_ADDRESS"]' \
npx hardhat run scripts/quickVerify.js --network polygon
```

## 🛠️ Method 3: Using Hardhat Verify Directly

For advanced users, you can use Hardhat's verify command directly:

```bash
# Basic verification
npx hardhat verify --network polygon 0x_CONTRACT_ADDRESS

# With constructor arguments
npx hardhat verify --network polygon 0x_CONTRACT_ADDRESS "arg1" "arg2"

# Specify contract path (for contracts with same name)
npx hardhat verify --network polygon 0x_CONTRACT_ADDRESS --contract contracts/core/CentralizedVault.sol:CentralizedVault
```

## 📁 Verification Scripts Overview

### `scripts/verifyContracts.js`
- **Purpose**: Comprehensive verification script for all contracts
- **Features**: Auto-detects constructor arguments, supports multiple deployment files, retry logic
- **Usage**: Best for verifying complete deployments

### `scripts/deployWithVerification.js`
- **Purpose**: Deploy and verify contracts in one go
- **Features**: Automatic verification after deployment, gas optimization, deployment tracking
- **Usage**: Best for new deployments

### `scripts/quickVerify.js`
- **Purpose**: Quick verification of individual contracts
- **Features**: Interactive prompts, environment variable support, predefined configurations
- **Usage**: Best for verifying single contracts or troubleshooting

## 🔧 Configuration

### Constructor Argument Patterns

The verification scripts automatically detect constructor arguments for common contracts:

```javascript
const constructorPatterns = {
  'CentralizedVault': (data) => [data.usdcAddress],
  'MetricVAMM': (data) => [data.vault, data.oracle, data.metricId, data.startingPrice],
  'MetricRegistry': (data) => [data.owner],
  // ... more patterns
};
```

### Network Configuration

Verification is supported on:
- **Polygon Mainnet** (`--network polygon`)
- **Ethereum Sepolia** (`--network sepolia`)
- **Ethereum Mainnet** (`--network mainnet`)

## 📝 Deployment File Formats

The verification scripts support multiple deployment file formats:

### Format 1: Simple Address Mapping
```json
{
  "CentralizedVault": "0x1234...",
  "MetricRegistry": "0x5678...",
  "Router": "0x9abc..."
}
```

### Format 2: Detailed Contract Info
```json
{
  "CentralizedVault": {
    "address": "0x1234...",
    "constructorArgs": ["0xUSDC_ADDRESS"],
    "deploymentTx": "0xabc...",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
}
```

## 🚨 Troubleshooting

### Common Issues

#### 1. "Already Verified" Error
```
✅ Contract is already verified! This is not an error.
```

#### 2. "Invalid Constructor Arguments" Error
- Check that constructor arguments match the contract's constructor
- Ensure arguments are in the correct order and type
- Use the correct format for addresses (with 0x prefix)

#### 3. "Contract Source Code Not Found" Error
- Ensure the contract was compiled with the same Solidity version
- Check that the contract name and path are correct
- Make sure you're using the correct network

#### 4. API Rate Limiting
- The scripts include automatic delays between verification attempts
- If you hit rate limits, wait a few minutes and try again
- Consider upgrading your block explorer API plan

### Debug Mode

Enable verbose logging by adding environment variable:
```bash
DEBUG=true npx hardhat run scripts/verifyContracts.js --network polygon
```

### Manual Constructor Arguments

If automatic detection fails, you can manually specify constructor arguments:

```bash
# JSON array format
CONSTRUCTOR_ARGS='["0x1234...", "1000000", true]' npx hardhat run scripts/quickVerify.js --network polygon

# Or edit the constructor patterns in the script
```

## 🔐 Security Best Practices

1. **Never commit your `.env` file** - Add it to `.gitignore`
2. **Use environment variables** for sensitive data
3. **Rotate API keys** regularly
4. **Use separate keys** for different environments
5. **Verify contracts immediately** after deployment to prevent tampering

## 📊 Verification Status Tracking

The deployment scripts automatically track verification status:

```javascript
// Verification results are saved to:
// - deployments/polygon-latest.json
// - deployments/deployment-polygon-TIMESTAMP.json
```

## 🌐 Supported Networks

| Network | RPC | Explorer | API Key Required |
|---------|-----|----------|------------------|
| Polygon Mainnet | Alchemy | Polygonscan | POLYGONSCAN_API_KEY |
| Ethereum Sepolia | Alchemy | Etherscan | ETHERSCAN_API_KEY |
| Ethereum Mainnet | Alchemy | Etherscan | ETHERSCAN_API_KEY |

## 🤝 Contributing

To add support for new networks:

1. Update `hardhat.config.js` with network configuration
2. Add network to `SUPPORTED_NETWORKS` array in verification scripts
3. Add explorer URL to `getExplorerUrl()` function
4. Test verification on the new network

## 📚 Additional Resources

- [Hardhat Verification Plugin](https://hardhat.org/plugins/nomiclabs-hardhat-etherscan.html)
- [Polygonscan API Documentation](https://docs.polygonscan.com/)
- [Etherscan API Documentation](https://docs.etherscan.io/)

## ❓ Need Help?

If you encounter issues with contract verification:

1. Check this guide's troubleshooting section
2. Verify your API keys are correct
3. Ensure your contracts compiled successfully
4. Check the block explorer manually to see if verification is actually needed

## 🎯 Quick Commands Reference

```bash
# Deploy and verify everything
npx hardhat run scripts/deployWithVerification.js --network polygon

# Verify existing deployments
npx hardhat run scripts/verifyContracts.js --network polygon

# Quick verify single contract
CONTRACT_ADDRESS=0x... CONTRACT_NAME=CentralizedVault npx hardhat run scripts/quickVerify.js --network polygon

# Manual hardhat verify
npx hardhat verify --network polygon 0x_CONTRACT_ADDRESS "constructor_arg1" "constructor_arg2"
``` 