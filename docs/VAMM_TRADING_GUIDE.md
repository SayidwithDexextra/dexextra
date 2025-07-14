# VAMM Trading System Guide

This guide explains how to use the VAMM (Virtual Automated Market Maker) trading system integrated into the DexExtra platform.

## Overview

The VAMM trading system allows users to trade perpetual futures contracts with leverage without requiring traditional order books or liquidity providers. Instead, it uses virtual reserves for price discovery and a funding rate mechanism to keep prices aligned with spot markets.

## Key Features

### 🎯 Virtual AMM Trading
- **No Liquidity Requirements**: Trade without needing actual liquidity pools
- **Price Discovery**: Prices determined by virtual reserve ratios
- **Leverage Trading**: Support for 1x to 50x leverage
- **Long/Short Positions**: Both bullish and bearish positions supported

### 💰 Collateral Management
- **USDC Collateral**: All positions backed by USDC
- **Auto-Deposit**: Automatic collateral deposit when needed
- **Margin Tracking**: Real-time margin and available balance monitoring
- **Risk Management**: Liquidation protection with maintenance margins

### 📊 Advanced Features
- **Funding Rates**: Automatic funding payments to maintain price alignment
- **Slippage Protection**: Configurable slippage tolerance
- **Price Impact**: Real-time price impact calculation
- **Position Tracking**: Comprehensive PnL tracking and position management

## How to Trade

### Step 1: Connect Your Wallet
1. Click "Connect Wallet" in the trading panel
2. Select your preferred wallet provider (MetaMask, WalletConnect, etc.)
3. Ensure you're connected to the Base network

### Step 2: Get USDC Collateral
Before trading, you need USDC as collateral:
- Bridge USDC to Base network
- Or use the faucet for testnet USDC (development only)

### Step 3: Choose Your Trade
1. **Select Direction**: Choose "Long" (bullish) or "Short" (bearish)
2. **Set Position Size**: Enter the USD value of your position
3. **Adjust Leverage**: Use the slider to set leverage (1x-50x)
4. **Review Summary**: Check required collateral and position details

### Step 4: Execute Trade
1. Click the trade button
2. Approve USDC spending (first time only)
3. Confirm collateral deposit (if needed)
4. Confirm position opening transaction
5. Wait for transaction confirmation

## Trading Panel Features

### Position Information
- **Current Positions**: View active long/short positions
- **Entry Price**: Your position's entry price
- **Unrealized PnL**: Current profit/loss
- **Position Size**: Total position value in USD

### Market Data
- **Mark Price**: Current VAMM price
- **Funding Rate**: Current hourly funding rate
- **Oracle Price**: Reference spot price

### Collateral Management
- **Wallet Balance**: Your USDC wallet balance
- **Available Margin**: Margin available for new positions
- **Required Collateral**: Collateral needed for current trade

## Smart Contract Architecture

### Core Contracts

#### vAMM Contract
- **Position Management**: Opening/closing leveraged positions
- **Price Discovery**: Virtual reserve-based pricing
- **Funding Mechanism**: Automatic funding rate calculation
- **Risk Management**: Liquidation and margin requirements

#### Vault Contract
- **Collateral Storage**: Secure USDC collateral management
- **Margin Accounting**: Track user margins and PnL
- **Risk Assessment**: Liquidation eligibility checking
- **Fund Transfers**: Secure deposit/withdrawal handling

#### Factory Contract
- **Market Deployment**: Deploy new trading pairs
- **Market Registry**: Track all available markets
- **Access Control**: Permission management

### Key Functions

#### Opening Positions
```typescript
const tradeParams = {
  amount: 100, // $100 position
  isLong: true, // Long position
  leverage: 10, // 10x leverage
  slippageTolerance: 0.5 // 0.5% slippage
};

await vammTrading.openPosition(tradeParams);
```

#### Closing Positions
```typescript
// Close 100% of position with 0.5% slippage tolerance
await vammTrading.closePosition(100, 0.5);
```

#### Managing Collateral
```typescript
// Deposit $500 USDC as collateral
await vammTrading.depositCollateral(500);

// Withdraw $200 USDC collateral
await vammTrading.withdrawCollateral(200);

// Approve USDC spending
await vammTrading.approveCollateral(1000);
```

## Trading Strategies

### Long Positions
- **When to Use**: Expecting price to increase
- **Profit**: When mark price > entry price
- **Loss**: When mark price < entry price
- **Funding**: Pay funding when positive, receive when negative

