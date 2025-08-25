# Initial Order Feature Guide

## Overview

The OrderBook DEX now supports placing an initial limit order when creating a new market. This solves the "cold start" problem by establishing an immediate price reference point and initial liquidity.

## Benefits

### 1. **Immediate Price Discovery**
- Sets a starting price reference immediately upon market creation
- Eliminates the uncertainty of an empty order book
- Provides price guidance for other traders

### 2. **Bootstrap Liquidity**
- Provides immediate liquidity for the first trade
- Encourages market participation from launch
- Reduces barrier to entry for subsequent traders

### 3. **Market Maker Incentives**
- Rewards market creators with favorable positioning
- Creates natural market-making opportunities
- Aligns creator incentives with market success

## Usage

### Basic Example

```typescript
// Create a market with an initial buy order
const marketConfig = {
  metricId: "WORLD_POPULATION_2025",
  description: "Global population by end of 2025",
  oracleProvider: "0x...",
  decimals: 0,
  minimumOrderSize: ethers.parseEther("1"),
  tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
  creationFee: ethers.parseEther("0.1"),
  requiresKYC: false,
  settlementDate: Math.floor(Date.now() / 1000) + (365 * 24 * 60 * 60), // 1 year
  tradingEndDate: Math.floor(Date.now() / 1000) + (360 * 24 * 60 * 60), // 360 days
  dataRequestWindow: 7 * 24 * 60 * 60, // 7 days
  autoSettle: true,
  
  // Initial order configuration
  initialOrder: {
    enabled: true,
    side: 0, // BUY (0 = BUY, 1 = SELL)
    quantity: ethers.parseEther("100"), // Buy 100 units
    price: ethers.parseEther("8.1"), // At 8.1 billion (scaled)
    timeInForce: 0, // GTC (Good Till Cancelled)
    expiryTime: 0 // Not needed for GTC
  }
};

// Create the market (requires collateral for the initial order)
const tx = await metricsMarketFactory.createMarket(marketConfig, {
  value: ethers.parseEther("0.1") // Creation fee
});
```

### Advanced Example with Expiring Order

```typescript
const futureTime = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60); // 30 days

const marketConfig = {
  // ... other config
  initialOrder: {
    enabled: true,
    side: 1, // SELL
    quantity: ethers.parseEther("50"),
    price: ethers.parseEther("25.5"), // Sell at $25.5T GDP
    timeInForce: 3, // GTD (Good Till Date)
    expiryTime: futureTime // Expires in 30 days
  }
};
```

## Configuration Options

### InitialOrder Struct

```solidity
struct InitialOrder {
    bool enabled;                    // Whether to place an initial order
    IOrderRouter.Side side;          // BUY (0) or SELL (1)
    uint256 quantity;               // Order quantity (must be >= minimumOrderSize)
    uint256 price;                  // Order price (must align with tickSize)
    IOrderRouter.TimeInForce timeInForce; // Time in force option
    uint256 expiryTime;             // Expiry time (for GTD orders)
}
```

### Time in Force Options

```solidity
enum TimeInForce {
    GTC,  // Good Till Cancelled - 0
    IOC,  // Immediate or Cancel - 1  
    FOK,  // Fill or Kill - 2
    GTD   // Good Till Date - 3
}
```

### Side Options

```solidity
enum Side {
    BUY,   // 0
    SELL   // 1
}
```

## Validation Rules

### 1. **Quantity Validation**
- Must be >= `minimumOrderSize`
- Must have sufficient collateral in vault

### 2. **Price Validation**
- Must be > 0
- Must be aligned to fixed 0.01 tick size (price % 0.01 == 0)

### 3. **Time Validation**
- For GTD orders: `expiryTime` must be in the future
- For GTD orders: `expiryTime` must be <= `tradingEndDate`

### 4. **Collateral Requirements**
- Creator must have sufficient collateral in CentralVault
- Collateral = (quantity × price) / PRICE_PRECISION

## Integration Workflow

### 1. **Frontend Integration**

