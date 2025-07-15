# DexContractsV2 Developer Guide: Tokenized Metric Trading

## Overview

DexContractsV2 revolutionizes derivatives trading by creating **virtual tokens that represent real-world metrics**. Unlike traditional crypto derivatives, users trade tokenized versions of measurable data like world population, weather patterns, or economic indicators. The system uses AMM mechanics for price discovery, with UMA oracle settlement forcing convergence to reality.

### Key Innovation: Tokenized World Population Example

**The Concept**: 
- World population becomes a tradeable token
- **Initial Price**: 8 billion people = $8.00 per token
- **Market Trading**: Users buy/sell tokens based on predictions, creating independent price discovery
- **Settlement Reality Check**: At settlement date, actual population becomes final token price

**Trading Scenario**:
- **Market Creation**: Population token starts at $8.00 (8 billion people)
- **Alice (Bullish)**: Buys tokens at $8.00, holds through price rise to $16.00
- **Bob (Bearish)**: Sells tokens at $12.00, expecting price to fall
- **Settlement**: Actual population is 9 billion = token settles at $9.00
- **Result**: Alice profits ($9.00 - $8.00 = $1.00), Bob profits ($12.00 - $9.00 = $3.00)

## Core Architecture

### System Components

1. **MetricVAMM**: Virtual AMM trading engine with tokenized metrics
2. **MetricRegistry**: Validates metrics according to compliance rules
3. **Virtual Reserves**: AMM liquidity pools that determine token prices
4. **UMA Oracle**: Provides decentralized settlement data
5. **Vault**: Manages collateral and margin for leveraged positions

### The Tokenization Model

**Traditional Futures**: Trade contracts betting on price direction
**Tokenized Metrics**: Trade virtual tokens representing the metric itself

```
Real Metric Value → Virtual Token → Market Price Discovery → Settlement Convergence
8 billion people  →  $8.00 token  →  $16.00 market peak  →  $9.00 settlement
```

## Step-by-Step Workflow

### Phase 1: Metric Tokenization

1. **Register Population Metric**
   - Call `MetricRegistry.registerMetric()` for "World Population"
   - Verify compliance with 7 data integrity rules
   - Set initial conversion: 1 billion people = $1.00 token price

2. **Create Market**
   - Call `MetricVAMM.createMetricMarket()` with population metric
   - Set settlement date (e.g., 30 days)
   - Initialize virtual reserves for AMM trading

3. **Initialize Token Price**
   - Current population: 8.1 billion
   - Starting token price: $8.10
   - AMM reserves set to maintain this initial price

### Phase 2: Market Trading

4. **Long Position (Bullish on Population)**
   - Alice calls `openMetricPosition()`:
     - Deposits $100 USDC collateral
     - Goes LONG with 10x leverage = $1,000 position size
     - Buys population tokens at current AMM price ($8.10)
     - Receives 123.46 virtual tokens ($1,000 ÷ $8.10)

5. **Short Position (Bearish on Population)**
   - Bob calls `openMetricPosition()`:
     - Deposits $200 USDC collateral  
     - Goes SHORT with 5x leverage = $1,000 position size
     - Sells population tokens at current AMM price
     - System tracks his short exposure to 123.46 tokens

6. **AMM Price Discovery**
   - Each trade moves token price via constant product formula
   - Large buys → token price increases
   - Large sells → token price decreases
   - Price moves independently of actual population changes

### Phase 3: Continuous Trading

7. **Position Management**
   - `addToMetricPosition()`: Increase existing positions
   - `closeMetricPosition()`: Exit before settlement
   - Prices continue fluctuating based on trading activity

8. **Funding Mechanisms**
   - Long/short imbalances create funding rates
   - Data freshness penalties encourage oracle updates
   - Settlement risk adjustments as expiry approaches

### Phase 4: Settlement Reality Check

9. **Settlement Trigger**
   - Call `requestUMASettlement()` after settlement date
   - UMA oracle requests actual population data
   - Economic incentives ensure accurate reporting

10. **Oracle Resolution**
    - UMA network determines: Actual population = 8.95 billion
    - Settlement token price = $8.95
    - Any price difference from market creates PnL

11. **Position Settlement**
    - Alice (bought at $8.10): Profit = $8.95 - $8.10 = $0.85 per token
    - Bob (sold at $8.10): Loss = $8.10 - $8.95 = -$0.85 per token
    - Settlement executed via `settleMetricPosition()`

