# Alchemy API Setup Guide

This guide shows you how to configure the Alchemy API to fetch real ERC-20 token balances in your wallet.

## 1. Get Your Alchemy API Key

1. Visit [Alchemy Dashboard](https://dashboard.alchemy.com/)
2. Sign up or log in to your account
3. Create a new app:
   - **Name**: Your app name
   - **Description**: Optional description
   - **Chain**: Ethereum
   - **Network**: Mainnet (or Sepolia for testing)
4. Copy your API key from the dashboard

## 2. Configure Environment Variables

Create a `.env.local` file in your project root and add:

```bash
# App Configuration
NODE_ENV=development
APP_URL=http://localhost:3000

# Supabase Configuration
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Authentication
AUTH_SECRET=your-auth-secret
AUTH_EXPIRES_IN=7d

# API Configuration
API_KEY=your-api-key
API_URL=https://api.example.com

# Alchemy API for ERC-20 Token Balances
ALCHEMY_API_KEY=your-alchemy-api-key-here

# Feature Flags
ENABLE_FEATURE_X=false
DEBUG_MODE=false
```

## 3. Replace the API Key

Replace `your-alchemy-api-key-here` with your actual Alchemy API key from step 1.

## 4. Features

With the Alchemy API configured, the wallet will:

- ✅ Fetch real ERC-20 token balances from the blockchain
- ✅ Display token names, symbols, and logos
- ✅ Show formatted balances with proper decimal places
- ✅ Calculate USD values using CoinGecko price data
- ✅ Display 24-hour price changes
- ✅ Support up to 20 tokens per wallet
- ✅ Fallback to direct contract calls if Alchemy fails

## 5. API Limits

- **Free Tier**: 300 requests per second
- **Growth Tier**: 2,000 requests per second
- **Scale Tier**: Custom limits

## 6. Supported Networks

The current implementation supports:
- Ethereum Mainnet
- Can be extended to support other networks (Polygon, Arbitrum, etc.)

## 7. Troubleshooting

If you're not seeing real token balances:

1. Check that your `.env.local` file is in the project root
2. Verify your Alchemy API key is correct
3. Ensure your wallet is connected and on the correct network
4. Check the browser console for any API errors
5. Try refreshing the token list using the refresh button

The system will automatically fall back to mock data or direct contract calls if the Alchemy API is unavailable. 