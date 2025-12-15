# Liquidation System - Worked Examples

This document provides detailed numerical examples for various liquidation scenarios.

## Constants & Setup

```solidity
LIQUIDATION_PENALTY_BPS = 1000  // 10%
MMR_BPS = 2000                  // 20%
DECIMAL_SCALE = 1e12            // 18 decimals → 6 decimals
TICK_PRECISION = 1e6            // Price precision (6 decimals)
```

**Unit Conventions**:
- Prices: 6 decimals (e.g., $1.00 = 1000000)
- Sizes: 18 decimals (e.g., 100 ALU = 100e18)
- Collateral/PnL: 6 decimals for USDC, 18 decimals for internal PnL tracking

---

## Example 1: Full Liquidation of Short Position (Sufficient Collateral)

### Initial State
```
User: Alice
Position: SHORT 10 ALU
Entry Price: $1.00 (1000000)
Margin Locked: $15.00 (15000000)
User Collateral: $20.00 (20000000)
Market moves to: $2.08
```

### Step 1: Trigger Detection
```
Mark Price = $2.08 (2080000)
liquidationPrice for short = calculated at position open

Check isLiquidatable():
  - Position: size = -10e18, entryPrice = 1000000, marginLocked = 15000000
  - unrealizedPnL = (2080000 - 1000000) × (-10e18) / 1e6
                  = 1080000 × (-10e18) / 1e6
                  = -10.80e18 (18 decimals)
  - equity = marginLocked + unrealizedPnL (in 6d)
           = 15000000 + (-10800000)
           = 4200000 ($4.20)
  - notional = 10e18 × 2080000 / 1e18 = 20800000 ($20.80)
  - maintenance = 20800000 × 2000 / 10000 = 4160000 ($4.16)
  - equity ($4.20) ≈ maintenance ($4.16) → LIQUIDATABLE
```

### Step 2: Market Order Execution
```
OrderBook attempts to buy 10 ALU to close short
Available asks: 3 ALU @ $2.09, 7 ALU @ $2.10
  
Execution:
  - Fill 3 ALU @ $2.09
  - Fill 7 ALU @ $2.10
  - Worst price = $2.10 (2100000)
  - Average price ≈ $2.097 (weighted)
```

### Step 3: Gap Loss Calculation
```
liquidationTriggerPrice = $2.08 (mark at trigger)
worstExecutionPrice = $2.10
positionSize = -10 ALU (short)

Since short and worstPrice > triggerPrice:
  priceGap = 2100000 - 2080000 = 20000 ($0.02)
  gapLoss = (10e18 × 20000) / 1e18 = 200000 ($0.20)

Confiscate from available collateral:
  availableCollateral = 20000000 - 15000000 = 5000000 ($5.00)
  toConfiscate = min(200000, 5000000) = 200000 ($0.20)
  
After confiscation:
  userCollateral = 20000000 - 200000 = 19800000 ($19.80)
```

### Step 4: Vault-Side Liquidation
```
settlePrice = worstExecutionPrice = 2100000 ($2.10)

Trading Loss:
  lossPerUnit = settlePrice - entryPrice = 2100000 - 1000000 = 1100000 ($1.10)
  tradingLoss = (1100000 × 10e18) / (1e12 × 1e6)
              = (1100000 × 10e18) / 1e18
              = 11000000 ($11.00)

Penalty:
  notional = (10e18 × 2100000) / 1e18 = 21000000 ($21.00)
  penalty = 21000000 × 1000 / 10000 = 2100000 ($2.10)

Actual Loss:
  actualLoss = tradingLoss + penalty = 11000000 + 2100000 = 13100000 ($13.10)

Seizure:
  seizableFromLocked = min(actualLoss, marginLocked)
                     = min(13100000, 15000000)
                     = 13100000 ($13.10)
  
  seized = min(seizableFromLocked, userCollateral)
         = min(13100000, 19800000)
         = 13100000 ($13.10)

Consume Funds:
  userCrossChainCredit = 0 (assume none)
  fromExternal = 0
  fromCollateral = 13100000
  
After seizure:
  userCollateral = 19800000 - 13100000 = 6700000 ($6.70)
```

