# Settlement Workflow for Metric Markets

## Overview

Each metric market in the OrderBook DEX has its own independent settlement date and workflow. This enables time-bound trading on specific metric values with predetermined expiry dates, similar to traditional futures contracts but for custom real-world data.

## Settlement Architecture

### Market Lifecycle States

```
ACTIVE → TRADING_ENDED → SETTLEMENT_REQUESTED → SETTLED → EXPIRED (if not settled)
```

1. **ACTIVE**: Trading is open, orders can be placed and executed
2. **TRADING_ENDED**: Trading has stopped, positions are locked
3. **SETTLEMENT_REQUESTED**: UMA oracle data has been requested
4. **SETTLED**: Final value determined, positions can be settled
5. **EXPIRED**: Market expired without settlement (emergency state)

### Key Timestamps

- **Creation Date**: When the market was created
- **Trading End Date**: When trading stops (before settlement)
- **Data Request Window**: Period before settlement when UMA data can be requested
- **Settlement Date**: When the market settles with final metric value
- **Settlement Deadline**: Maximum time allowed for settlement completion

## Settlement Configuration

### Market Parameters

```solidity
struct MarketConfig {
    string metricId;
    string description;
    address oracleProvider;
    uint8 decimals;
    uint256 minimumOrderSize;
    uint256 tickSize;
    uint256 creationFee;
    bool requiresKYC;
    uint256 settlementDate;      // Unix timestamp for settlement
    uint256 tradingEndDate;      // When trading stops
    uint256 dataRequestWindow;   // How long before settlement to request data
    bool autoSettle;             // Whether market auto-settles
}
```

### Example Timeline

For a market settling on **December 31, 2024 at 23:59 UTC**:

- **Creation**: October 1, 2024
- **Trading End**: December 30, 2024 at 23:59 UTC (1 day before settlement)
- **Data Request Window**: December 28-31, 2024 (3 days before settlement)
- **Settlement**: December 31, 2024 at 23:59 UTC
- **Settlement Deadline**: January 2, 2025 (2 days grace period)

## Settlement Workflow

### Phase 1: Market Creation

```typescript
const marketConfig = {
  metricId: "WORLD_POPULATION_2024",
  description: "World Population Count for 2024",
  oracleProvider: umaOracleManagerAddress,
  decimals: 0,
  minimumOrderSize: ethers.parseEther("0.01"),
  tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
  creationFee: ethers.parseEther("1"),
  requiresKYC: false,
  settlementDate: 1735689540, // Dec 31, 2024 23:59 UTC
  tradingEndDate: 1735603140,  // Dec 30, 2024 23:59 UTC
  dataRequestWindow: 3 * 24 * 3600, // 3 days
  autoSettle: true
};

const tx = await factory.createMarket(marketConfig, {
  value: marketConfig.creationFee
});
```

### Phase 2: Active Trading

During the active trading period:

- Users can place orders (market, limit, stop orders)
- Orders are matched and executed normally
- Positions accumulate as long/short exposure
- Market statistics are updated in real-time

### Phase 3: Trading Ends

When `block.timestamp >= tradingEndDate`:

- No new orders can be placed
- Existing orders are cancelled
- Positions are locked for settlement
- Market state changes to `TRADING_ENDED`

### Phase 4: Settlement Data Request

Within the data request window (`settlementDate - dataRequestWindow` to `settlementDate + 1 day`):

```typescript
// Request settlement data from UMA Oracle
const ancillaryData = ethers.toUtf8Bytes(JSON.stringify({
  metric: "WORLD_POPULATION_2024",
  source: "UN World Population Prospects",
  methodology: "Mid-year population estimates",
  timestamp: marketConfig.settlementDate,
  description: "Total world population count as of December 31, 2024"
}));

const requestId = await factory.requestSettlementData(
  "WORLD_POPULATION_2024",
  ancillaryData
);
```

### Phase 5: UMA Oracle Resolution

1. **Proposal Phase**: Off-chain actors propose the settlement value
2. **Dispute Phase**: Value can be disputed during liveness period
3. **DVM Resolution**: If disputed, UMA tokenholders vote on correct value
4. **Finalization**: Settlement value is finalized on-chain

### Phase 6: Market Settlement

Once UMA resolves the value:

