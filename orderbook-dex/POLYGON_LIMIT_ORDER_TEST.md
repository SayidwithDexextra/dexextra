# $10 Limit Order Test on Live Polygon Contracts

This guide explains how to run a test that places a $10 limit order on the live Polygon mainnet contracts.

## 🚀 Quick Start

### 1. Setup Environment

1. Copy the environment template:
   ```bash
   cp polygon-test.env .env
   ```

2. Edit `.env` and add your private key:
   ```bash
   PRIVATE_KEY=your_private_key_without_0x_prefix
   ```

### 2. Install Dependencies (if not already done)

```bash
npm install
```

### 3. Run the Test

```bash
npx hardhat run scripts/test-live-polygon-limit-order.ts --network polygon
```

## 📋 What the Test Does

1. **Connects to Polygon mainnet** and verifies the network
2. **Loads live contracts** using deployed addresses
3. **Checks balances** and mints test USDC if needed
4. **Deposits to vault** to ensure sufficient collateral
5. **Analyzes the Silver V1 market** to determine optimal order price
6. **Places a $10 BUY limit order** on the Silver market
7. **Verifies the order** was successfully placed on-chain

## 📊 Contract Addresses Used

| Contract | Address | Description |
|----------|---------|-------------|
| **MetricsMarketFactory** | `0x354f188944eF514eEEf05d8a31E63B33f87f16E0` | Factory for creating markets |
| **CentralVault** | `0x9E5996Cb44AC7F60a9A46cACF175E87ab677fC1C` | Collateral management |
| **OrderRouter** | `0x516a1790a04250FC6A5966A528D02eF20E1c1891` | Order matching engine |
| **MockUSDC** | `0xff541e2AEc7716725f8EDD02945A1Fe15664588b` | Test USDC token |
| **Silver V1 Market** | `0x07d317C87E6d8AF322463aCF024f1e28D38F6117` | Target market for testing |

## 🎯 Test Market: Silver V1

- **Market ID**: `SILVER_V1`
- **Description**: Premium Silver Price Tracking Market
- **Category**: Commodities
- **Starting Price**: $10.00
- **Settlement Date**: September 28, 2025

## 💰 Prerequisites

- **Polygon MATIC**: Small amount for gas fees (~$0.10-0.50)
- **MockUSDC**: The script will attempt to mint test USDC
- **Wallet setup**: Private key configured in `.env`

## 📋 Expected Output

```
🚀 Starting $10 Limit Order Test on Live Polygon Contracts
======================================================
📋 Using account: 0x1234...
✅ Connected to Polygon mainnet

📦 Loading contracts...
✅ All contracts loaded successfully

💰 Checking balances...
USDC Balance: 10000.0 USDC
Vault Balance: 15.0 USDC

🔍 Checking Silver V1 market...
✅ Market found at: 0x07d317C87E6d8AF322463aCF024f1e28D38F6117
Market Status: ✅ Active
Best Bid: 9.5 ETH
Best Ask: 10.2 ETH

📊 Preparing $10 limit order...
Order Price: 9.18 ETH
Order Quantity: 1.089325 units
Order Value: $10.00

🎯 Placing limit order...
Transaction submitted: 0xabc123...
⏳ Waiting for confirmation...
✅ Order placed successfully!
📋 Order ID: 12345

🎉 SUCCESS: $10 limit order test completed!
======================================
✅ Order ID: 12345
✅ Transaction: 0xabc123...
✅ Order Value: $10.00 USDC
✅ Order Type: BUY Limit
✅ Price: 9.18 ETH
```

## 🔧 Troubleshooting

### Common Issues

1. **"Wrong network" error**
   - Ensure you're using `--network polygon`
   - Check your RPC URL in `.env`

2. **"Insufficient funds" error**
   - Add MATIC to your wallet for gas fees
   - The script will try to mint test USDC automatically

3. **"Market is paused" error**
   - The market may be temporarily paused
   - Try again later or check market status

4. **Private key issues**
   - Ensure your private key is correct and without `0x` prefix
   - Never commit your `.env` file to version control

### Gas Estimation

- **Typical gas cost**: 200,000-500,000 gas units
- **At 30 Gwei**: ~$0.30-0.75 USD
- **Current Polygon gas**: Usually much lower

## 🔗 Verification

After successful execution, you can verify the transaction on:
- **Polygonscan**: https://polygonscan.com/tx/YOUR_TX_HASH
- **Order Book Events**: Check for `OrderPlaced` events
- **Market State**: View updated order book on the market contract

## ⚠️ Important Notes

- This is a **test environment** using MockUSDC
- Orders are placed on **live contracts** but with test tokens
- The Silver market is **real** and functional
- **Gas fees** are paid in real MATIC
- **Never expose** your private key

## 🧹 Cleanup

The test script is read-only and doesn't modify core contracts. The only changes are:
- Potential USDC minting (if you're the token owner)
- Vault deposit of test USDC
- Placement of a limit order

To cancel the order later, you can use the `cancelOrder` function with the returned order ID.