### Step 5: Distribute Seized Funds
```
seizedForTradingLoss = min(seized, tradingLoss)
                     = min(13100000, 11000000)
                     = 11000000 ($11.00)

seizedForPenalty = seized - seizedForTradingLoss
                 = 13100000 - 11000000
                 = 2100000 ($2.10)

Credit OrderBook: 2100000 (for maker rewards)
```

### Step 6: Calculate Uncovered Loss
```
uncoveredLoss = max(0, tradingLoss - seized)
              = max(0, 11000000 - 13100000)
              = 0 (fully covered)

No socialization needed.
```

### Step 7: Remove Position
```
Realize PnL:
  realizedPnL = (settlePrice - entryPrice) × size / TICK_PRECISION
              = (2100000 - 1000000) × (-10e18) / 1e6
              = -11e18 (18 decimals = -$11.00)
  
userRealizedPnL[Alice] += -11e18

Remove position from array.
Release marginLocked from totalMarginLocked.
```

### Step 8: Maker Reward Distribution
```
rewardPool = min(expectedPenalty, OB_balance)
           = min(2100000, assume 5000000)
           = 2100000 ($2.10)

Makers and contributions (from tracking):
  Maker1: 3 ALU @ $2.09 → notional = 6270000 (scaled)
  Maker2: 7 ALU @ $2.10 → notional = 14700000 (scaled)
  Total notional = 20970000

Maker1 share = 2100000 × 6270000 / 20970000 = 628695 ($0.63)
Maker2 share = 2100000 × 14700000 / 20970000 = 1471305 ($1.47)

Pay each maker via payMakerLiquidationReward().
```

### Final State
```
Alice:
  - Position: CLOSED
  - Collateral: $6.70 (down from $20.00)
  - Realized PnL: -$11.00
  
OrderBook:
  - Balance reduced by $2.10 (paid to makers)
  
Makers:
  - Maker1: +$0.63
  - Maker2: +$1.47
  
System:
  - No bad debt
  - No socialized loss
```

---

## Example 2: Liquidation with Insufficient Collateral → Socialization

### Initial State
```
User: Bob
Position: LONG 50 ALU
Entry Price: $2.00 (2000000)
Margin Locked: $100.00 (100000000)
User Collateral: $100.00 (100000000) [exactly margin, no extra]
Market moves to: $1.50
```

### Step 1: Trigger Detection
```
Mark Price = $1.50 (1500000)
unrealizedPnL = (1500000 - 2000000) × 50e18 / 1e6 = -25e18 (-$25.00)
equity = 100000000 + (-25000000) = 75000000 ($75.00)
notional = 50e18 × 1500000 / 1e18 = 75000000 ($75.00)
maintenance = 75000000 × 2000 / 10000 = 15000000 ($15.00)

equity ($75.00) >> maintenance ($15.00) → NOT liquidatable yet.

Market continues to fall to $1.60:
unrealizedPnL = (1600000 - 2000000) × 50e18 / 1e6 = -20e18 (-$20.00)
equity = 100000000 - 20000000 = 80000000 ($80.00)
notional = 50e18 × 1600000 / 1e18 = 80000000 ($80.00)
maintenance = 80000000 × 2000 / 10000 = 16000000 ($16.00)

Still safe. But if mark falls further to $1.64:
unrealizedPnL = (1640000 - 2000000) × 50e18 / 1e6 = -18e18 (-$18.00)
equity = 100000000 - 18000000 = 82000000 ($82.00)
notional = 50e18 × 1640000 / 1e18 = 82000000 ($82.00)
maintenance = 82000000 × 2000 / 10000 = 16400000 ($16.40)

equity / notional = 82 / 82 = 100% → approaching threshold.

When mark = $1.632:
equity ≈ 100 - 18.4 = 81.6
notional = 81.6
maintenance = 16.32
81.6 / 81.6 ≈ 100%, and equity - maintenance ≈ 65.28 → still above

Trigger when equity drops below ~20% buffer.

Let's use mark = $1.60 for liquidation trigger (simplified).
```

### Step 2: Market Order Execution
```
OrderBook attempts to sell 50 ALU
Available bids: 20 ALU @ $1.58
Remaining 30 ALU: no bids

Partial fill: 20 ALU @ $1.58
Worst price = $1.58 (1580000)
Remaining: 30 ALU unexecuted
```

