# Liquidation Function Flow Diagrams

## Quick Reference: Function Call Chains

> **Notice (Dec 2025):** Flow #1 documents the legacy `pokeLiquidations` scanner, which has been removed. Use the diagram as historical reference only; modern keepers invoke `liquidateDirect`.

### 1. Automated Liquidation Scan

```
External Call
    ↓
OBLiquidationFacet.pokeLiquidations()
    ↓
OBPricingFacet.calculateMarkPrice() [staticcall]
    ↓
CoreVault.updateMarkPrice(marketId, mark) [SETTLEMENT_ROLE]
    ↓
OBLiquidationFacet._checkPositionsForLiquidation(mark)
    ├─→ CoreVault.getUsersWithPositionsInMarket(marketId)
    └─→ For each user:
        └─→ OBLiquidationFacet._checkAndLiquidateTrader(user, mark)
            ├─→ LiquidationManager.isLiquidatable(user, marketId, mark) [delegatecall]
            │   └─→ Check: isUnderLiquidationPosition OR price trigger OR equity < MMR
            ├─→ CoreVault.getPositionSummary(user, marketId)
            ├─→ If liquidatable:
            │   └─→ OBLiquidationFacet._executeLiquidationMarketOrder(user, isBuy, amount, mark)
            │       ├─→ OBLiquidationFacet._matchBuyOrder() OR _matchSellOrder()
            │       │   └─→ For each matched order:
            │       │       ├─→ OBTradeExecutionFacet.obExecuteTrade(...) [internal call]
            │       │       └─→ OBLiquidationFacet._recordLiquidationMakerContribution(maker, price, amount)
            │       └─→ OBLiquidationFacet._processEnhancedLiquidationWithGapProtection(...)
            │           ├─→ Calculate gap loss & emit LiquidationMarketGapDetected (informational only; shortfalls roll into socialization once locked margin is exhausted)
            │           ├─→ OBPricingFacet.calculateMarkPrice() [recalc after execution]
            │           └─→ OBLiquidationFacet._distributeLiquidationRewards(liquidatedUser, rewardPool)
            │               └─→ For each maker:
            │                   └─→ CoreVault.payMakerLiquidationReward(liquidatedUser, marketId, maker, share)
            │                       └─→ Consume OB funds, credit maker
            └─→ Fallback if market order fails:
                └─→ If size < 0:
                    └─→ CoreVault.liquidateShort(user, marketId, OB, execPrice)
                        └─→ LiquidationManager.liquidateShort(...) [delegatecall]
                            ├─→ Calculate tradingLoss and penalty
                            ├─→ Seize collateral from user
                            ├─→ Credit OrderBook with penalty portion
                            ├─→ Apply anchor price protection
                            ├─→ Remove position
                            └─→ LiquidationManager._socializeLoss(marketId, uncoveredLoss, user)
                                └─→ [See Socialized Loss Flow]
                └─→ If size > 0:
                    └─→ CoreVault.liquidateLong(user, marketId, OB, execPrice)
                        └─→ [Similar to liquidateShort]
```

---

## 2. Partial Liquidation via Trade Execution

