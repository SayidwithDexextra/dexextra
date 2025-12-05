# Liquidation System - Quick Reference Cheat Sheet

## 🎯 One-Page Overview

### System Components
```
┌─────────────────┐
│   CoreVault     │  ← User collateral & position storage
│  (Main Hub)     │  ← Delegates heavy logic to LiquidationManager
└────────┬────────┘
         │ delegatecall
         ↓
┌─────────────────┐
│ Liquidation     │  ← Core liquidation calculations
│   Manager       │  ← Socialized loss distribution (ADL)
└─────────────────┘

┌─────────────────┐
│ OBLiquidation   │  ← Scanning & triggering
│     Facet       │  ← Market order execution
│  (OrderBook)    │  ← Maker reward distribution
└─────────────────┘
```

---

## 📊 Key Numbers

| Constant | Value | Meaning |
|----------|-------|---------|
| `LIQUIDATION_PENALTY_BPS` | 1000 | 10% penalty on liquidation |
| `MMR_BPS` | 2000 | 20% maintenance margin |
| `TICK_PRECISION` | 1e6 | 6 decimals for prices |
| `DECIMAL_SCALE` | 1e12 | 18d → 6d conversion |
| `maxLiquidationChecksPerPoke` | 50 | Users scanned per batch |
| `maxLiquidationsPerPoke` | 25 | Liquidations per batch |
| `adlMaxCandidates` | 50 | Top profitable positions |
| `liquidationSlippageBps` | 1500 | ±15% slippage tolerance |

---

## 🔍 Liquidation Check (3 Methods)

```solidity
// Method 1: Manual flag (highest priority)
if (isUnderLiquidationPosition[user][marketId]) → LIQUIDATE

// Method 2: Price trigger (most common)
if (positionSize > 0) {  // Long
    if (markPrice <= liquidationPrice) → LIQUIDATE
}
else {  // Short
    if (markPrice >= liquidationPrice) → LIQUIDATE
}

// Method 3: Equity check (fallback)
equity = marginLocked + unrealizedPnL(6d)
maintenance = notional × 0.20
if (equity <= maintenance) → LIQUIDATE
```

---

## 💰 Money Flow in Liquidation

### Seizure Calculation
```
tradingLoss = (|executionPrice - entryPrice| × |size|) / (1e18 × 1e6)  // 6d
penalty = (notional × 10%) / 1e18                                      // 6d
actualLoss = tradingLoss + penalty

seized = min(actualLoss, marginLocked, userCollateral)
```

### Fund Consumption Priority
```
1. userRealizedPnL (if positive, in 6d)
2. userCrossChainCredit (external balance)
3. userCollateral (on-chain deposits)
```

### Distribution
```
seizedForTradingLoss = min(seized, tradingLoss)
seizedForPenalty = seized - seizedForTradingLoss

→ TradingLoss covered: system balance preserved
→ Penalty → OrderBook → Makers (proportional rewards)
```

### Uncovered Loss
```
uncoveredLoss = max(0, tradingLoss - seized)

If anchorPrice exists:
  anchorTradingLoss = calculate loss at min/max(execPrice, anchorPrice)
  allowedUncovered = max(0, anchorLoss - seized)
  excess = uncoveredLoss - allowedUncovered
  
  → Socialize: allowedUncovered
  → Bad Debt: excess
Else:
  → Socialize: uncoveredLoss
```

---

## 🎲 Socialized Loss (ADL) - 7 Steps

```
1. Find all profitable positions (exclude liquidated user)
   profitScore = unrealizedPnL × |size| / 1e18

2. Sort by profitScore, take top K (default: 50)

3. Calculate notionals at mark:
   notional_i = |size_i| × markPrice / 1e18

4. Proportional allocation:
   targetAssign_i = lossAmount × (notional_i / totalNotional)

5. Cap by available equity:
   equity_i = marginLocked + unrealizedPnL
   maintenance_i = notional_i × 0.20
   cap_i = max(0, equity_i - maintenance_i)
   assign_i = min(targetAssign_i, cap_i)

6. Apply haircuts:
   position.socializedLossAccrued6 += assign_i
   position.haircutUnits18 += (assign_i × 1e18) / markPrice

7. Record bad debt if remainder > 0:
   marketBadDebt[marketId] += unallocated
```

---

## 🧮 Formula Cheatsheet

### Unrealized PnL (18 decimals)
```
pnl18 = (markPrice - entryPrice) × size / 1e6
```

### Unrealized PnL (6 decimals for equity)
```
pnl6 = pnl18 / 1e12
```

### Liquidation Trigger Price
```
equity = marginLocked + unrealizedPnL6
ePerUnit = (equity × 1e18) / |size|

LONG:
  numerator = max(0, mark - ePerUnit)
  liqPrice = (numerator × 10000) / (10000 - 2000)  // 8000

SHORT:
  numerator = max(0, mark + ePerUnit)
  liqPrice = (numerator × 10000) / (10000 + 2000)  // 12000
```

### Available Collateral
```
available = userCollateral
          - Σ(position.marginLocked)
          - Σ(pendingOrder.marginReserved)
          + max(0, realizedPnL) / 1e12
          - Σ(position.socializedLossAccrued6)
```

### Notional Value
```
notional6 = (|size| × price) / 1e18
```

---

## 📞 Critical Function Calls

### Trigger Liquidation
```solidity
// Automated scanning (call periodically)
OBLiquidationFacet.pokeLiquidations()

// Multi-round scan
OBLiquidationFacet.pokeLiquidationsMulti(rounds)
```