### Short Positions
- **When to Use**: Expecting price to decrease
- **Profit**: When mark price < entry price
- **Loss**: When mark price > entry price
- **Funding**: Receive funding when positive, pay when negative

### Leverage Considerations
- **Higher Leverage**: Greater profit potential but higher liquidation risk
- **Lower Leverage**: More conservative, lower liquidation risk
- **Maintenance Margin**: Keep sufficient margin to avoid liquidation

## Risk Management

### Liquidation Protection
- **Maintenance Margin**: 5% minimum margin requirement
- **Liquidation Fee**: 5% penalty on liquidated positions
- **Auto-Liquidation**: Positions automatically closed when undercollateralized

### Position Limits
- **Maximum Leverage**: 50x leverage limit
- **Minimum Position**: No minimum position size
- **Collateral Requirement**: Positions must be properly collateralized

### Funding Costs
- **Funding Rate**: Typically ±0.01% to ±1% per hour
- **Payment Direction**: Depends on premium/discount to spot price
- **Frequency**: Applied continuously, updated hourly

## Troubleshooting

### Common Issues

#### "Insufficient Collateral"
- **Solution**: Deposit more USDC or reduce position size
- **Auto-Fix**: System will prompt for automatic deposit

#### "Transaction Failed"
- **Causes**: Network congestion, insufficient gas, slippage exceeded
- **Solutions**: Increase gas limit, adjust slippage tolerance, retry

#### "Contract Not Deployed"
- **Cause**: Market contract not yet deployed
- **Solution**: Wait for deployment or create market if eligible

### Getting Help
- Check transaction status on Base block explorer
- Verify wallet connection and network
- Ensure sufficient USDC balance
- Contact support for persistent issues

## Advanced Features

### Price Impact Calculation
```typescript
// Get price impact for $1000 long position with 10x leverage
const impact = await vammTrading.getPriceImpact(1000, true, 10);
console.log(`Price impact: ${impact} USD`);
```

### Real-time Updates
The trading panel automatically refreshes every 10 seconds to show:
- Current mark prices
- Position PnL updates
- Funding rate changes
- Margin account status

### Event Monitoring
The system monitors blockchain events for:
- Position opened/closed
- Funding payments
- Liquidations
- Margin updates

## Security Considerations

### Smart Contract Security
- **Audited Contracts**: Core contracts undergo security audits
- **Access Controls**: Role-based permissions for critical functions
- **Emergency Pauses**: Circuit breakers for emergency situations

### User Security
- **Non-Custodial**: Users maintain control of their funds
- **Permission-Based**: Explicit approvals required for all actions
- **Transparent**: All transactions visible on blockchain

### Best Practices
- Never share private keys or seed phrases
- Verify contract addresses before interacting
- Start with small positions to test functionality
- Keep software and wallets updated

## API Integration

### React Hooks
```typescript
import { useVAMMTrading } from '@/hooks/useVAMMTrading';

function TradingComponent({ vammMarket }) {
  const {
    position,
    marginAccount,
    markPrice,
    openPosition,
    closePosition
  } = useVAMMTrading(vammMarket);
  
  // Use trading functionality
}
```

### Direct Contract Interaction
```typescript
import { ethers } from 'ethers';

// Connect to vAMM contract
const vamm = new ethers.Contract(vammAddress, vammABI, signer);

// Open position
await vamm.openPosition(
  collateralAmount,
  isLong,
  leverage,
  minPrice,
  maxPrice
);
```

## Network Information

### Base Network
- **RPC URL**: https://base.blockscout.com/api/eth-rpc
- **Chain ID**: 8453 (Mainnet) / 84531 (Testnet)
- **Native Token**: ETH
- **Block Explorer**: https://base.blockscout.com/

### Contract Addresses
- **vAMM Factory**: `0xDA131D3A153AF5fa26d99ef81c5d0Fc983c47533`
- **Mock USDC**: `0xbD3F940783C47649e439A946d84508503D87976D`
- **Mock Oracle**: `0xB65258446bd83916Bd455bB3dBEdCb9BA106d551`

## Support

For questions, issues, or feature requests:
- GitHub Issues: Submit technical issues
- Documentation: Check this guide for common questions
- Community: Join our Discord/Telegram for community support

---

**Disclaimer**: Trading perpetual futures involves significant risk. Only trade with funds you can afford to lose. Past performance does not guarantee future results. 