### Step 3: Partial Liquidation via updatePositionWithLiquidation
```
sizeDelta = -20e18 (closing 20 out of 50 long)
executionPrice = 1580000
oldSize = 50e18
closeAbs = 20e18
newSize = 50e18 - 20e18 = 30e18

Trading Loss on 20 ALU:
  lossPerUnit = entryPrice - settlePrice = 2000000 - 1580000 = 420000 ($0.42)
  tradingLossClosed = (420000 × 20e18) / (1e12 × 1e6)
                    = 8400000 ($8.40)

Penalty on 20 ALU:
  notionalClosed = (20e18 × 1580000) / 1e18 = 31600000 ($31.60)
  penaltyClosed = 31600000 × 1000 / 10000 = 3160000 ($3.16)

New Required Margin for 30 ALU:
  notional30 = 30e18 × 1580000 / 1e18 = 47400000 ($47.40)
  newRequiredMargin = 47400000 (100% for long)

Confiscatable:
  confiscatable = oldLocked - newRequired
                = 100000000 - 47400000
                = 52600000 ($52.60)

Actual Loss:
  actualLossClosed = tradingLossClosed + penaltyClosed
                   = 8400000 + 3160000
                   = 11560000 ($11.56)

Seized:
  seized = min(confiscatable, actualLossClosed, userCollateral)
         = min(52600000, 11560000, 100000000)
         = 11560000 ($11.56)

After seizure:
  userCollateral = 100000000 - 11560000 = 88440000 ($88.44)

Uncovered Loss:
  uncoveredLoss = max(0, tradingLossClosed - seized)
                = max(0, 8400000 - 11560000)
                = 0 (fully covered)
```

**No socialization on this partial fill.**

### Step 4: Remaining 30 ALU Falls to Direct Liquidation
```
Market continues falling to $1.40
Direct liquidation at mark price $1.40

Trading Loss on 30 ALU:
  lossPerUnit = 2000000 - 1400000 = 600000 ($0.60)
  tradingLoss = (600000 × 30e18) / (1e12 × 1e6)
              = 18000000 ($18.00)

Penalty on 30 ALU:
  notional = 30e18 × 1400000 / 1e18 = 42000000 ($42.00)
  penalty = 42000000 × 1000 / 10000 = 4200000 ($4.20)

Seizure:
  marginLocked = 47400000 (from step 3)
  actualLoss = tradingLoss + penalty = 18000000 + 4200000 = 22200000 ($22.20)
  seizableFromLocked = min(actualLoss, marginLocked)
                     = min(22200000, 47400000)
                     = 22200000
  
  seized = min(seizableFromLocked, userCollateral)
         = min(22200000, 88440000)
         = 22200000 ($22.20)

After seizure:
  userCollateral = 88440000 - 22200000 = 66240000 ($66.24)

Uncovered Loss:
  uncoveredLoss = max(0, tradingLoss - seized)
                = max(0, 18000000 - 22200000)
                = 0 (no uncovered, penalty consumed seized funds)
```

**Still no socialization because penalty + seized > trading loss.**

---

## Example 3: Liquidation with Socialization (True Shortfall)

### Initial State
```
User: Carol
Position: SHORT 20 ALU
Entry Price: $1.00 (1000000)
Margin Locked: $20.00 (20000000) [only 67% of required short margin, undercollateralized]
User Collateral: $20.00 (20000000) [no additional funds]
Market moves to: $2.50
```

### Step 1: Liquidation Trigger
```
Mark = $2.50 (2500000)
unrealizedPnL = (2500000 - 1000000) × (-20e18) / 1e6 = -30e18 (-$30.00)
equity = 20000000 + (-30000000) = -10000000 (-$10.00) [NEGATIVE!]

Clearly liquidatable.
```

### Step 2: Market Order Execution
```
OrderBook buys 20 ALU @ average $2.55 (partial fills across price levels)
Worst price = $2.60 (2600000)
```

