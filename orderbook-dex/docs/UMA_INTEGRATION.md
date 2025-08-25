# UMA Oracle Integration Guide

## Overview

The OrderBook DEX integrates with UMA's Optimistic Oracle V3 to provide secure, decentralized access to real-world data for custom metrics trading. This integration enables the DEX to support trading of arbitrary metrics like world population, climate data, economic indicators, and more.

## Why UMA Oracle?

UMA's Optimistic Oracle is ideal for custom metrics because:

- **Arbitrary Data Support**: Can handle any type of real-world data
- **Optimistic Verification**: Efficient dispute resolution process
- **Economic Security**: Bond-based incentive system
- **Decentralized**: No single point of failure
- **Flexible**: Customizable liveness periods and dispute mechanisms

## Architecture Components

### 1. UMAOracleManager Contract

The central contract managing all UMA Oracle interactions:

```solidity
// Core functions
function requestMetricData(bytes32 identifier, uint256 timestamp, bytes ancillaryData, uint256 reward, uint256 customLiveness) 
function settleRequest(bytes32 requestId)
function getLatestMetricValue(bytes32 identifier)
function configureMetric(MetricConfig config)
```

**Key Features:**
- Manages metric configurations and data requests
- Handles bond management and fee distribution
- Provides historical data storage and retrieval
- Implements access control for authorized requesters

### 2. MetricsMarketFactory Integration

The factory contract automatically:
- Generates UMA identifiers for new metrics
- Configures metrics in the UMA Oracle Manager
- Authorizes market contracts to request data
- Maps metric IDs to UMA identifiers

### 3. Data Flow

```
Market Creation → UMA Metric Configuration → Data Requests → Oracle Resolution → Market Updates
```

## Supported Metric Types

### Demographics
- **WORLD_POPULATION_2024**: Current world population count
- **US_MIGRATION_RATE**: Annual US immigration rate
- **URBANIZATION_PCT**: Global urbanization percentage

### Economics
- **GLOBAL_GDP**: World GDP in trillions USD
- **US_INFLATION_RATE**: US Consumer Price Index
- **UNEMPLOYMENT_RATE**: Global unemployment percentage

### Environment
- **GLOBAL_TEMP_ANOMALY**: Temperature anomaly in Celsius
- **CO2_CONCENTRATION**: Atmospheric CO2 levels (ppm)
- **RENEWABLE_ENERGY_PCT**: Global renewable energy adoption

### Technology
- **BTC_HASH_RATE**: Bitcoin network hash rate (EH/s)
- **INTERNET_PENETRATION**: Global internet penetration rate
- **SMARTPHONE_ADOPTION**: Smartphone adoption percentage

## Integration Examples

### 1. Creating a New Metric Market

```typescript
// 1. Define metric configuration
const metricConfig = {
  metricId: "WORLD_POPULATION_2024",
  description: "World Population Count for 2024",
  oracleProvider: umaOracleManagerAddress,
  decimals: 0,
  minimumOrderSize: ethers.parseEther("0.01"),
  tickSize: ethers.parseEther("0.01"), // Fixed tick size: 0.01
  creationFee: ethers.parseEther("1"),
  requiresKYC: false
};

// 2. Create market (automatically configures UMA)
const tx = await factory.createMarket(metricConfig, {
  value: metricConfig.creationFee
});

// 3. Market is now ready for trading
const marketAddress = await factory.getMarket("WORLD_POPULATION_2024");
```

### 2. Requesting Data Update

```typescript
// Request current world population data
const ancillaryData = ethers.toUtf8Bytes(
  JSON.stringify({
    source: "UN World Population Prospects",
    methodology: "Mid-year estimates",
    timestamp: Math.floor(Date.now() / 1000)
  })
);

const requestId = await factory.requestMetricUpdate(
  "WORLD_POPULATION_2024",
  ancillaryData,
  ethers.parseEther("100") // 100 token reward
);
```

### 3. Retrieving Historical Data

```typescript
// Get historical population data
const fromTimestamp = Math.floor(Date.now() / 1000) - 365 * 24 * 3600; // 1 year ago
const toTimestamp = Math.floor(Date.now() / 1000);

const [timestamps, values] = await factory.getHistoricalValues(
  "WORLD_POPULATION_2024",
  fromTimestamp,
  toTimestamp
);

// Process historical data
for (let i = 0; i < timestamps.length; i++) {
  console.log(`${new Date(timestamps[i] * 1000).toISOString()}: ${values[i]} people`);
}
```

## UMA Oracle Workflow

### 1. Data Request Phase
1. Market or user requests data via `requestMetricData()`
2. Bond is transferred from requester to UMA Oracle
3. Request is published on-chain with identifier and ancillary data
4. Liveness period begins (default: 2 hours)

### 2. Proposal Phase
1. Off-chain proposers monitor requests
2. Proposer submits data with additional bond
3. If no dispute during liveness period, data is accepted
4. Proposer receives reward, bond is returned

### 3. Dispute Phase (if disputed)
1. Disputer challenges proposal with dispute bond
2. Request escalates to UMA's Data Verification Mechanism (DVM)
3. UMA tokenholders vote on correct value
4. Winning side receives bonds, losing side loses bonds

### 4. Settlement Phase
1. `settleRequest()` is called to finalize the data
2. Resolved value is stored in historical data
3. Market statistics are updated
4. Trading can proceed with new data

## Security Considerations

### Bond Requirements
- **Minimum Bond**: 1000 tokens (configurable per metric)
- **Dispute Bond**: Equal to proposal bond
- **Economic Security**: Bonds must exceed potential profit from manipulation

