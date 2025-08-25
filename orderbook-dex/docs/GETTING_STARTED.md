# Getting Started with OrderBook DEX

## Prerequisites

Before you begin, ensure you have the following installed:

- [Node.js](https://nodejs.org/) (v18 or higher)
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)
- [Git](https://git-scm.com/)
- [MetaMask](https://metamask.io/) or another Web3 wallet

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd orderbook-dex
   ```

2. **Install dependencies**
   ```bash
   npm install
   # or
   yarn install
   ```

3. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   
   Edit `.env.local` with your configuration:
   - RPC URLs for different networks
   - Private keys for deployment (testnet only!)
   - API keys for external services

## Development Setup

### 1. Compile Contracts

```bash
npm run compile
```

This will compile all smart contracts and generate TypeScript types.

### 2. Run Tests

```bash
npm run test
```

Run with coverage:
```bash
npm run test:coverage
```

### 3. Local Development Network

Start a local Hardhat network:
```bash
npx hardhat node
```

In another terminal, deploy contracts to local network:
```bash
npm run deploy:localhost
```

## Project Structure

```
orderbook-dex/
├── contracts/           # Smart contracts
│   ├── core/           # Core protocol contracts
│   ├── interfaces/     # Contract interfaces
│   ├── libraries/      # Utility libraries
│   └── mocks/         # Test mocks
├── docs/              # Documentation
├── scripts/           # Deployment scripts
├── tests/             # Test files
└── deployments/       # Deployment artifacts
```

## Core Concepts

### 1. Metrics Markets

Markets are created for trading custom real-world metrics:
- Demographics (population, migration)
- Economics (GDP, inflation)
- Environment (temperature, emissions)
- Technology (adoption rates, hash rates)

### 2. Order Types

Supported order types:
- **Market Orders**: Execute immediately at best available price
- **Limit Orders**: Execute at specified price or better
- **Stop Orders**: Trigger when price reaches stop level
- **Iceberg Orders**: Large orders split into smaller visible portions

### 3. Oracle Integration

The system integrates multiple oracle providers:
- **Chainlink**: Established price feeds
- **UMA**: Optimistic oracle for custom metrics
- **Band Protocol**: Cross-chain data aggregation

## Basic Usage

### 1. Creating a Market

```typescript
// Example: Create a world population market
const marketConfig = {
  metricId: "WORLD_POPULATION_2024",
  description: "World population count for 2024",
  oracleProvider: chainlinkAddress,
  decimals: 0,
  minimumOrderSize: ethers.parseEther("0.01"),
  tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
  creationFee: ethers.parseEther("1"),
  requiresKYC: false
};

const tx = await factory.createMarket(marketConfig, {
  value: marketConfig.creationFee
});
```

### 2. Placing Orders

```typescript
// Example: Place a limit buy order
const order = {
  orderId: 0, // Will be assigned
  trader: userAddress,
  metricId: "WORLD_POPULATION_2024",
  orderType: OrderType.LIMIT,
  side: Side.BUY,
  quantity: ethers.parseEther("10"),
  price: ethers.parseEther("8000000000"), // 8 billion
  filledQuantity: 0,
  timestamp: 0, // Will be set by contract
  expiryTime: 0, // GTC order
  status: OrderStatus.PENDING,
  timeInForce: TimeInForce.GTC,
  stopPrice: 0,
  icebergQty: 0,
  postOnly: false,
  metadataHash: ethers.ZeroHash
};

const tx = await router.placeOrder(order);
```

### 3. Checking Market Data

```typescript
// Get market statistics
const stats = await orderBook.getMarketStats();
console.log("Last price:", ethers.formatEther(stats.lastPrice));
console.log("24h volume:", ethers.formatEther(stats.volume24h));

// Get order book depth
const [buyOrders, sellOrders] = await router.getMarketDepth(
  "WORLD_POPULATION_2024",
  10 // depth
);
```

## Testing

### Unit Tests

Run individual contract tests:
```bash
npx hardhat test tests/Factory.test.ts
npx hardhat test tests/Vault.test.ts
npx hardhat test tests/Router.test.ts
```

### Integration Tests

Run full system integration tests:
```bash
npx hardhat test tests/integration/
```

### Gas Reporting

Generate gas usage reports:
```bash
REPORT_GAS=true npm run test
```

## Deployment

### Testnet Deployment

1. **Configure network in `hardhat.config.ts`**
2. **Set up `.env.local` with testnet RPC and private key**
3. **Deploy to testnet:**
   ```bash
   npm run deploy:testnet
   ```

### Mainnet Deployment

⚠️ **Warning**: Mainnet deployment requires careful preparation:

1. **Security audit completion**
2. **Multi-signature wallet setup**
3. **Insurance fund preparation**
4. **Governance token distribution plan**

```bash
npm run deploy:mainnet
```

## Security Considerations

### Development Best Practices

1. **Never commit private keys**
2. **Use testnet for development**
3. **Run security analysis tools:**
   ```bash
   npm run slither  # Static analysis
   npm run mythril  # Symbolic execution
   ```

### Audit Checklist

Before mainnet deployment:
- [ ] External security audit
- [ ] Formal verification of critical functions
- [ ] Stress testing with large datasets
- [ ] Emergency response procedures
- [ ] Insurance fund setup

## Troubleshooting

### Common Issues

1. **Compilation Errors**
   - Check Solidity version compatibility
   - Verify OpenZeppelin version matches

2. **Test Failures**
   - Ensure local network is running
   - Check gas limits in hardhat.config.ts

3. **Deployment Issues**
   - Verify network configuration
   - Check account balance for gas fees

### Getting Help

- Review the [Architecture Documentation](./ARCHITECTURE.md)
- Check the [Plan.md](../Plan.md) for detailed specifications
- Open an issue on the project repository

## Next Steps

1. **Review the complete [Plan.md](../Plan.md)**
2. **Explore the contract interfaces in `contracts/interfaces/`**
3. **Run the test suite to understand system behavior**
4. **Set up a local development environment**
5. **Start with simple market creation and trading flows**

## Contributing

Please read the contributing guidelines and ensure all tests pass before submitting pull requests.

---

*This guide covers the basics of getting started with the OrderBook DEX. For detailed technical specifications, see the Plan.md file.*