```
OBTradeExecutionFacet.obExecuteTrade(buyer, seller, price, amount, ...)
    ↓
If liquidationMode == true && trader == liquidationTarget:
    ↓
    CoreVault.updatePositionWithLiquidation(trader, marketId, sizeDelta, price, liquidator)
        ↓
        LiquidationManager.updatePositionWithLiquidation(...) [delegatecall]
            ├─→ Check if closing exposure:
            │   └─→ closesExposure = (oldSize > 0 && sizeDelta < 0) OR (oldSize < 0 && sizeDelta > 0)
            ├─→ If NOT closing (increasing position):
            │   └─→ PositionManager.executePositionNetting(...)
            │       └─→ Update position size, entry price, margin
            │       └─→ Return (no penalty)
            └─→ If closing:
                ├─→ Calculate closeAbs = min(|sizeDelta|, |oldSize|)
                ├─→ Calculate tradingLossClosed on closeAbs
                ├─→ Calculate penaltyClosed = (closeAbs × execPrice) × 10%
                ├─→ Determine newRequiredMargin for remaining position
                ├─→ Calculate confiscatable = oldLocked - newRequired
                ├─→ seized = min(confiscatable, tradingLoss + penalty, userCollateral)
                ├─→ Consume funds: prefer external credit, then collateral
                ├─→ Credit OrderBook with penalty portion
                ├─→ Apply anchor price protection:
                │   ├─→ Calculate anchorTradingLoss at min(execPrice, anchorPrice)
                │   ├─→ allowedUncovered = max(0, anchorLoss - seized)
                │   ├─→ excess = uncoveredLoss - allowedUncovered
                │   └─→ If excess > 0: marketBadDebt[marketId] += excess
                ├─→ Update position:
                │   ├─→ position.size = newSize
                │   ├─→ position.marginLocked = newRequiredMargin
                │   └─→ If newSize == 0: remove position
                │       Else: set isUnderLiquidationPosition = true
                ├─→ Realize PnL for closed portion
                └─→ If allowedUncovered > 0:
                    └─→ LiquidationManager._socializeLoss(marketId, allowedUncovered, user)
                        └─→ [See Socialized Loss Flow]
```

---

## 3. Socialized Loss Distribution (ADL)

```
LiquidationManager._socializeLoss(marketId, lossAmount, liquidatedUser)
    ↓
    ├─→ LiquidationManager._getUsersWithPositionsInMarket(marketId)
    │   └─→ Returns array of all users with positions in this market
    ├─→ LiquidationManager._findProfitablePositions(marketId, liquidatedUser)
    │   └─→ For each user in market (exclude liquidatedUser):
    │       ├─→ Get user's position
    │       ├─→ Calculate unrealizedPnL = (mark - entry) × size / TICK_PRECISION
    │       └─→ If unrealizedPnL > 0:
    │           ├─→ profitScore = unrealizedPnL × |size| / 1e18
    │           └─→ Add to profitable positions array
    ├─→ If profitablePositions.length == 0:
    │   ├─→ marketBadDebt[marketId] += lossAmount
    │   └─→ emit SocializationFailed(...)
    │       └─→ RETURN
    ├─→ If profitablePositions.length > adlMaxCandidates:
    │   └─→ LiquidationManager._selectTopKByProfitScore(positions, adlMaxCandidates)
    │       └─→ Returns top K positions by profitScore
    ├─→ Calculate notionals for each position:
    │   └─→ notional_i = |size_i| × markPrice / 1e18
    │       totalNotional = Σ notional_i
    ├─→ Calculate target allocations:
    │   └─→ targetAssign_i = lossAmount × (notional_i / totalNotional)
    ├─→ First pass: allocate up to capacity
    │   └─→ For each profitable position i:
    │       ├─→ Get position from userPositions[user_i]
    │       ├─→ Calculate equity = marginLocked + unrealizedPnL
    │       ├─→ Calculate maintenance = notional × mmrBps / 10000
    │       ├─→ cap_i = max(0, equity - maintenance)
    │       ├─→ assign_i = min(targetAssign_i, cap_i)
    │       ├─→ If assign_i > 0:
    │       │   ├─→ position.socializedLossAccrued6 += assign_i
    │       │   ├─→ unitsTagged = (assign_i × 1e18) / markPrice
    │       │   ├─→ position.haircutUnits18 += unitsTagged
    │       │   ├─→ userSocializedLoss[user_i] += assign_i
    │       │   └─→ emit HaircutApplied(user_i, marketId, assign_i, ...)
    │       └─→ remainingCap[i] = cap_i - assign_i
    ├─→ Second pass: distribute remaining loss
    │   └─→ For each position with remainingCap > 0:
    │       ├─→ addl = min(remaining, remainingCap[i])
    │       ├─→ Apply additional haircut
    │       └─→ remaining -= addl
    └─→ If still remaining > 0:
        ├─→ marketBadDebt[marketId] += remaining
        └─→ emit BadDebtRecorded(marketId, remaining, liquidatedUser)
```