```typescript
// Settle the market with UMA's resolved value
const finalValue = 8100000000; // 8.1 billion people
await factory.settleMarket("WORLD_POPULATION_2024", finalValue);
```

### Phase 7: Position Settlement

Individual positions are settled based on the final value:

```typescript
// Users can settle their positions
const positionIds = await market.getUserPositions(userAddress);
await market.settlePositions(positionIds.map(p => p.id));
```

## Settlement Examples

### Example 1: World Population Market

**Market Setup:**
- Metric: World population count for 2024
- Settlement Date: December 31, 2024
- Expected Range: 8.0 - 8.2 billion people

**Trading Scenarios:**
- **Long Position**: User believes population will be > 8.1 billion
- **Short Position**: User believes population will be < 8.1 billion
- **Settlement Value**: 8.15 billion (from UN data)

**Payout Calculation:**
```typescript
// Long position at 8.1B, settled at 8.15B
const entryPrice = 8100000000;
const settlementValue = 8150000000;
const positionSize = ethers.parseEther("10"); // 10 ETH position

// Profit = (settlementValue - entryPrice) * positionSize / entryPrice
const profit = (settlementValue - entryPrice) * positionSize / entryPrice;
// = (8.15B - 8.1B) * 10 ETH / 8.1B = ~0.0062 ETH profit
```

### Example 2: Climate Temperature Market

**Market Setup:**
- Metric: Global temperature anomaly for Q4 2024
- Settlement Date: January 15, 2025
- Expected Range: +0.8°C to +1.2°C above 20th century average

**UMA Data Request:**
```json
{
  "metric": "GLOBAL_TEMP_ANOMALY_Q4_2024",
  "source": "NOAA Global Monitoring Laboratory",
  "methodology": "Temperature anomaly relative to 1901-2000 average",
  "period": "October-December 2024",
  "units": "degrees_celsius",
  "precision": 2
}
```

### Example 3: Bitcoin Hash Rate Market

**Market Setup:**
- Metric: Bitcoin network hash rate for December 2024
- Settlement Date: January 1, 2025
- Expected Range: 400-600 EH/s

**Settlement Workflow:**
1. Trading ends December 31, 2024
2. Data requested from Bitcoin network statistics
3. UMA oracle resolves with average hash rate for December
4. Positions settled based on final hash rate value

## Position Settlement Mechanics

### Long Position Settlement

```solidity
function calculateLongPayout(
    uint256 entryPrice,
    uint256 settlementValue,
    uint256 positionSize,
    uint256 collateral
) public pure returns (uint256 payout) {
    if (settlementValue > entryPrice) {
        // Profit scenario
        uint256 profit = (settlementValue - entryPrice) * positionSize / entryPrice;
        payout = collateral + profit;
    } else {
        // Loss scenario
        uint256 loss = (entryPrice - settlementValue) * positionSize / entryPrice;
        payout = loss >= collateral ? 0 : collateral - loss;
    }
}
```

### Short Position Settlement

```solidity
function calculateShortPayout(
    uint256 entryPrice,
    uint256 settlementValue,
    uint256 positionSize,
    uint256 collateral
) public pure returns (uint256 payout) {
    if (settlementValue < entryPrice) {
        // Profit scenario
        uint256 profit = (entryPrice - settlementValue) * positionSize / entryPrice;
        payout = collateral + profit;
    } else {
        // Loss scenario
        uint256 loss = (settlementValue - entryPrice) * positionSize / entryPrice;
        payout = loss >= collateral ? 0 : collateral - loss;
    }
}
```

## Risk Management

### Pre-Settlement Risks

1. **Market Risk**: Metric value moves against position
2. **Liquidity Risk**: Unable to close position before trading ends
3. **Oracle Risk**: UMA oracle fails to resolve or is disputed

### Settlement Risks

1. **Data Quality Risk**: Incorrect or manipulated settlement data
2. **Timing Risk**: Settlement occurs outside expected timeframe
3. **Technical Risk**: Smart contract bugs during settlement

### Risk Mitigation

1. **Position Limits**: Maximum position size per user
2. **Collateral Requirements**: Adequate margin for potential losses
3. **Insurance Fund**: Cover unexpected losses during settlement
4. **Emergency Procedures**: Manual intervention if automated settlement fails

## Monitoring and Alerts