### Access Control
- **Authorized Requesters**: Only approved addresses can request data
- **Role-Based Permissions**: Admin, manager, and requester roles
- **Emergency Pausing**: Ability to halt specific metrics or entire system

### Data Validation
- **Ancillary Data**: Detailed context for each request
- **Source Documentation**: Required data sources and methodology
- **Dispute Incentives**: Economic incentives for honest participation

## Configuration Parameters

### Metric Configuration
```solidity
struct MetricConfig {
    bytes32 identifier;         // UMA identifier
    string description;         // Human-readable description
    uint8 decimals;            // Decimal precision
    uint256 minBond;           // Minimum bond required
    uint256 defaultReward;     // Default reward amount
    uint256 livenessPeriod;    // Default liveness period
    bool isActive;             // Whether metric is active
    address[] authorizedRequesters; // Authorized addresses
}
```

### Default Settings
- **Liveness Period**: 2 hours (7200 seconds)
- **Minimum Bond**: 1000 tokens
- **Default Reward**: 100 tokens
- **Bond Currency**: WETH or configured ERC20 token

## Error Handling

### Common Errors
1. **"Metric not active"**: Metric has been paused or disabled
2. **"Not authorized"**: Caller lacks permission to request data
3. **"Future timestamp"**: Cannot request data for future timestamps
4. **"Insufficient bond"**: Bond amount below minimum requirement

### Recovery Procedures
1. **Failed Requests**: Can be retried with adjusted parameters
2. **Disputed Data**: Wait for DVM resolution before proceeding
3. **Emergency Situations**: Admin can pause metrics or entire system

## Monitoring and Alerts

### Key Metrics to Monitor
- **Pending Requests**: Number of unresolved data requests
- **Dispute Rate**: Percentage of proposals that are disputed
- **Resolution Time**: Average time from request to settlement
- **Bond Utilization**: Total bonds locked in the system

### Alert Conditions
- **Long Pending Requests**: Requests older than 2x liveness period
- **High Dispute Rate**: More than 10% of proposals disputed
- **Failed Settlements**: Requests that cannot be settled
- **Unusual Activity**: Abnormal request patterns or volumes

## Testing Framework

### Unit Tests
```typescript
describe("UMA Oracle Integration", () => {
  it("should configure new metric", async () => {
    await umaOracleManager.configureMetric(metricConfig);
    const config = await umaOracleManager.getMetricConfig(identifier);
    expect(config.isActive).to.be.true;
  });

  it("should request and resolve data", async () => {
    const requestId = await umaOracleManager.requestMetricData(/* params */);
    // Simulate UMA resolution
    await umaOracleManager.settleRequest(requestId);
    const [isResolved, value] = await umaOracleManager.getRequestStatus(requestId);
    expect(isResolved).to.be.true;
  });
});
```

### Integration Tests
- End-to-end market creation and trading
- Oracle data request and resolution cycles
- Multi-metric market interactions
- Emergency pause and recovery scenarios

## Gas Optimization

### Efficient Patterns
- **Batch Operations**: Multiple requests in single transaction
- **Minimal Storage**: Store only essential data on-chain
- **Event Logging**: Use events for off-chain data indexing
- **Proxy Patterns**: Use minimal proxies for market deployment

### Gas Estimates
- **Market Creation**: ~500,000 gas
- **Data Request**: ~200,000 gas
- **Settlement**: ~150,000 gas
- **Historical Query**: ~50,000 gas (view function)

## Deployment Checklist

### Pre-Deployment
- [ ] UMA Finder contract address configured
- [ ] Bond currency (WETH) approved and funded
- [ ] Admin addresses and roles defined
- [ ] Initial metric configurations prepared
- [ ] Security audit completed

### Post-Deployment
- [ ] Verify contracts on Etherscan
- [ ] Configure initial metrics
- [ ] Set up monitoring and alerts
- [ ] Test data request workflow
- [ ] Initialize insurance fund

## Troubleshooting Guide

### Common Issues

**Issue**: "UMA identifier not found"
**Solution**: Ensure metric is properly configured in UMA Oracle Manager

**Issue**: "Request not resolved"
**Solution**: Check if liveness period has passed and call settleRequest()

**Issue**: "Insufficient balance for bond"
**Solution**: Ensure requester has enough bond currency approved

**Issue**: "Oracle address not set"
**Solution**: Update UMA Optimistic Oracle address in configuration

### Debug Commands
```typescript
// Check UMA Oracle Manager configuration
const oracleAddress = await umaOracleManager.getOptimisticOracle();
const metricConfig = await umaOracleManager.getMetricConfig(identifier);

// Check pending requests
const pendingRequests = await umaOracleManager.getPendingRequests(identifier);

// Check request status
const [isResolved, value] = await umaOracleManager.getRequestStatus(requestId);
```

## Future Enhancements

### Planned Features
1. **Multi-Oracle Support**: Integration with additional oracle providers
2. **Automated Requests**: Scheduled data updates
3. **Data Aggregation**: Combining multiple sources
4. **Prediction Markets**: Forward-looking metric trading
5. **Cross-Chain Support**: Multi-chain oracle data

### Research Areas
- **MEV Protection**: Preventing front-running of oracle updates
- **Data Quality Scoring**: Reputation system for data providers
- **Dispute Automation**: Automated dispute detection and resolution
- **Privacy Preservation**: Zero-knowledge oracle proofs

---

*This documentation covers the complete UMA Oracle integration for the OrderBook DEX. For additional technical details, refer to the smart contract source code and UMA Protocol documentation.*