### Step 3: Vault-Side Liquidation
```
settlePrice = 2600000 ($2.60)

Trading Loss:
  lossPerUnit = 2600000 - 1000000 = 1600000 ($1.60)
  tradingLoss = (1600000 × 20e18) / (1e12 × 1e6)
              = 32000000 ($32.00)

Penalty:
  notional = 20e18 × 2600000 / 1e18 = 52000000 ($52.00)
  penalty = 52000000 × 1000 / 10000 = 5200000 ($5.20)

Actual Loss:
  actualLoss = 32000000 + 5200000 = 37200000 ($37.20)

Seizure:
  seizableFromLocked = min(actualLoss, marginLocked)
                     = min(37200000, 20000000)
                     = 20000000 ($20.00) [all margin]
  
  seized = min(seizableFromLocked, userCollateral)
         = min(20000000, 20000000)
         = 20000000 ($20.00) [entire collateral]

After seizure:
  userCollateral = 0
```

### Step 4: Uncovered Loss (Anchor Protection Applied)
```
Basic uncovered:
  uncoveredLoss = max(0, tradingLoss - seized)
                = max(0, 32000000 - 20000000)
                = 12000000 ($12.00)

Anchor Price Protection:
  liquidationAnchorPrice = $2.50 (mark when entered liquidation)
  executionPrice = $2.60
  For short: use min(execPrice, anchor) to calculate allowed loss
  
  anchorPrice = min(2600000, 2500000) = 2500000
  
  If anchorPrice > entryPrice:
    anchorTradingLoss = (anchorPrice - entryPrice) × size / (DECIMAL × TICK)
                      = (2500000 - 1000000) × 20e18 / (1e12 × 1e6)
                      = 30000000 ($30.00)
  
  allowedUncovered = max(0, anchorTradingLoss - seized)
                   = max(0, 30000000 - 20000000)
                   = 10000000 ($10.00)
  
  excess = uncoveredLoss - allowedUncovered
         = 12000000 - 10000000
         = 2000000 ($2.00)
  
Record bad debt:
  marketBadDebt[marketId] += 2000000
  
Socialize:
  lossToSocialize = allowedUncovered = 10000000 ($10.00)
```

### Step 5: Socialized Loss Distribution
```
Market Participants:
  - Dave: LONG 100 ALU @ $1.50 entry, margin $150
  - Eve: LONG 50 ALU @ $2.00 entry, margin $100
  - Frank: SHORT 30 ALU @ $3.00 entry, margin $60

Current mark = $2.50

Calculate unrealized PnL:
  Dave: (2500000 - 1500000) × 100e18 / 1e6 = 100e18 ($100.00 profit)
  Eve: (2500000 - 2000000) × 50e18 / 1e6 = 25e18 ($25.00 profit)
  Frank: (2500000 - 3000000) × (-30e18) / 1e6 = 15e18 ($15.00 profit)

Profit Scores:
  Dave: 100 × 100 / 1 = 10000
  Eve: 25 × 50 / 1 = 1250
  Frank: 15 × 30 / 1 = 450
  
Sort descending: Dave, Eve, Frank

Calculate notionals at mark $2.50:
  Dave: 100e18 × 2500000 / 1e18 = 250000000 ($250.00)
  Eve: 50e18 × 2500000 / 1e18 = 125000000 ($125.00)
  Frank: 30e18 × 2500000 / 1e18 = 75000000 ($75.00)
  Total notional = 450000000 ($450.00)

Target allocations of $10.00 loss:
  Dave: 10000000 × 250000000 / 450000000 = 5555556 ($5.56)
  Eve: 10000000 × 125000000 / 450000000 = 2777778 ($2.78)
  Frank: 10000000 × 75000000 / 450000000 = 1666666 ($1.67)

Check capacity (equity above maintenance):
  Dave:
    equity = 150000000 + 100000000 = 250000000 ($250.00)
    maintenance = 250000000 × 2000 / 10000 = 50000000 ($50.00)
    cap = 250000000 - 50000000 = 200000000 ($200.00)
    assign = min(5555556, 200000000) = 5555556 ($5.56) ✓
  
  Eve:
    equity = 100000000 + 25000000 = 125000000 ($125.00)
    maintenance = 125000000 × 2000 / 10000 = 25000000 ($25.00)
    cap = 125000000 - 25000000 = 100000000 ($100.00)
    assign = min(2777778, 100000000) = 2777778 ($2.78) ✓
  
  Frank:
    equity = 60000000 + 15000000 = 75000000 ($75.00)
    maintenance = 75000000 × 2000 / 10000 = 15000000 ($15.00)
    cap = 75000000 - 15000000 = 60000000 ($60.00)
    assign = min(1666666, 60000000) = 1666666 ($1.67) ✓

Total allocated = 5555556 + 2777778 + 1666666 = 10000000 ($10.00) ✓

Apply haircuts:
  Dave.socializedLossAccrued6 += 5555556
  Dave.haircutUnits18 += (5555556 × 1e18) / 2500000 = 2222222400000000000
  
  Eve.socializedLossAccrued6 += 2777778
  Eve.haircutUnits18 += (2777778 × 1e18) / 2500000 = 1111111200000000000
  
  Frank.socializedLossAccrued6 += 1666666
  Frank.haircutUnits18 += (1666666 × 1e18) / 2500000 = 666666400000000000
```