## Key Functions Explained

### Market Creation Functions

**`createMetricMarket(metricId, settlementDays)`**
- Creates new market for specified metric
- Initializes AMM reserves based on current metric value
- Sets settlement date for oracle resolution

**`registerMetric(name, source, method)`**
- Adds new tradeable metric to registry
- Validates compliance with data integrity rules
- Defines conversion formula (metric value → token price)

### Trading Functions

**`openMetricPosition(metricId, collateral, isLong, leverage)`**
- Opens new long or short position on metric token
- Executes trade at current AMM price
- No target values needed - just buy/sell the token

**`addToMetricPosition(positionId, additionalCollateral)`**
- Increases position size at current market price
- Averages entry price with existing position

**`closeMetricPosition(positionId, sizeToClose)`**
- Exits position at current AMM price (before settlement)
- Realizes PnL based on entry vs exit price

### Price Discovery Functions

**`getMetricMarkPrice(metricId)`**
- Returns current AMM token price
- Calculated via virtual reserves and trading activity
- Independent of real-world metric value until settlement

**`getEffectiveReserves(metricId)`**
- Virtual AMM reserves for price calculation
- Dynamically scale with trading volume
- Use constant product formula: x * y = k

### Settlement Functions

**`requestUMASettlement(metricId)`**
- Initiates oracle data request for settlement
- Creates economic incentives for accurate data
- Begins dispute resolution period

**`settleMetricPosition(positionId)`**
- Final settlement using oracle-provided metric value
- PnL = (settlement_price - entry_price) × position_size × direction
- Distributes profits/losses through vault system

## The 7 Metric Compliance Rules

For any metric to be tokenized and traded:

1. **Public Accessibility**: Data source requires no payment/login
2. **Defined Cutoff**: Clear timestamp for evaluation  
3. **Deterministic Calculation**: Reproducible methodology
4. **Immutable History**: Data cannot change after cutoff
5. **Post-Cutoff Verifiability**: Provable weeks/months later
6. **Canonical Source**: Single agreed source of truth
7. **Outcome-Based Disputes**: Only data accuracy disputes allowed

## Trading Strategies

### Long Strategy (Bullish)
- Buy tokens when you expect metric to increase
- Profit if settlement value > entry price
- Example: Buy population tokens at $8.00, settle at $9.00 = $1.00 profit

### Short Strategy (Bearish)  
- Sell tokens when you expect metric to decrease
- Profit if settlement value < entry price
- Example: Sell population tokens at $10.00, settle at $9.00 = $1.00 profit

### Market Making
- Provide liquidity during price discovery phase
- Profit from bid-ask spreads and trading fees
- Risk: Holding inventory during volatile periods

### Arbitrage Opportunities
- Exploit differences between market price and perceived fair value
- Calendar spreads between different settlement dates
- Cross-metric correlations and hedging strategies

## Integration Architecture

### Frontend Integration
```
User Interface → Web3 → MetricVAMM → Price Discovery
     ↓              ↓         ↓            ↓
Settlement Date → UMA → Real Data → Final Prices
```

### Oracle Integration
- UMA OptimisticOracleV3 for settlement data
- Economic security through bonding mechanisms
- Decentralized dispute resolution
- Multi-source data verification

### Risk Management
- Position size limits based on available liquidity
- Funding rate adjustments for market imbalances  
- Emergency circuit breakers for extreme volatility
- Insurance fund for settlement discrepancies

## Example: World Population Token Trading

**Market Setup**:
- Metric: UN World Population Dashboard
- Conversion: 1 billion people = $1.00 token
- Current: 8.1 billion = $8.10 initial price
- Settlement: March 31, 2025

**Alice's Journey**:
1. Believes population will grow faster than expected
2. Buys 1,000 tokens at $8.10 (spends $8,100)
3. Market sentiment pushes price to $12.00
4. Settlement: Actual population 8.95 billion = $8.95
5. Result: Loss of $1.15 per token = -$1,150 total

**Bob's Journey**:
1. Expects population growth to slow
2. Sells 500 tokens at $11.00 (receives $5,500)
3. Market drops to $9.00 before settlement
4. Settlement: Actual population 8.95 billion = $8.95  
5. Result: Profit of $2.05 per token = +$1,025 total

This system transforms any measurable phenomenon into a liquid, tradeable financial instrument with transparent price discovery and decentralized settlement. 