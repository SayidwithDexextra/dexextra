# Trading Troubleshooting Guide

## Short Position Transaction Revert Issues

If you're experiencing transaction reverts when trying to open short positions, this guide will help you identify and fix the issue.

### Common Symptoms
- Console error: "transaction execution reverted"
- Transaction fails with empty data field
- Works for long positions but fails for short positions
- Oracle-related errors in the console

### 1. Oracle Issues (Most Common)

The mock oracle has a maximum price age of 1 hour. If the price hasn't been updated recently, transactions will fail.

#### Quick Fix:
```bash
cd DexContracts
npx hardhat run scripts/debug_oracle.js --network localhost
```

#### Manual Fix:
```bash
# Update oracle price manually
cd DexContracts
npx hardhat run scripts/update_oracle_price.js --network localhost <ORACLE_ADDRESS>
```

### 2. Check Oracle Status

Open the browser console and look for these debug messages:
```javascript
🔮 Checking oracle status...
isActive: true/false
maxPriceAge: 3600 (seconds)
markPrice: "2000.0"
```

If `isActive` is `false`, the oracle needs to be refreshed.

### 3. Price Slippage Issues

For short positions, check the price bounds in the console:
```javascript
🩳 Short position debug:
markPrice: 2000.0
slippage: 0.5
minPrice: 0
maxPrice: 2010.0
```

The current contract price must be within these bounds.

### 4. Troubleshooting Steps

#### Step 1: Check Contract State
```javascript
// In browser console
console.log("Oracle Active:", vammTrading.isActive);
console.log("Mark Price:", vammTrading.markPrice);
console.log("Available Margin:", vammTrading.marginAccount?.availableMargin);
```

#### Step 2: Check Network Connection
Make sure your local blockchain is running:
```bash
npx hardhat node
```

#### Step 3: Redeploy if Needed
If contracts are corrupted or outdated:
```bash
cd DexContracts
npx hardhat run scripts/deploy_and_create_market.js --network localhost
```

#### Step 4: Check Wallet Balance
Ensure you have enough USDC and ETH:
```bash
cd DexContracts
npx hardhat run scripts/check-balance.js --network localhost
```

### 5. Error Message Guide

| Error Message | Cause | Solution |
|---------------|-------|----------|
| "Oracle: inactive" | Oracle is disabled | Run `debug_oracle.js` |
| "Oracle: price too old" | Oracle price is stale | Update oracle price |
| "vAMM: price slippage" | Price moved beyond tolerance | Increase slippage or wait |
| "vAMM: paused" | Trading is paused | Contact admin to unpause |
| "Vault: insufficient margin" | Not enough collateral | Deposit more USDC |
| "vAMM: invalid leverage" | Leverage out of range | Use 1x-100x leverage |

### 6. Prevention Tips

1. **Keep Oracle Fresh**: Set up a cron job to refresh oracle prices every 30 minutes
2. **Use Reasonable Slippage**: Set slippage to 0.5% - 2% for volatile markets
3. **Monitor Margin**: Keep sufficient collateral in your margin account
4. **Check Contract Status**: Verify contracts are deployed and active

### 7. Advanced Debugging

For developers, you can add additional logging:

```javascript
// In TradingPanel.tsx, add this before opening position:
console.log("🔍 Pre-trade checks:");
console.log("- Oracle active:", vammTrading.isActive);
console.log("- Mark price:", vammTrading.markPrice);
console.log("- Position type:", selectedOption);
console.log("- Amount:", amount);
console.log("- Leverage:", leverage);
console.log("- Available margin:", vammTrading.marginAccount?.availableMargin);
```

### 8. Emergency Recovery

If all else fails:
1. Stop the local blockchain
2. Delete the `DexContracts/cache` folder
3. Restart the blockchain: `npx hardhat node`
4. Redeploy contracts: `npx hardhat run scripts/deploy_and_create_market.js --network localhost`
5. Update the frontend with new contract addresses

### 9. Getting Help

If you're still experiencing issues:
1. Check the console for specific error messages
2. Copy the full error stack trace
3. Note the exact steps that led to the error
4. Share your network configuration and contract addresses

This should resolve most short position trading issues! 