---

## 4. Haircut Realization (Position Close)

```
User closes position via trade OR liquidation
    ↓
PositionManager.executePositionNetting(positions, user, marketId, sizeDelta, execPrice, ...)
    ├─→ Find existing position
    ├─→ oldSize = position.size
    ├─→ oldHaircut6 = position.socializedLossAccrued6
    ├─→ oldHaircutUnits18 = position.haircutUnits18
    ├─→ newSize = oldSize + sizeDelta
    ├─→ If closing direction (opposite signs):
    │   ├─→ closedAbs = min(|sizeDelta|, |oldSize|)
    │   ├─→ Calculate realizedPnL for closed portion
    │   └─→ If newSize == 0 (full close):
    │       ├─→ haircutToConfiscate6 = oldHaircut6 (entire haircut realized)
    │       ├─→ Remove position from array
    │       └─→ marginToRelease = position.marginLocked
    │   └─→ Else if partial close:
    │       ├─→ unitsToRelease18 = min(closedAbs, oldHaircutUnits18)
    │       ├─→ haircutClosed6 = (oldHaircut6 × unitsToRelease18) / oldHaircutUnits18
    │       ├─→ position.socializedLossAccrued6 -= haircutClosed6
    │       ├─→ position.haircutUnits18 -= unitsToRelease18
    │       ├─→ haircutToConfiscate6 = haircutClosed6
    │       └─→ Update position.size, position.entryPrice, position.marginLocked
    └─→ Return NettingResult with haircutToConfiscate6
        ↓
Caller (CoreVault or LiquidationManager):
    ├─→ If haircutToConfiscate6 > 0:
    │   └─→ Deduct from payout:
    │       - Standard close: reduce realized PnL credit
    │       - Liquidation close: already seized from collateral, no additional deduction
    └─→ Payout formula:
        └─→ netPayout = marginReleased + realizedPnL - haircutConfiscated
```

---

## 5. Available Collateral Calculation

```
CoreVault.getAvailableCollateral(user)
    ↓
    LiquidationManager.getAvailableCollateral(user) [delegatecall]
        ├─→ Convert userPositions to VaultAnalytics.Position[] (view format)
        ├─→ VaultAnalytics.getAvailableCollateral(userCollateral[user], positions)
        │   ├─→ baseAvailable = userCollateral
        │   ├─→ For each position:
        │   │   └─→ baseAvailable -= position.marginLocked
        │   └─→ For each pending order:
        │       └─→ baseAvailable -= order.marginReserved
        ├─→ Get userRealizedPnL[user] (18 decimals)
        ├─→ Convert to 6 decimals: realizedPnL6 = realizedPnL18 / DECIMAL_SCALE
        ├─→ If no positions and realizedPnL6 < 0: realizedPnL6 = 0
        ├─→ baseWithRealized = baseAvailable + realizedPnL6
        ├─→ If baseWithRealized > 0:
        │   ├─→ Sum all outstanding haircuts:
        │   │   └─→ outstandingHaircut6 = Σ position.socializedLossAccrued6
        │   └─→ availableWithRealized = max(0, baseWithRealized - outstandingHaircut6)
        └─→ Return availableWithRealized
```

---

## 6. Liquidation Price Calculation