### Final State
```
Carol:
  - Position: CLOSED
  - Collateral: $0.00 (wiped out)
  - Realized PnL: -$32.00
  
Market:
  - Bad Debt: $2.00 (excess beyond anchor protection)
  - Socialized Loss: $10.00 (distributed to winners)
  
Winners:
  - Dave: haircut $5.56
  - Eve: haircut $2.78
  - Frank: haircut $1.67
```

---

## Example 4: Haircut Realization on Position Close

### Initial State (After Example 3)
```
Dave:
  Position: LONG 100 ALU @ $1.50 entry
  Margin Locked: $150.00
  socializedLossAccrued6 = 5555556 ($5.56)
  haircutUnits18 = 2222222400000000000 (~2.22 ALU tagged)
  
Current mark = $2.50
```

### Scenario: Dave closes 50 ALU at $2.60
```
sizeDelta = -50e18
executionPrice = 2600000 ($2.60)
```

### Step 1: Position Netting Calculation
```
oldSize = 100e18
newSize = 100e18 + (-50e18) = 50e18
closedAbs = 50e18

oldHaircut6 = 5555556
oldHaircutUnits18 = 2222222400000000000

Haircut to realize:
  unitsToRelease = min(closedAbs, oldHaircutUnits18)
                 = min(50e18, 2222222400000000000)
                 = 2222222400000000000 (all tagged units)
  
  haircutClosed6 = (oldHaircut6 × unitsToRelease) / oldHaircutUnits18
                 = (5555556 × 2222222400000000000) / 2222222400000000000
                 = 5555556 ($5.56) [entire haircut on this portion]
  
Actually, only 50 ALU closed out of 100, so:
  unitsToRelease = 50e18
  But haircutUnits18 = 2.22 ALU, so unitsToRelease > haircutUnits
  → unitsToRelease = haircutUnits18 (cap at tagged amount)
  
  haircutClosed6 = entire haircut = 5555556
  
Update position:
  newHaircut6 = 5555556 - 5555556 = 0
  newHaircutUnits18 = 2222222400000000000 - 2222222400000000000 = 0
```

### Step 2: Calculate Payout
```
Gross PnL on 50 ALU:
  priceDiff = 2600000 - 1500000 = 1100000 ($1.10 per unit)
  grossPnL = (1100000 × 50e18) / 1e6 = 55e18 ($55.00)

Margin to release (proportional):
  oldMargin = 150000000
  proportionClosed = 50 / 100 = 0.5
  marginReleased = 150000000 × 0.5 = 75000000 ($75.00)

Net payout:
  netPayout = marginReleased + grossPnL - haircutClosed
  (in 6 decimals: convert grossPnL)
  grossPnL6 = 55000000
  netPayout = 75000000 + 55000000 - 5555556
            = 124444444 ($124.44)

Credit to Dave:
  userRealizedPnL[Dave] += 55e18 (gross, 18d)
  
  When Dave withdraws:
    availableCollateral = collateral + realizedPnL6 - haircut
    But haircut was already deducted from realized PnL crediting
    
Actually, haircut is deducted from margin release:
  effectiveMarginRelease = 75000000 - 5555556 = 69444444 ($69.44)
  Plus gross PnL = 55000000
  Total available = 69444444 + 55000000 = 124444444 ($124.44)
```

