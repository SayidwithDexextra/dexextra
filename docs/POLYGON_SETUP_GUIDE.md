# Polygon Mainnet Setup Guide

This guide will help you configure DexExtra to work with **Polygon Mainnet** and resolve RPC connection errors.

## Quick Fix for RPC Errors

If you're seeing "Internal RPC error - possibly network issue", it's because the app is trying to connect to a local blockchain that isn't running. Follow these steps:

### Step 1: Create Environment File

Create a `.env.local` file in your project root with these settings:

```env
# Polygon Mainnet Configuration
DEFAULT_NETWORK=polygon
RPC_URL=https://polygon-rpc.com/
WS_RPC_URL=wss://polygon-rpc.com/
CHAIN_ID=137

# Supabase (for image uploads - replace with your values)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Basic app config
NODE_ENV=development
APP_URL=http://localhost:3000
AUTH_SECRET=your-secret-key-here
```

### Step 2: Switch Your Wallet to Polygon

1. **Open your wallet** (MetaMask, etc.)
2. **Click the network dropdown** (usually shows "Ethereum Mainnet")
3. **Select "Polygon Mainnet"** or **"Add Network"** if not available
4. **Use these network details:**
   - **Network Name:** Polygon Mainnet
   - **RPC URL:** `https://polygon-rpc.com/`
   - **Chain ID:** `137`
   - **Currency Symbol:** `MATIC`
   - **Block Explorer:** `https://polygonscan.com/`

### Step 3: Get MATIC Tokens

You'll need MATIC tokens for transactions on Polygon:

- **Buy on Exchange:** Buy MATIC on Binance, Coinbase, etc.
- **Bridge from Ethereum:** Use [Polygon Bridge](https://wallet.polygon.technology/polygon/bridge)
- **Faucet (small amounts):** Use [Polygon Faucet](https://faucet.polygon.technology/) for testing

## Alternative RPC Providers

For better reliability, consider using these RPC providers:

### Alchemy (Recommended)

```env
# Get API key from https://alchemy.com
ALCHEMY_API_KEY=your-alchemy-api-key
RPC_URL=https://polygon-mainnet.g.alchemy.com/v2/your-alchemy-api-key
WS_RPC_URL=wss://polygon-mainnet.g.alchemy.com/v2/your-alchemy-api-key
```

### Infura

```env
# Get API key from https://infura.io
INFURA_API_KEY=your-infura-api-key
RPC_URL=https://polygon-mainnet.infura.io/v3/your-infura-api-key
```

### Public RPCs (Free, but rate-limited)

```env
# Polygon official RPC
RPC_URL=https://polygon-rpc.com/

# Alternative public RPCs
RPC_URL=https://rpc-mainnet.matic.network/
RPC_URL=https://rpc-mainnet.maticvigil.com/
RPC_URL=https://polygonapi.terminet.io/rpc
```

## Using the Network Selector

The app now includes a **Network Selector** in the vAMM Wizard:

1. **Go to Create Market → Step 4** (Review & Deploy)
2. **Use the Network Selector** to switch to Polygon Mainnet
3. **Your wallet will prompt** you to switch networks
4. **Approve the switch** and you're ready to go!

## Complete Environment Template

Here's a complete `.env.local` template for Polygon Mainnet:

```env
# DexExtra Environment Configuration

# App Configuration
NODE_ENV=development
APP_URL=http://localhost:3000

# Blockchain Configuration (Polygon Mainnet)
DEFAULT_NETWORK=polygon
RPC_URL=https://polygon-rpc.com/
WS_RPC_URL=wss://polygon-rpc.com/
CHAIN_ID=137

# Supabase Configuration (Required for image uploads)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Optional: Alchemy API for better reliability
# ALCHEMY_API_KEY=your-alchemy-api-key

# Contract Addresses (will be set after deployment)
# VAMM_FACTORY_ADDRESS=
# MOCK_USDC_ADDRESS=
# MOCK_ORACLE_ADDRESS=

# Event Listener Configuration
EVENT_LISTENER_ENABLED=true
EVENT_BATCH_SIZE=1000
EVENT_CONFIRMATIONS=1
EVENT_RETRY_ATTEMPTS=3
EVENT_RETRY_DELAY=5000

# Authentication
AUTH_SECRET=change-this-in-production-to-a-random-secret
AUTH_EXPIRES_IN=7d

# External Services
API_KEY=placeholder-api-key
API_URL=https://api.example.com

# Feature Flags
DEBUG_MODE=false
ENABLE_FEATURE_X=false
```

## Network Comparison

| Network | Chain ID | Currency | Avg Gas Fee | Transaction Speed |
|---------|----------|----------|-------------|-------------------|
| **Polygon Mainnet** ⭐ | 137 | MATIC | ~$0.01 | 2-3 seconds |
| Ethereum Mainnet | 1 | ETH | ~$10-50 | 15-60 seconds |
| Polygon Mumbai (Test) | 80001 | MATIC | Free | 2-3 seconds |

## Why Choose Polygon?

✅ **Ultra-low fees** (~$0.01 per transaction)  
✅ **Fast transactions** (2-3 second confirmation)  
✅ **Ethereum compatible** (same tools and contracts)  
✅ **Growing ecosystem** (DeFi, NFTs, Gaming)  
✅ **Environmental friendly** (Proof of Stake)  

## Troubleshooting

### Still Getting RPC Errors?

1. **Check your internet connection**
2. **Try a different RPC URL** from the list above
3. **Use the built-in diagnostics:**
   - Go to Step 4 of vAMM Wizard
   - Click "Run Diagnostics" button
   - Check browser console for details

### Wallet Not Connecting?

1. **Make sure wallet is unlocked**
2. **Try refreshing the page**
3. **Switch to Polygon network manually**
4. **Check if site is connected** in wallet settings

### Transaction Failures?

1. **Ensure you have MATIC** for gas fees
2. **Check if contracts are deployed** on Polygon
3. **Verify network configuration** in wallet

## Advanced Configuration

### Custom RPC Setup

```env
# For enterprise or custom setups
RPC_URL=https://your-custom-polygon-rpc.com/
WS_RPC_URL=wss://your-custom-polygon-rpc.com/
```

### Multiple Network Support

The app supports switching between networks on-the-fly:

- **Polygon Mainnet** (recommended)
- **Ethereum Mainnet** (higher fees)
- **Polygon Mumbai** (testnet)
- **Hardhat Local** (development)

### Contract Deployment

When deploying contracts to Polygon:

```bash
# Deploy to Polygon Mainnet
npx hardhat run scripts/deploy.js --network polygon

# Deploy to Mumbai testnet
npx hardhat run scripts/deploy.js --network mumbai
```

## Getting Help

If you're still experiencing issues:

1. **Check the browser console** (F12) for detailed error messages
2. **Run the wallet diagnostics** in the app
3. **Verify your environment configuration**
4. **Try using a different RPC provider**
5. **Make sure you have MATIC tokens** for gas fees

## Useful Links

- **Polygon Official Site:** https://polygon.technology/
- **Polygon Bridge:** https://wallet.polygon.technology/
- **Polygon Faucet:** https://faucet.polygon.technology/
- **PolygonScan Explorer:** https://polygonscan.com/
- **Alchemy (RPC Provider):** https://alchemy.com/
- **Infura (RPC Provider):** https://infura.io/

---

**Need more help?** The app includes built-in diagnostics and network switching tools to make the setup process as smooth as possible! 🚀 