### Key Metrics to Track

- **Time to Trading End**: Days/hours until trading stops
- **Time to Settlement**: Days/hours until settlement date
- **Open Interest**: Total long/short positions
- **Settlement Request Status**: Whether UMA data has been requested
- **Oracle Resolution Status**: Whether UMA has resolved the value

### Automated Alerts

```typescript
// Alert when approaching trading end
if (currentTime >= tradingEndDate - 24 * 3600) {
  alert("Trading ends in less than 24 hours");
}

// Alert when settlement data should be requested
if (currentTime >= settlementDate - dataRequestWindow) {
  alert("Settlement data request window is open");
}

// Alert when settlement is overdue
if (currentTime > settlementDate + 24 * 3600 && !isSettled) {
  alert("Settlement is overdue - manual intervention may be required");
}
```

## API Reference

### Factory Functions

```typescript
// Create market with settlement parameters
function createMarket(MarketConfig config) external returns (address);

// Request settlement data from UMA
function requestSettlementData(string metricId, bytes ancillaryData) external returns (bytes32);

// Settle market with final value
function settleMarket(string metricId, int256 finalValue) external;

// Get settlement information
function getMarketSettlement(string metricId) external view returns (bool, int256, uint256);

// Get markets approaching settlement
function getMarketsApproachingSettlement(uint256 timeWindow) external view returns (string[]);
```

### Market Functions

```typescript
// Get market state and timing
function getMarketState() external view returns (MarketState);
function getMarketTiming() external view returns (uint256, uint256, uint256);

// Check trading and settlement status
function isTradingAllowed() external view returns (bool);
function isReadyForSettlement() external view returns (bool);

// Position management
function getUserPositions(address trader) external view returns (Position[]);
function settlePositions(uint256[] positionIds) external;

// Settlement calculations
function calculatePositionPayout(uint256 positionId, int256 settlementValue) 
    external view returns (uint256, int256);
```

## Testing Settlement Workflows

### Unit Tests

```typescript
describe("Settlement Workflow", () => {
  it("should create market with settlement date", async () => {
    const config = { /* market config with settlement date */ };
    await factory.createMarket(config);
    
    const marketConfig = await factory.getMarketConfig(config.metricId);
    expect(marketConfig.settlementDate).to.equal(config.settlementDate);
  });

  it("should prevent trading after trading end date", async () => {
    // Fast forward to after trading end date
    await ethers.provider.send("evm_increaseTime", [tradingPeriod + 1]);
    
    // Attempt to place order should fail
    await expect(market.placeOrder(order)).to.be.revertedWith("Trading has ended");
  });

  it("should settle positions correctly", async () => {
    const settlementValue = 8150000000; // 8.15B
    await factory.settleMarket(metricId, settlementValue);
    
    const payout = await market.calculatePositionPayout(positionId, settlementValue);
    expect(payout).to.be.gt(0); // Should have positive payout for winning position
  });
});
```

### Integration Tests

```typescript
describe("End-to-End Settlement", () => {
  it("should complete full settlement workflow", async () => {
    // 1. Create market
    const market = await createTestMarket();
    
    // 2. Trade during active period
    await placeTrades(market);
    
    // 3. Wait for trading to end
    await fastForwardToTradingEnd();
    
    // 4. Request settlement data
    await requestSettlementData(market);
    
    // 5. Simulate UMA resolution
    await simulateUMAResolution(expectedValue);
    
    // 6. Settle market
    await settleMarket(market, expectedValue);
    
    // 7. Settle individual positions
    await settleAllPositions(market);
    
    // 8. Verify final state
    const settlement = await market.getSettlementInfo();
    expect(settlement.isSettled).to.be.true;
  });
});
```

## Governance and Emergency Procedures

### Emergency Powers

1. **Extend Settlement Deadline**: If UMA oracle is delayed
2. **Manual Settlement**: If automated settlement fails
3. **Market Cancellation**: If fundamental issues arise
4. **Position Liquidation**: If collateral becomes insufficient

### Governance Proposals

- Adjust default settlement parameters
- Add new metric categories
- Update UMA oracle configuration
- Modify emergency procedures

---

*This document provides a complete guide to the settlement workflow for metric markets. Each market operates independently with its own settlement schedule, enabling diverse trading opportunities on real-world data.*