### Final State
```
Dave:
  - Position: 50 ALU remaining @ $1.50 entry
  - Margin Locked: $75.00
  - socializedLossAccrued6 = 0 (haircut fully realized)
  - haircutUnits18 = 0
  - Realized PnL: +$55.00 (gross)
  - Effective payout received: $124.44 (includes margin and PnL, minus haircut)
```

---

## Example 5: Multi-Round Partial Liquidation

### Initial State
```
User: George
Position: LONG 100 ALU @ $2.00
Margin Locked: $200.00
User Collateral: $200.00
```

### Round 1: Partial Fill at $1.70
```
Market attempts to sell 100 ALU
Only 20 ALU filled @ $1.70

sizeDelta = -20e18
closeAbs = 20e18
newSize = 80e18

Trading Loss: (2000000 - 1700000) × 20e18 / (1e12 × 1e6) = 6000000 ($6.00)
Penalty: (20e18 × 1700000 / 1e18) × 0.10 = 3400000 ($3.40)
Total: $9.40

New margin for 80 ALU:
  80e18 × 1700000 / 1e18 = 136000000 ($136.00)

Confiscatable: 200000000 - 136000000 = 64000000 ($64.00)
Seized: min(9400000, 64000000, 200000000) = 9400000 ($9.40)

After:
  userCollateral = 200000000 - 9400000 = 190600000 ($190.60)
  marginLocked = 136000000
  position.size = 80e18
  isUnderLiquidationPosition = true
```

### Round 2: Another 30 ALU at $1.65
```
sizeDelta = -30e18
closeAbs = 30e18
newSize = 50e18

Trading Loss: (2000000 - 1650000) × 30e18 / (1e12 × 1e6) = 10500000 ($10.50)
Penalty: (30e18 × 1650000 / 1e18) × 0.10 = 4950000 ($4.95)
Total: $15.45

New margin for 50 ALU:
  50e18 × 1650000 / 1e18 = 82500000 ($82.50)

Confiscatable: 136000000 - 82500000 = 53500000 ($53.50)
Seized: min(15450000, 53500000, 190600000) = 15450000 ($15.45)

After:
  userCollateral = 190600000 - 15450000 = 175150000 ($175.15)
  marginLocked = 82500000
  position.size = 50e18
```

### Round 3: Remaining 50 ALU at $1.60 (Full Close)
```
sizeDelta = -50e18
closeAbs = 50e18
newSize = 0

Trading Loss: (2000000 - 1600000) × 50e18 / (1e12 × 1e6) = 20000000 ($20.00)
Penalty: (50e18 × 1600000 / 1e18) × 0.10 = 8000000 ($8.00)
Total: $28.00

Confiscatable: 82500000 (all remaining margin)
Seized: min(28000000, 82500000, 175150000) = 28000000 ($28.00)

After:
  userCollateral = 175150000 - 28000000 = 147150000 ($147.15)
  marginLocked = 0 (position removed)
  
Uncovered loss = max(0, 20000000 - 28000000) = 0 (penalty covered it)
```

### Final State
```
George:
  - Position: CLOSED
  - Collateral remaining: $147.15 (started with $200.00)
  - Total loss: $200.00 - $147.15 = $52.85
  - Breakdown:
    - Trading loss: $6.00 + $10.50 + $20.00 = $36.50
    - Penalties: $3.40 + $4.95 + $8.00 = $16.35
    - Total = $52.85 ✓
  - Realized PnL: -$40.00 (proportional to size closed at each step)
```

---

## Example 6: Anchor Price Protection Limiting Socialization

### Initial State
```
User: Helen
Position: SHORT 10 ALU @ $1.00
Margin Locked: $15.00
User Collateral: $15.00

Liquidation triggered at mark = $2.00
liquidationAnchorPrice = $2.00
liquidationAnchorTimestamp = block.timestamp
```

### Market Movement Before Execution
```
Market continues to rise:
  Time T+1: mark = $2.10
  Time T+2: mark = $2.25
  Time T+3: mark = $2.50 (execution occurs here)

executionPrice = $2.50 (2500000)
```