```
User opens/modifies position OR tops up margin
    ↓
CoreVault._recomputeAndStoreLiquidationPrice(user, marketId)
    ↓
    LiquidationManager._recomputeAndStoreLiquidationPrice(user, marketId)
        ├─→ Find position in userPositions[user]
        ├─→ Get MMR: (mmrBps, _) = _computeEffectiveMMRBps(user, marketId, position.size)
        ├─→ Get current mark price: mark = getMarkPrice(marketId)
        │   └─→ If mark == 0: mark = position.entryPrice (fallback)
        ├─→ Calculate unrealized PnL:
        │   ├─→ priceDiff = mark - entryPrice
        │   ├─→ pnl18 = (priceDiff × size) / TICK_PRECISION
        │   └─→ pnl6 = pnl18 / DECIMAL_SCALE
        ├─→ Calculate equity: equity6 = marginLocked + pnl6
        ├─→ Get absolute size: absSize = |size|
        ├─→ If absSize == 0: liquidationPrice = 0; RETURN
        ├─→ Calculate equity per unit: eOverQ6 = (equity6 × 1e18) / absSize
        ├─→ If position.size > 0 (long):
        │   ├─→ numerator = max(0, mark - eOverQ6)
        │   ├─→ denomBps = 10000 - mmrBps
        │   └─→ liquidationPrice = (numerator × 10000) / denomBps
        └─→ If position.size < 0 (short):
            ├─→ numerator = max(0, mark + eOverQ6)
            ├─→ denomBps = 10000 + mmrBps
            └─→ liquidationPrice = (numerator × 10000) / denomBps
        ↓
        Update: position.liquidationPrice = calculated value
```

**Example Calculation (Long Position)**:
```
Given:
- size = 100 ALU (1e20 in 18 decimals)
- entryPrice = $1.00 (1000000 in 6 decimals)
- marginLocked = $120 (120000000 in 6 decimals)
- mark = $1.10 (1100000 in 6 decimals)
- mmrBps = 2000 (20%)

Steps:
1. priceDiff = 1100000 - 1000000 = 100000
2. pnl18 = (100000 × 1e20) / 1e6 = 1e19 ($10.00 in 18d)
3. pnl6 = 1e19 / 1e12 = 1e7 ($10.00 in 6d)
4. equity6 = 120000000 + 10000000 = 130000000 ($130.00)
5. absSize = 1e20
6. eOverQ6 = (130000000 × 1e18) / 1e20 = 1300000 ($1.30 per unit)
7. numerator = 1100000 - 1300000 = 0 (cannot be negative, so 0)
   → Actually: mark - eOverQ should be negative, so we need to recalculate:
   → eOverQ represents equity/size in price terms
   → For long: liq at mark - (equity/size) / (1 - mmr)
   
Correct formula:
   liqPrice = mark - (equity/size) × (1 - mmr)
   But in code: liqPrice = (mark - eOverQ) × 10000 / (10000 - mmrBps)
   
If numerator ends up negative (equity is very high), liqPrice = 0 (safe position)
If numerator is positive, liqPrice = numerator × 10000 / 8000 (for 20% MMR)

For our example with high equity, liqPrice might be very low or 0, meaning position is safe.
```

---

## 7. Mark Price Updates

```
After each trade OR manual poke:
    ↓
OBPricingFacet.calculateMarkPrice() [staticcall from within Diamond]
    ├─→ Calculate hybrid mark based on:
    │   ├─→ Last trade price (weighted)
    │   ├─→ Mid-price (bid + ask) / 2 (weighted)
    │   └─→ Weighting based on trade recency and book depth
    └─→ Return calculated mark
        ↓
CoreVault.updateMarkPrice(marketId, mark) [called by SETTLEMENT_ROLE = OrderBook]
    └─→ marketMarkPrices[marketId] = mark
```

---

## 8. User Topup Flow

