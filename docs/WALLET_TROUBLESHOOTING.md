# Wallet Balance Error Troubleshooting

This document addresses the "Error fetching balance: {}" issue and provides comprehensive troubleshooting steps.

## Issue Description

Users were experiencing wallet balance fetch failures with empty error objects `{}`, indicating connection or provider issues.

## Root Causes

The balance fetch errors typically occur due to:

1. **Ethereum Provider Issues**: `window.ethereum` not available or malfunctioning
2. **Network Connectivity**: RPC endpoint unavailable or timeout
3. **Provider Method Support**: Wallet doesn't support required methods
4. **Invalid Parameters**: Malformed addresses or method calls
5. **User Rejection**: User declined wallet permission requests

## Fixes Implemented

### 1. Enhanced Error Handling (`src/lib/wallet.ts`)

**Before:**
```typescript
// Basic error handling
catch (error) {
  console.error('Error fetching balance:', error)
  return '0'
}
```

**After:**
```typescript
// Comprehensive error handling with diagnostics
catch (error: any) {
  console.error('Error fetching balance:', {
    error,
    errorMessage: error?.message,
    errorCode: error?.code,
    address,
    providerAvailable: !!window.ethereum,
    requestMethodAvailable: typeof window.ethereum?.request === 'function'
  })
  
  // Specific error messages
  if (error?.code === 4001) {
    console.error('User rejected the balance request')
  } else if (error?.code === -32603) {
    console.error('Internal RPC error - possibly network issue')
  }
  // ... more specific error handling
}
```

### 2. Input Validation and Pre-checks

Added validation for:
- Provider availability
- Method support
- Valid addresses
- Response validation

### 3. Wallet Diagnostics Function

Created `diagnoseWalletIssues()` function that tests:
- Browser environment and security
- Ethereum provider availability
- Method support (`eth_accounts`, `eth_chainId`, `eth_getBalance`)
- Network connectivity
- Account access permissions

### 4. Improved useWallet Hook (`src/hooks/useWallet.tsx`)

- Added automatic diagnostics on connection failures
- Better error handling in balance refresh
- Graceful degradation (continue with balance='0' on errors)
- Enhanced logging for debugging

### 5. WalletDiagnostics Component

Created `WalletDiagnostics` component that provides:
- One-click diagnostic testing
- User-friendly troubleshooting interface
- Console output for technical details

## Common Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| 4001 | User rejected request | Ask user to approve the request |
| -32603 | Internal RPC error | Check network connection, try different RPC |
| -32602 | Invalid parameters | Verify address format and method parameters |
| -32000 | Invalid input | Check if account is unlocked |

## Troubleshooting Steps

### Step 1: Check Browser Environment
```javascript
// Run in browser console
console.log({
  hasEthereum: !!window.ethereum,
  isSecure: window.isSecureContext,
  protocol: window.location.protocol
})
```

### Step 2: Use Built-in Diagnostics
1. Go to Step 4 of vAMM Wizard (if wallet not connected)
2. Click "Run Diagnostics" in the Wallet Diagnostics section
3. Check browser console (F12) for detailed results

### Step 3: Manual Provider Testing
```javascript
// Test in browser console
if (window.ethereum) {
  // Test accounts
  window.ethereum.request({ method: 'eth_accounts' })
    .then(accounts => console.log('Accounts:', accounts))
    .catch(err => console.error('Accounts error:', err))
  
  // Test chain ID
  window.ethereum.request({ method: 'eth_chainId' })
    .then(chainId => console.log('Chain ID:', chainId))
    .catch(err => console.error('Chain ID error:', err))
}
```

### Step 4: Network and RPC Issues

If you see network-related errors:
1. Check internet connection
2. Try switching to a different network in your wallet
3. Check if the RPC endpoint is responding
4. Try refreshing the page

### Step 5: Wallet-Specific Issues

**MetaMask:**
- Ensure MetaMask is unlocked
- Check if site is connected in MetaMask settings
- Try disconnecting and reconnecting

**Other Wallets:**
- Ensure wallet extension is active
- Check wallet-specific connection settings
- Try switching between different wallet providers

## Environment Configuration

Ensure your environment variables are properly set:

```env
# Required for blockchain connections
RPC_URL=http://localhost:8545  # Or your preferred RPC
WS_RPC_URL=ws://localhost:8545
CHAIN_ID=31337  # Or your target chain

# Optional - for enhanced features
ALCHEMY_API_KEY=your-alchemy-key
```

## Running Diagnostics Programmatically

```typescript
import { diagnoseWalletIssues } from '@/lib/wallet'

// Run diagnostics
await diagnoseWalletIssues()
```

## Balance Display Changes

To avoid external API dependencies, balances are now displayed in ETH instead of USD:
- **Before**: Showed USD value using hardcoded ETH price
- **After**: Shows actual ETH balance with 6 decimal precision
- **Benefit**: Eliminates external API failures, more reliable

## Prevention Tips

1. **Always validate inputs** before making wallet calls
2. **Use try-catch blocks** around all wallet operations
3. **Provide fallback values** (like '0' for balance)
4. **Test with multiple wallets** during development
5. **Handle user rejections gracefully**

## Development Testing

Test wallet functionality with:
```bash
# Run wallet diagnostics
npm run dev
# Go to create-market page, step 4
# Click "Run Diagnostics" if wallet issues occur
```

## Support

If issues persist after following these steps:
1. Run diagnostics and save console output
2. Check browser compatibility (Chrome, Firefox, Edge recommended)
3. Try a different wallet provider
4. Ensure you're on a supported network

## Files Modified

- `src/lib/wallet.ts` - Enhanced error handling and diagnostics
- `src/hooks/useWallet.tsx` - Improved connection management
- `src/components/WalletDiagnostics.tsx` - New diagnostic component
- `src/components/VAMMWizard/steps/Step4ReviewDeploy.tsx` - Added diagnostics UI 