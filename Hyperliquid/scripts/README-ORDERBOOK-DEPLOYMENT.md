# OrderBook Market Deployment Scripts

This directory contains scripts for deploying and managing OrderBook markets using the HyperLiquid OrderBookFactoryMinimal contract.

## 🏭 Contract Addresses (Polygon Mainnet)

- **OrderBookFactoryMinimal**: [`0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75`](https://polygonscan.com/address/0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75)
- **VaultRouter**: [`0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7`](https://polygonscan.com/address/0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7)
- **Existing Market (Aluminum V1)**: [`0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE`](https://polygonscan.com/address/0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE)

## 📋 Available Scripts

### 1. `create-single-market.ts` - Create One Market

Creates a single OrderBook market using the factory contract.

**Usage:**
```bash
npx hardhat run scripts/create-single-market.ts --network polygon
```

**Configuration:**
Edit the `MARKET_CONFIG` object in the script:
```typescript
const MARKET_CONFIG = {
  symbol: "SILVER/USD",  // Change this to your desired symbol
  description: "Silver futures market with price discovery"
};
```

**Requirements:**
- You must be the factory owner (`0x1Bc0a803de77a004086e6010cD3f72ca7684e444`)
- Account must have at least 0.1 MATIC for creation fee
- Symbol must be unique (not already exist)

### 2. `deploy-orderbook-markets.ts` - Batch Market Creation

Advanced script for deploying multiple markets at once with comprehensive error handling.

**Usage:**
```bash
npx hardhat run scripts/deploy-orderbook-markets.ts --network polygon
```

**Features:**
- Deploy multiple markets in one run
- Comprehensive error handling
- Gas estimation and optimization
- Factory statistics display
- Automatic conflict detection

### 3. `query-factory-markets.ts` - Inspect Existing Markets

Query and inspect all markets created by the factory.

**Usage:**
```bash
npx hardhat run scripts/query-factory-markets.ts --network polygon
```

**Output:**
- Factory information and settings
- List of all created markets
- OrderBook contract details
- Symbol lookup tests
- Contract statistics

## 🔧 How OrderBook Market Creation Works

### OrderBookFactoryMinimal Interface

The factory contract supports **traditional markets only** (no custom metrics):

```solidity
function createTraditionalMarket(string memory symbol) 
    external 
    payable
    onlyOwner
    returns (bytes32 marketId)
```

### Market Creation Process

1. **Connect to Factory**: Script connects to the deployed factory contract
2. **Verify Permissions**: Check if caller is the factory owner
3. **Pay Creation Fee**: Send 0.1 MATIC as market creation fee
4. **Deploy OrderBook**: Factory deploys a new OrderBook contract
5. **Register Market**: Market is registered in factory with unique ID
6. **Return Details**: Get market ID and OrderBook address from events

### Generated Market ID

Markets are identified by:
```typescript
marketId = keccak256(abi.encodePacked(symbol, "_MARKET"))
```

Example: `"ETH/USD"` → `0x1234...abcd` (deterministic)

## 🚀 Quick Start

1. **Query existing markets:**
   ```bash
   npx hardhat run scripts/query-factory-markets.ts --network polygon
   ```

2. **Create a new market:**
   ```bash
   # Edit MARKET_CONFIG in create-single-market.ts first
   npx hardhat run scripts/create-single-market.ts --network polygon
   ```

3. **Verify on Polygonscan:**
   - Check transaction hash in output
   - Verify OrderBook contract is deployed
   - Check factory statistics

## ⚠️ Important Notes

### Access Control
- **Only the factory owner** can create markets
- Current owner: `0x1Bc0a803de77a004086e6010cD3f72ca7684e444`
- Use the correct private key in your hardhat config

### Symbol Requirements
- Must be unique across all markets
- Cannot be empty string
- Max 20 characters (factory limit)
- Case sensitive

### Costs
- **Creation Fee**: 0.1 MATIC per market
- **Gas Cost**: ~2-3M gas per market (~0.02 MATIC at 30 gwei)
- **Total Cost**: ~0.12 MATIC per market

### Network Configuration
Always use `--network polygon` for mainnet deployment:

```javascript
// hardhat.config.ts
networks: {
  polygon: {
    url: "https://polygon-rpc.com/",
    accounts: [process.env.PRIVATE_KEY]
  }
}
```

## 🛠️ Troubleshooting

### Common Errors

**"Ownable: caller is not the owner"**
- Solution: Use the factory owner's private key

**"Market exists"**
- Solution: Check existing markets with query script, use different symbol

**"Insufficient fee"**
- Solution: Ensure account has at least 0.1 MATIC

**"UNPREDICTABLE_GAS_LIMIT"**
- Solution: Check network connection, contract status, permissions

### Verification

After creating a market, verify:
1. ✅ Transaction confirmed on Polygonscan
2. ✅ OrderBook contract deployed and verified
3. ✅ Market appears in factory query results
4. ✅ Symbol lookup returns correct market ID

## 📞 Support

For issues with these scripts:
1. Check the factory owner address matches your account
2. Verify network configuration (polygon mainnet)
3. Ensure sufficient MATIC balance
4. Run query script to check factory status
5. Check Polygonscan for transaction details

## 🔗 Useful Links

- [Factory Contract](https://polygonscan.com/address/0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75)
- [VaultRouter Contract](https://polygonscan.com/address/0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7)
- [HyperLiquid Documentation](../docs/)
- [Polygon Network Status](https://status.polygon.technology/)