```
User calls: CoreVault.topUpPositionMargin(marketId, amount)
    ├─→ Check available collateral: getAvailableCollateral(msg.sender)
    ├─→ Require available >= amount
    ├─→ CoreVault._increasePositionMargin(msg.sender, marketId, amount)
    │   ├─→ Find position with marketId and size != 0
    │   ├─→ position.marginLocked += amount
    │   ├─→ totalMarginLocked += amount
    │   ├─→ emit MarginLocked(...)
    │   └─→ CoreVault._recomputeAndStoreLiquidationPrice(msg.sender, marketId)
    │       └─→ [See Liquidation Price Calculation]
    └─→ emit MarginToppedUp(msg.sender, marketId, amount)
```

---

## 9. Gap Loss Confiscation

```
OBLiquidationFacet._processEnhancedLiquidationWithGapProtection(trader, positionSize, liquidationTriggerPrice, executionResult)
    ├─→ If executionResult.worstExecutionPrice != liquidationTriggerPrice:
    │   └─→ If positionSize > 0 (long):
    │       └─→ If worstPrice < triggerPrice:
    │           └─→ priceGap = triggerPrice - worstPrice
    │               gapLoss = (|positionSize| × priceGap) / 1e18
    │   └─→ If positionSize < 0 (short):
    │       └─→ If worstPrice > triggerPrice:
    │           └─→ priceGap = worstPrice - triggerPrice
    │               gapLoss = (|positionSize| × priceGap) / 1e18
    ├─→ If gapLoss > 0:
    │   ├─→ available = vault.getAvailableCollateral(trader)
    │   ├─→ toConfiscate = min(gapLoss, available)
    │   └─→ If toConfiscate > 0:
    │       └─→ Try: vault.confiscateAvailableCollateralForGapLoss(trader, toConfiscate)
    │           └─→ LiquidationManager.confiscateAvailableCollateralForGapLoss(...) [delegatecall]
    │               ├─→ Require: getAvailableCollateral(user) >= gapLossAmount
    │               ├─→ Consume funds: prefer external credit, then collateral
    │               │   ├─→ useExt = min(gapLossAmount, userCrossChainCredit[user])
    │               │   ├─→ userCrossChainCredit[user] -= useExt
    │               │   └─→ userCollateral[user] -= (gapLossAmount - useExt)
    │               └─→ emit AvailableCollateralConfiscated(user, gapLossAmount, remainingAvailable)
    └─→ Note: Confiscation is best-effort; wrapped in try/catch to avoid reverting liquidation
```

---

## 10. Maker Reward Distribution

```
OBLiquidationFacet._distributeLiquidationRewards(liquidatedUser, rewardAmount)
    ├─→ If rewardAmount == 0 OR totalNotionalScaled == 0 OR makers.length == 0: RETURN
    ├─→ emit DebugRewardDistributionStart(liquidatedUser, rewardAmount)
    ├─→ For each maker in liquidationMakers[]:
    │   ├─→ Calculate share:
    │   │   └─→ share = (rewardAmount × makerNotionalScaled[i]) / totalNotionalScaled
    │   ├─→ If share > 0:
    │   │   └─→ Call: vault.payMakerLiquidationReward(liquidatedUser, marketId, maker, share)
    │   │       └─→ CoreVault.payMakerLiquidationReward(...) [delegatecall to LiquidationManager]
    │   │           ├─→ Validate: maker != 0, amount > 0
    │   │           ├─→ Validate: marketToOrderBook[marketId] == msg.sender (OrderBook)
    │   │           ├─→ Consume from OrderBook:
    │   │           │   ├─→ fromExt = min(amount, userCrossChainCredit[OB])
    │   │           │   ├─→ userCrossChainCredit[OB] -= fromExt
    │   │           │   └─→ userCollateral[OB] -= (amount - fromExt)
    │   │           ├─→ Credit maker (preserve backing):
    │   │           │   ├─→ userCrossChainCredit[maker] += fromExt
    │   │           │   └─→ userCollateral[maker] += (amount - fromExt)
    │   │           └─→ emit MakerLiquidationRewardPaid(maker, liquidatedUser, marketId, amount)
    │   └─→ emit DebugMakerRewardPayOutcome(...)
    └─→ If remaining > 0 (dust from rounding):
        └─→ Pay to first maker (best-effort)
        └─→ emit DebugRewardDistributionEnd(liquidatedUser)
```