```javascript
// Check if user has sufficient collateral
const requiredCollateral = (quantity * price) / ethers.parseEther("1");
const userBalance = await centralVault.getUserBalance(userAddress, collateralToken);

if (userBalance.available >= requiredCollateral) {
  // User can create market with initial order
  await createMarketWithInitialOrder(marketConfig);
} else {
  // Prompt user to deposit more collateral
  await depositCollateral(requiredCollateral - userBalance.available);
}
```

### 2. **Event Monitoring**

```javascript
// Listen for initial order placement
metricsMarketFactory.on("InitialOrderPlaced", (
  metricId,
  marketAddress, 
  creator,
  side,
  quantity,
  price,
  orderId
) => {
  console.log(`Initial order placed for ${metricId}:`);
  console.log(`Order ID: ${orderId}`);
  console.log(`Side: ${side === 0 ? 'BUY' : 'SELL'}`);
  console.log(`Quantity: ${ethers.formatEther(quantity)}`);
  console.log(`Price: ${ethers.formatEther(price)}`);
});
```

### 3. **Market Analytics**

```javascript
// Check market state after creation
const marketStats = await orderBook.getMarketStats();
console.log(`Best Bid: ${marketStats.bestBid}`);
console.log(`Best Ask: ${marketStats.bestAsk}`);
console.log(`Last Price: ${marketStats.lastPrice}`);
```

## Example Use Cases

### 1. **Population Market**
```javascript
// Market creator believes world population will be 8.1 billion
initialOrder: {
  enabled: true,
  side: 0, // BUY
  quantity: ethers.parseEther("1000"),
  price: ethers.parseEther("8.1"), // 8.1 billion
  timeInForce: 0, // GTC
  expiryTime: 0
}
```

### 2. **Economic Indicator Market**
```javascript
// Market creator expects US GDP of $26.5 trillion
initialOrder: {
  enabled: true,
  side: 1, // SELL (betting against higher values)
  quantity: ethers.parseEther("500"),
  price: ethers.parseEther("26.5"),
  timeInForce: 3, // GTD
  expiryTime: settlementDate - (7 * 24 * 60 * 60) // Expires 1 week before settlement
}
```

### 3. **Climate Data Market**
```javascript
// Temperature anomaly market - expecting +1.2°C
initialOrder: {
  enabled: true,
  side: 0, // BUY
  quantity: ethers.parseEther("2000"),
  price: ethers.parseEther("1.2"), // +1.2°C anomaly
  timeInForce: 0, // GTC
  expiryTime: 0
}
```

## Security Considerations

### 1. **Collateral Management**
- Initial orders require immediate collateral allocation
- Collateral is locked until order is filled or cancelled
- Failed order placement reverts entire market creation

### 2. **Market Manipulation**
- Initial orders are limited to post-only (no immediate execution)
- Price must align with fixed 0.01 tick size constraints
- Cannot place market orders as initial orders

### 3. **Gas Optimization**
- Market registration and order placement happen atomically
- Failed initial order reverts entire transaction
- Batch operations reduce gas costs

## Error Handling

Common errors and solutions:

```solidity
// Insufficient collateral
"OrderRouter: Insufficient collateral for execution"
→ Deposit more collateral before creating market

// Price not aligned
"MetricsMarketFactory: Initial order price not aligned to 0.01 tick size"  
→ Adjust price to be multiple of 0.01

// Order too small
"MetricsMarketFactory: Initial order below minimum size"
→ Increase quantity to meet minimumOrderSize

// Invalid expiry
"MetricsMarketFactory: Initial order expiry time must be in future"
→ Set expiryTime > current timestamp for GTD orders
```

## Best Practices

### 1. **Price Setting**
- Research comparable metrics for price guidance
- Consider market cap and expected participation
- Leave room for price discovery (don't set too tight)

### 2. **Order Sizing**
- Start with moderate quantities to encourage participation
- Consider total expected market size
- Allow for natural liquidity growth

### 3. **Timing**
- Use GTC for long-term markets
- Use GTD for events with known catalysts
- Coordinate expiry with expected news/data releases

This feature significantly improves the market creation experience by providing immediate price discovery and liquidity bootstrapping capabilities.