### Check Status
```solidity
// Is position liquidatable?
bool canLiq = LiquidationManager.isLiquidatable(user, marketId, mark)

// Get trigger price
(uint256 liqPrice, bool hasPos) = LiquidationManager.getLiquidationPrice(user, marketId)

// Get available balance
uint256 available = CoreVault.getAvailableCollateral(user)
```

### Execute (Called by OrderBook)
```solidity
// Full liquidation
CoreVault.liquidateShort(user, marketId, liquidator, execPrice)
CoreVault.liquidateLong(user, marketId, liquidator, execPrice)

// Partial liquidation
CoreVault.updatePositionWithLiquidation(user, marketId, sizeDelta, execPrice, liquidator)
```

---

## 🎨 Position State Colors

```
🟢 Healthy:     equity > 200% × maintenance
🟡 Warning:     200% > equity > 120%
🟠 At Risk:     120% > equity > 100%
🔴 Liquidatable: equity ≤ 100% × maintenance
⚫ Liquidating:  isUnderLiquidationPosition == true
```

**Health Ratio Formula:**
```
healthRatio = (marginLocked + unrealizedPnL6) / (notional6 × 0.20)
```

---

## 🚨 Events to Monitor

### Liquidation Execution
```solidity
event AutoLiquidationTriggered(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 markPrice)
event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral)
```

### Socialization
```solidity
event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser)
event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter)
event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser)
```

### Maker Rewards
```solidity
event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount)
```

### Gap Protection
```solidity
event LiquidationMarketGapDetected(address indexed trader, uint256 liquidationPrice, uint256 actualExecutionPrice, int256 positionSize, uint256 gapLoss)
event AvailableCollateralConfiscated(address indexed user, uint256 amount, uint256 remainingAvailable)
```

---

## 🛠️ Configuration (Owner Only)

```solidity
// Scan parameters
facet.setLiquidationScanParams(checksPerPoke, maxLiquidationsPerPoke)

// Auto-scan toggle
facet.setConfigLiquidationScanOnTrade(true)

// Debug mode
facet.setConfigLiquidationDebug(true)

// MMR parameters (CoreVault)
vault.setMmrParams(baseMmrBps, penaltyMmrBps, maxMmrBps, scalingSlopeBps, liquidityDepthLevels)

// ADL parameters (LiquidationManager via delegatecall)
// No direct setter; modified in deployment
```

---

## 🔥 Common Pitfalls

### ❌ Don't Do This
```solidity
// WRONG: Using userCollateral directly for available balance
uint256 available = vault.userCollateral(user);  // ❌ Ignores locked margin!

// WRONG: Calculating PnL without TICK_PRECISION
pnl = (mark - entry) × size;  // ❌ Precision mismatch!

// WRONG: Assuming all seized goes to penalty
penaltyReceived = seized;  // ❌ TradingLoss is covered first!

// WRONG: Socializing penalty
lossToSocialize = tradingLoss + penalty;  // ❌ Only tradingLoss!
```

### ✅ Do This Instead
```solidity
// CORRECT: Use proper API
uint256 available = vault.getAvailableCollateral(user);

// CORRECT: Include TICK_PRECISION
int256 pnl18 = (int256(mark) - int256(entry)) × size / int256(1e6);

// CORRECT: Understand fund flow
uint256 tradingCovered = min(seized, tradingLoss);
uint256 penaltyPortion = seized - tradingCovered;

// CORRECT: Only trading loss
uint256 lossToSocialize = max(0, tradingLoss - seized);
```

---

## 📚 Quick Links

| Topic | File |
|-------|------|
| **Full System Architecture** | [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) |
| **Function Call Flows** | [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md) |
| **Numerical Examples** | [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md) |
| **Documentation Index** | [README.md](./README.md) |

---

## 💡 Pro Tips

1. **Enable debug mode** when developing:
   ```javascript
   await facet.setConfigLiquidationDebug(true);
   ```

2. **Monitor health ratios** in real-time for user alerts.

3. **Use anchor price protection** to prevent unfair socialization from delayed executions.

4. **Batch liquidations** efficiently with `pokeLiquidationsMulti(rounds)`.

5. **Track bad debt** separately from socialized losses for accurate accounting.

6. **Test with edge cases**: zero liquidity, simultaneous liquidations, haircut realization.

7. **Remember decimal precision**:
   - Prices: 6 decimals
   - Sizes: 18 decimals
   - Internal PnL: 18 decimals
   - Collateral: 6 decimals

---

## 🧪 Quick Testing Commands

```javascript
// Check if user can be liquidated
const canLiq = await vault.isLiquidatable(user, marketId, currentMark);

// Get user's position
const positions = await vault.getUserPositions(user);
console.log("Size:", positions[0].size);
console.log("Entry:", positions[0].entryPrice);
console.log("Margin:", positions[0].marginLocked);
console.log("Haircut:", positions[0].socializedLossAccrued6);

// Trigger liquidation scan
await orderBook.pokeLiquidations();

// Check market bad debt
const badDebt = await vault.marketBadDebt(marketId);
console.log("Bad Debt:", ethers.utils.formatUnits(badDebt, 6), "USDC");
```

---

## 🎓 Learning Path

**Beginner:**
1. Read [README.md](./README.md) overview
2. Study Example 1 in [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md)
3. Review "Quick Reference" (this file)

**Intermediate:**
4. Deep dive into [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md)
5. Study Examples 2-4 in [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md)
6. Trace flows in [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md)

**Advanced:**
7. Study Examples 5-6 (edge cases)
8. Implement custom liquidation strategies
9. Optimize gas usage with batch operations
10. Extend ADL algorithm or anchor protection logic

---

**Last Updated:** December 2025  
**Version:** 1.0  
**Contact:** See main project documentation