---

## Cross-Contract Call Summary

| From Contract | To Contract | Function | Access Pattern | Purpose |
|--------------|-------------|----------|----------------|---------|
| OBLiquidationFacet | CoreVault | `updateMarkPrice` | External call (SETTLEMENT_ROLE) | Update stored mark |
| OBLiquidationFacet | CoreVault | `isLiquidatable` | External call | Check liquidation criteria |
| OBLiquidationFacet | CoreVault | `getPositionSummary` | External call | Get user position |
| OBLiquidationFacet | CoreVault | `getUsersWithPositionsInMarket` | External call | Get all users to scan |
| OBLiquidationFacet | CoreVault | `liquidateShort/Long` | External call | Execute full liquidation |
| OBLiquidationFacet | CoreVault | `payMakerLiquidationReward` | External call | Pay maker rewards |
| OBLiquidationFacet | OBTradeExecutionFacet | `obExecuteTrade` | Internal call (Diamond) | Execute liquidation trade |
| OBLiquidationFacet | OBPricingFacet | `calculateMarkPrice` | Staticcall (Diamond) | Get current mark |
| CoreVault | LiquidationManager | `liquidateShort/Long` | Delegatecall | Heavy liquidation logic |
| CoreVault | LiquidationManager | `updatePositionWithLiquidation` | Delegatecall | Partial liquidation |
| CoreVault | LiquidationManager | `isLiquidatable` | Delegatecall | Liquidation check |
| CoreVault | LiquidationManager | `getAvailableCollateral` | Delegatecall | Calculate withdrawable |
| LiquidationManager | PositionManager | `executePositionNetting` | Library call | Update position state |
| LiquidationManager | VaultAnalytics | `getAvailableCollateral` | Library call | Calculate available funds |

> Gap loss handling no longer confiscates free collateral; once locked margin is depleted the remaining deficit immediately routes through `socializeLoss`.
---

## Key State Transitions

### Position State Machine

```
[No Position]
    ↓ (User opens position)
[Active Position]
    ├─→ liquidationPrice set/updated on: open, modify, topup, mark change
    ├─→ socializedLossAccrued6 = 0
    └─→ haircutUnits18 = 0
        ↓ (Position becomes liquidatable)
[Under Liquidation]
    ├─→ isUnderLiquidationPosition = true
    ├─→ liquidationAnchorPrice = current mark
    └─→ liquidationAnchorTimestamp = block.timestamp
        ↓ (Liquidation executes - partial)
[Partially Liquidated]
    ├─→ Position size reduced
    ├─→ Margin adjusted
    └─→ Still isUnderLiquidationPosition = true
        ↓ (Remaining position closed OR fully liquidated)
[Position Removed]
    ├─→ isUnderLiquidationPosition = false
    ├─→ liquidationAnchorPrice = 0
    ├─→ liquidationAnchorTimestamp = 0
    └─→ Margin released
```

### Haircut State Machine

```
[No Haircut]
    ↓ (User's position selected for ADL)
[Haircut Accrued]
    ├─→ socializedLossAccrued6 > 0
    ├─→ haircutUnits18 > 0
    └─→ userSocializedLoss[user] > 0
        ↓ (User partially closes position)
[Haircut Partially Realized]
    ├─→ haircutConfiscated = (accrued × unitsReleased) / haircutUnits
    ├─→ socializedLossAccrued6 reduced
    ├─→ haircutUnits18 reduced
    └─→ Deducted from payout
        ↓ (User fully closes position)
[Haircut Fully Realized]
    ├─→ Entire socializedLossAccrued6 deducted from final payout
    ├─→ Position removed
    └─→ userSocializedLoss[user] remains as historical ledger
```

