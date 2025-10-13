# HyperLiquid MockUSDC Faucet Testing Guide

## Overview
The faucet has been upgraded to use the new HyperLiquid MockUSDC deployment on Polygon mainnet.

## Contract Information
- **MockUSDC Address**: `0xA2258Ff3aC4f5c77ca17562238164a0205A5b289`
- **Network**: Polygon Mainnet (Chain ID: 137)
- **Status**: ✅ Verified on Polygonscan

## Testing Steps

### 1. Connect Wallet
- Click "Connect Wallet" button
- Ensure you're on Polygon Mainnet
- If on wrong network, click "Switch Network"

### 2. Check Current Balance
- Your current MockUSDC balance will display
- Balance updates automatically after claiming

### 3. Claim Tokens
1. Enter amount to claim (up to 1,000,000 USDC)
2. Click "Claim [amount] USDC" button
3. Confirm transaction in wallet
4. Wait for blockchain confirmation
5. Balance updates automatically

### 4. Use for Trading
- Navigate to Aluminum V1 futures market
- Use claimed MockUSDC as collateral via VaultRouter
- Test HyperLiquid trading features

## Error Handling
The faucet includes comprehensive error handling for:
- Wrong network detection
- Invalid amounts
- Transaction failures
- Network connectivity issues

## Contract Integration
The faucet uses:
- `CONTRACTS.MockUSDC.address` from updated contract config
- Standard ERC-20 `mint()` function
- Real blockchain transactions (no simulation)

## Verification
1. Check balance before/after claiming
2. Verify transaction on Polygonscan
3. Confirm tokens can be used in VaultRouter deposits
4. Test Aluminum V1 futures trading functionality

Last Updated: September 1, 2025