### Liquidation Calculation
```
Trading Loss at executionPrice:
  lossPerUnit = 2500000 - 1000000 = 1500000 ($1.50)
  tradingLoss = (1500000 × 10e18) / (1e12 × 1e6) = 15000000 ($15.00)

Penalty:
  notional = 10e18 × 2500000 / 1e18 = 25000000 ($25.00)
  penalty = 25000000 × 0.10 = 2500000 ($2.50)

Seized:
  seized = min(tradingLoss + penalty, marginLocked, userCollateral)
         = min(17500000, 15000000, 15000000)
         = 15000000 ($15.00) [entire collateral]

Basic uncovered:
  uncoveredLoss = max(0, tradingLoss - seized)
                = max(0, 15000000 - 15000000)
                = 0 [NO uncovered at execution price]
  
But wait, actually:
  seized covers both trading + penalty, so we have exactly $15.00 seized.
  tradingLoss = $15.00, so uncovered = $0.
  
Let's recalculate with margin too small:
```

### Revised: Margin Only $10.00
```
marginLocked = 10000000
userCollateral = 10000000

Seized:
  seized = min(17500000, 10000000, 10000000) = 10000000 ($10.00)

Uncovered at execution price:
  uncoveredLoss = max(0, tradingLoss - seized)
                = max(0, 15000000 - 10000000)
                = 5000000 ($5.00)
```

### Anchor Price Protection
```
anchorPrice = $2.00 (from when liquidation was triggered)
executionPrice = $2.50

For short: use effectivePrice = min(execPrice, anchor)
           effectivePrice = min(2500000, 2000000) = 2000000

anchorTradingLoss = (2000000 - 1000000) × 10e18 / (1e12 × 1e6)
                  = 10000000 ($10.00)

allowedUncovered = max(0, anchorTradingLoss - seized)
                 = max(0, 10000000 - 10000000)
                 = 0 ($0.00)

excess = uncoveredLoss - allowedUncovered
       = 5000000 - 0
       = 5000000 ($5.00)

Record bad debt:
  marketBadDebt[marketId] += 5000000

Socialize:
  lossToSocialize = 0 (anchor protection prevented it)
```

### Final State
```
Helen:
  - Position: CLOSED
  - Collateral: $0.00 (wiped out)
  - Loss: $10.00 (all collateral seized)

Market:
  - Bad debt: $5.00 (excess beyond anchor-protected limit)
  - Socialized loss: $0.00 (protected by anchor)

Winners:
  - No haircuts applied (protected from delayed execution impact)
```

**Key Insight**: Without anchor protection, profitable traders would have been haircut $5.00 to cover slippage from delayed liquidation execution. Anchor protection assigns this as bad debt instead, preventing unfair socialization.

---

## Summary Table

| Example | Scenario | Outcome | Bad Debt | Socialized Loss |
|---------|----------|---------|----------|-----------------|
| 1 | Full short liquidation, sufficient collateral | Fully covered by user funds | $0.00 | $0.00 |
| 2 | Partial + full long liquidation, sufficient | Fully covered, penalty absorbed | $0.00 | $0.00 |
| 3 | Short liquidation, insufficient collateral | Shortfall distributed to winners | $2.00 | $10.00 |
| 4 | Position close with haircut | Haircut deducted from payout | $0.00 | $0.00 |
| 5 | Multi-round partial liquidation | Penalties on each partial fill | $0.00 | $0.00 |
| 6 | Delayed execution with anchor protection | Excess assigned as bad debt | $5.00 | $0.00 |

---

## Key Takeaways

1. **Penalties are NEVER socialized**: Only trading losses exceeding seized collateral are distributed.

2. **Anchor price protection**: Limits socialization to loss at liquidation trigger price, not delayed execution price.

3. **Partial liquidations**: Each partial fill incurs proportional penalty and margin confiscation.

4. **Haircut realization**: Haircuts are deducted from payouts when closing positions, proportional to units closed.

5. **Bad debt vs socialization**: Bad debt occurs when anchor protection limits socialization or no winners available; socialization distributes covered losses to profitable positions.

6. **Maker rewards**: Come from penalty portion of seized funds, distributed proportionally to liquidity providers.











