# Minimum Order Size Management

This document explains how to manage minimum order sizes for markets using the MetricsMarketFactory contract.

## Overview

The MetricsMarketFactory contract requires that minimum order sizes be greater than 0 for validation purposes. However, to effectively allow any order size (equivalent to setting it to 0), we can set it to the smallest possible value: 1 wei.

## Scripts

### `set-minimum-order-size-to-zero.ts`

Sets the minimum order size to 1 wei (effectively 0) for a specific metric.

#### Usage

```bash
# Set minimum order size to effectively 0 for the default metric (SILVER_V1)
npx hardhat run scripts/set-minimum-order-size-to-zero.ts --network polygon

# Set minimum order size to effectively 0 for a custom metric
npx hardhat run scripts/set-minimum-order-size-to-zero.ts --network polygon -- "YOUR_METRIC_ID"
```

#### Prerequisites

1. **Admin Role**: The caller must have `FACTORY_ADMIN_ROLE` on the MetricsMarketFactory contract
2. **MATIC Balance**: Sufficient MATIC for gas fees
3. **Market Exists**: The target metric must have an existing market

#### Configuration

- **Factory Address**: `0x354f188944eF514eEEf05d8a31E63B33f87f16E0` (Polygon Mainnet)
- **Default Metric**: `SILVER_V1`
- **New Minimum Order Size**: `1` wei (effectively 0)

#### What the Script Does

1. **Validation**: Checks if the target market exists
2. **Current State**: Displays current market configuration
3. **Gas Estimation**: Estimates transaction gas cost
4. **Update**: Calls `updateMarketParameters()` with 1 wei minimum order size
5. **Verification**: Confirms the update was successful

#### Example Output

```
🔧 Setting minimum order size to effectively 0 (1 wei)...
📊 Target Metric: SILVER_V1
🏭 Factory Address: 0x354f188944eF514eEEf05d8a31E63B33f87f16E0
👤 Admin/Caller: 0x1Bc0a803de77a004086e6010cD3f72ca7684e444
💰 Caller Balance: 2.5 MATIC

📋 Current market configuration:
{
  metricId: 'SILVER_V1',
  description: 'Premium Silver Price Tracking Market',
  decimals: 8,
  currentMinimumOrderSize: '1000000000',
  minimumOrderSizeFormatted: '10.0',
  settlementDate: '2025-09-28T00:00:00.000Z',
  tradingEndDate: '2025-09-27T00:00:00.000Z'
}

⚙️ Updating minimum order size from 1000000000 to 1 (1 wei)...
⛽ Estimated gas: 45000
📤 Transaction sent: 0x1234...5678
✅ Transaction confirmed in block: 12345678
⛽ Gas used: 42000

🎉 SUCCESS: Minimum order size has been set to effectively 0 (1 wei)!
📈 This means any order size will be accepted by the market.
```

### Error Handling

The script includes comprehensive error handling for common issues:

- **Access Control**: Verifies admin role permissions
- **Market Existence**: Checks if the target metric exists
- **Gas Estimation**: Prevents failed transactions due to gas issues
- **Balance Verification**: Ensures sufficient MATIC for transaction fees

### Alternative: Custom Minimum Order Size

If you want to set a different minimum order size (not effectively 0), you can modify the script or use the existing `update-silver-min-order.ts` script as a template.

## Contract Validation

Both the MetricsMarketFactory and OrderBook contracts enforce `minimumOrderSize > 0`:

- **MetricsMarketFactory.sol** (line 292): `require(minimumOrderSize > 0, "MetricsMarketFactory: Invalid min order size");`
- **OrderBook.sol** (line 410): `require(_minOrderSize > 0, "OrderBook: Invalid min order size");`

This is why we use 1 wei instead of 0 - it satisfies the validation while being practically equivalent to no minimum order size.

## Security Considerations

- Only addresses with `FACTORY_ADMIN_ROLE` can update market parameters
- The script includes validation to prevent accidental execution on non-existent markets
- Gas estimation helps prevent failed transactions
- The script verifies the update was successful before completing

## Related Files

- `update-silver-min-order.ts` - Example script for setting specific minimum order sizes
- `MetricsMarketFactory.sol` - Main factory contract with parameter update functions
- `OrderBook.sol` - Individual market contract that enforces order size limits
- `POLYGON_DEPLOYMENT.md` - Deployment addresses and configuration
