# Liquidation & Socialized Loss System - Technical Guide

## Table of Contents
1. [System Architecture](#system-architecture)
2. [Core Components](#core-components)
3. [Liquidation Workflow](#liquidation-workflow)
4. [Function Reference](#function-reference)
5. [Socialized Loss Mechanism](#socialized-loss-mechanism)
6. [Edge Cases & Safety Mechanisms](#edge-cases--safety-mechanisms)

---

## System Architecture

### Overview
The liquidation system is distributed across three main components:
- **CoreVault**: Manages user collateral, positions, and delegates heavy liquidation logic
- **LiquidationManager**: Implements core liquidation calculations and loss socialization
- **OBLiquidationFacet**: Handles order book-side liquidation execution and maker rewards

### Design Philosophy
- **Delegation Pattern**: CoreVault delegates complex liquidation logic to LiquidationManager via `delegatecall` to reduce bytecode size
- **Partial Liquidations**: Supports partial fills through order book matching with fallback to direct vault liquidation
- **Socialized Loss (ADL)**: Distributes uncovered losses across profitable positions proportionally
- **Anchor Price Protection**: Captures price at liquidation trigger to prevent over-socialization due to execution delays

---

## Core Components

### 1. CoreVault (`src/CoreVault.sol`)

**Role**: Central hub for collateral, positions, and liquidation coordination

**Key Storage**:
```solidity
mapping(address => uint256) public userCollateral;              // User's available collateral
mapping(address => int256) public userRealizedPnL;              // Realized PnL (18 decimals)
mapping(address => Position[]) public userPositions;             // User's active positions
mapping(address => uint256) public userSocializedLoss;          // Cumulative haircuts (6 decimals)
mapping(address => mapping(bytes32 => bool)) public isUnderLiquidationPosition;
mapping(address => mapping(bytes32 => uint256)) internal liquidationAnchorPrice;
mapping(bytes32 => uint256) public marketBadDebt;              // Uncovered losses per market
```

**Key Functions**:
- `setUnderLiquidation()`: Marks position as under liquidation control
- `getAvailableCollateral()`: Calculates withdrawable collateral after margin & haircuts
- `delegateLiq()`: Internal delegation to LiquidationManager

**Constants**:
- `LIQUIDATION_PENALTY_BPS = 1000` (10%)
- `DECIMAL_SCALE = 1e12` (conversion between 18 and 6 decimals)
- `TICK_PRECISION = 1e6` (price precision)

---

### 2. LiquidationManager (`src/LiquidationManager.sol`)

**Role**: Heavy lifting for liquidation calculations and socialized loss distribution

**Key Functions**:

#### Liquidation Execution

**`liquidateShort(address user, bytes32 marketId, address liquidator, uint256 executionPrice)`**
- **Purpose**: Liquidate a short position (user has negative size)
- **Flow**:
  1. Calculate trading loss: `(settlePrice - entryPrice) × |size|`
  2. Calculate penalty: `(|size| × settlePrice) × 10%`
  3. Seize collateral: `min(tradingLoss + penalty, marginLocked, userCollateral)`
  4. Apply anchor price protection to limit uncovered loss
  5. Distribute rewards to makers (from penalty portion)
  6. Socialize any uncovered trading loss
  7. Remove position and release margin

**`liquidateLong(address user, bytes32 marketId, address liquidator, uint256 executionPrice)`**
- **Purpose**: Liquidate a long position (user has positive size)
- **Flow**: Similar to `liquidateShort()` but:
  - Trading loss occurs when `settlePrice < entryPrice`
  - Loss calculation: `(entryPrice - settlePrice) × size`

**`updatePositionWithLiquidation(address user, bytes32 marketId, int256 sizeDelta, uint256 executionPrice, address liquidator)`**
- **Purpose**: Partial liquidation - reduce position size without full closure
- **Flow**:
  1. Check if trade closes or increases exposure
  2. For closing trades: execute position netting with liquidation penalties
  3. Calculate partial trading loss and penalty
  4. Seize proportional margin
  5. Update position size and margin
  6. Socialize any uncovered loss with anchor protection

#### Liquidation Check

**`isLiquidatable(address user, bytes32 marketId, uint256 markPrice)`**
- **Purpose**: Determine if a position can be liquidated
- **Logic**:
  1. If `isUnderLiquidationPosition == true`: immediately liquidatable
  2. Check stored `liquidationPrice` trigger:
     - Long: `markPrice <= liquidationPrice + 1`
     - Short: `markPrice >= liquidationPrice - 1`
  3. Fallback: calculate equity vs maintenance margin
     ```
     equity = marginLocked + unrealizedPnL
     maintenance = (notional × mmrBps) / 10000
     liquidatable if equity <= maintenance
     ```

**`_recomputeAndStoreLiquidationPrice(address user, bytes32 marketId)`**
- **Purpose**: Calculate and store fixed liquidation trigger price
- **Formula for Longs**:
  ```
  liquidationPrice = (mark - (equity/size)) × (10000 / (10000 - mmrBps))
  ```
- **Formula for Shorts**:
  ```
  liquidationPrice = (mark + (equity/size)) × (10000 / (10000 + mmrBps))
  ```

#### Socialized Loss (ADL)

**`_socializeLoss(bytes32 marketId, uint256 lossAmount, address liquidatedUser)`**
- **Purpose**: Distribute uncovered losses across profitable positions
- **Flow**:
  1. Find all profitable positions in the market (excluding liquidated user)
  2. Sort by profit score: `unrealizedPnL × positionSize`
  3. Select top K candidates (default: 50)
  4. Calculate each position's notional at mark price
  5. Allocate loss proportionally: `assign_i = lossAmount × (notional_i / totalNotional)`
  6. Cap allocation by position's equity above maintenance margin
  7. Apply haircut: increment `position.socializedLossAccrued6` and `position.haircutUnits18`
  8. Distribute any remaining loss in second pass
  9. Record unallocated remainder as `marketBadDebt`

**Haircut Tracking**:
```solidity
struct Position {
    uint256 socializedLossAccrued6;  // Total USDC haircut on this position
    uint256 haircutUnits18;          // Position units tagged at socialization
}
```

**`_findProfitablePositions(bytes32 marketId, address excludeUser)`**
- Returns array of profitable positions with their profit scores
- Used to identify ADL candidates

**`_calculateUnrealizedPnL(Position storage position, uint256 markPrice)`**
- Formula: `(markPrice - entryPrice) × size / TICK_PRECISION`
- Returns 18-decimal PnL

#### MMR Calculation

**`_computeEffectiveMMRBps(address user, bytes32 marketId, int256 positionSize)`**
- **Current Implementation**: Fixed 20% MMR
  ```
  mmr = baseMmrBps (10%) + penaltyMmrBps (10%) = 20%
  capped at maxMmrBps (20%)
  ```
- **Future**: Can incorporate liquidity-based scaling

---

### 3. OBLiquidationFacet (`src/diamond/facets/OBLiquidationFacet.sol`)

**Role**: Order book-side liquidation execution with maker rewards

**Key Functions**:

**`pokeLiquidations()`**
- **Purpose**: Entry point for liquidation scanning
- **Flow**:
  1. Calculate current mark price
  2. Update vault's stored mark price
  3. Call `_checkPositionsForLiquidation()`
  4. Handle pending rescans (if liquidation triggered during recursion)

**`_checkPositionsForLiquidation(uint256 markPrice)`**
- **Purpose**: Batch-check users for liquidation
- **Flow**:
  1. Get all users with positions in this market
  2. Iterate through batch (default: 50 checks per poke)
  3. For each user, call `_checkAndLiquidateTrader()`
  4. Stop after max liquidations per batch (default: 25)
  5. Update `lastCheckedIndex` for next poke
  6. Handle pending rescans if market moved during execution

**`_checkAndLiquidateTrader(address trader, uint256 markPrice)`**
- **Purpose**: Execute liquidation for a single trader
- **Flow**:
  1. Check if liquidatable via `vault.isLiquidatable()`
  2. Get position size
  3. **Market Order Attempt** (up to 5 attempts for partial fills):
     - Create synthetic market order in opposite direction
     - Match against order book with 15% slippage tolerance
     - Track execution prices and volumes
     - Process gap protection if execution price differs from liquidation trigger
  4. **Fallback to Direct Vault Liquidation**:
     - If market order fails or leaves remainder
     - Call `vault.liquidateShort()` or `vault.liquidateLong()`
     - Use mark price as execution price

**`_executeLiquidationMarketOrder(address trader, bool isBuy, uint256 amount, uint256 markPrice)`**
- **Purpose**: Execute market order for liquidation
- **Slippage Protection**:
  ```
  maxPrice = markPrice × 1.15  (for buys)
  minPrice = markPrice × 0.85  (for sells)
  ```
- **Execution**:
  1. Create synthetic order with slippage bounds
  2. Match against book via `_matchBuyOrder()` or `_matchSellOrder()`
  3. Track maker contributions for reward distribution
  4. If no fills within bounds, force cross at best available price
  5. Return execution result with metrics

**`_processEnhancedLiquidationWithGapProtection()`**
- **Purpose**: Handle gap loss and distribute maker rewards
- **Gap Loss Calculation**:
  ```
  For longs: if executionPrice < liquidationTriggerPrice
      gapLoss = (liquidationTriggerPrice - executionPrice) × size
  For shorts: if executionPrice > liquidationTriggerPrice
      gapLoss = (executionPrice - liquidationTriggerPrice) × size
  ```
- **Gap Confiscation**:
  - Confiscate from trader's available collateral up to gap loss
  - Prevents socialization of slippage losses
- **Maker Rewards**:
  1. Calculate expected penalty: `notional × 10%`
  2. Cap reward pool by OrderBook's available balance
  3. Distribute proportionally to makers by their contribution
  4. Call `vault.payMakerLiquidationReward()` for each maker

**`_recordLiquidationMakerContribution(address maker, uint256 price, uint256 amount)`**
- Tracks maker's notional contribution during liquidation
- Used for proportional reward distribution
- Capped at 64 recipients (`MAX_LIQUIDATION_REWARD_RECIPIENTS`)

**`_distributeLiquidationRewards(address liquidatedUser, uint256 rewardAmount)`**
- **Purpose**: Pay out maker rewards proportionally
- **Formula**: `share = rewardAmount × (makerNotional / totalNotional)`
- Handles failures gracefully to avoid reverting liquidation

---

## Liquidation Workflow

### Full Liquidation Flow (Step-by-Step)

```
┌─────────────────────────────────────────────────────────────┐
│ 1. TRIGGER DETECTION                                         │
│    OBLiquidationFacet.pokeLiquidations()                    │
│    ↓                                                         │
│    - Calculate mark price                                   │
│    - Update vault's stored mark price                       │
│    - Call _checkPositionsForLiquidation()                   │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 2. BATCH SCANNING                                            │
│    _checkPositionsForLiquidation(markPrice)                 │
│    ↓                                                         │
│    - Get users with positions in market                     │
│    - Iterate checksPerPoke (default: 50)                    │
│    - For each user: _checkAndLiquidateTrader()              │
│    - Stop after maxLiquidations (default: 25)               │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 3. LIQUIDATION CHECK                                         │
│    _checkAndLiquidateTrader(trader, markPrice)              │
│    ↓                                                         │
│    LiquidationManager.isLiquidatable(trader, marketId, mark)│
│    ↓                                                         │
│    [A] If isUnderLiquidationPosition == true → liquidate    │
│    [B] If markPrice crosses liquidationPrice → liquidate    │
│    [C] If equity ≤ maintenance margin → liquidate           │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 4. MARKET ORDER EXECUTION (Primary Path)                    │
│    _executeLiquidationMarketOrder(trader, isBuy, amount, mark)│
│    ↓                                                         │
│    - Create synthetic market order (opposite of position)   │
│    - Set slippage bounds (±15% from mark)                   │
│    - Match against order book via _matchBuyOrder/_matchSell │
│    - Track maker contributions for rewards                  │
│    - Record worst execution price                           │
│    ↓                                                         │
│    Up to 5 attempts for partial fills                       │
│    ↓                                                         │
│    If filled > 0: _processEnhancedLiquidationWithGapProtection()│
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 5. GAP PROTECTION & REWARDS                                  │
│    _processEnhancedLiquidationWithGapProtection()           │
│    ↓                                                         │
│    [A] Calculate Gap Loss:                                  │
│        Long: gapLoss = max(0, liquidationPrice - execPrice) │
│        Short: gapLoss = max(0, execPrice - liquidationPrice)│
│    ↓                                                         │
│    [B] Emit gap-loss telemetry (no confiscation):           │
│        LiquidationMarketGapDetected fired for monitoring    │
│        Any deficit beyond locked margin → socialized loss   │
│    ↓                                                         │
│    [C] Distribute Maker Rewards:                            │
│        rewardPool = min(expectedPenalty, OB balance)        │
│        For each maker: share ∝ contribution                 │
│        vault.payMakerLiquidationReward(maker, share)        │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 6. VAULT-SIDE LIQUIDATION (For Full/Partial Close)          │
│    LiquidationManager.liquidateShort/Long()                 │
│    ↓                                                         │
│    [A] Calculate Trading Loss:                              │
│        Short: (settlePrice - entryPrice) × |size|           │
│        Long: (entryPrice - settlePrice) × size              │
│        Convert to 6 decimals: loss / (DECIMAL_SCALE × TICK) │
│    ↓                                                         │
│    [B] Calculate Penalty (10% of notional):                 │
│        notional = (|size| × settlePrice) / 1e18             │
│        penalty = notional × 0.10                            │
│    ↓                                                         │
│    [C] Determine Seizure:                                   │
│        actualLoss = tradingLoss + penalty                   │
│        seizableFromLocked = min(actualLoss, marginLocked)   │
│        seized = min(seizableFromLocked, userCollateral)     │
│    ↓                                                         │
│    [D] Consume Funds (prefer external credit first):        │
│        fromExternal = min(seized, userCrossChainCredit)     │
│        fromCollateral = seized - fromExternal               │
│    ↓                                                         │
│    [E] Distribute Seized Funds:                             │
│        seizedForTradingLoss = min(seized, tradingLoss)      │
│        seizedForPenalty = seized - seizedForTradingLoss     │
│        Credit OrderBook: seizedForPenalty (for maker rewards)│
│    ↓                                                         │
│    [F] Calculate Uncovered Loss (with anchor protection):   │
│        uncoveredLoss = max(0, tradingLoss - seized)         │
│        If anchorPrice exists:                               │
│            anchorTradingLoss = loss at min(execPrice, anchor)│
│            allowedUncovered = max(0, anchorLoss - seized)   │
│            excess = uncoveredLoss - allowedUncovered        │
│            Record excess as marketBadDebt                   │
│    ↓                                                         │
│    [G] Realize PnL:                                         │
│        realizedPnL = (settlePrice - entryPrice) × size / TICK│
│        userRealizedPnL[user] += realizedPnL                 │
│    ↓                                                         │
│    [H] Remove Position:                                     │
│        Pop position from array                              │
│        Release marginLocked from totalMarginLocked          │
│        Clear liquidation flags and anchor                   │
│    ↓                                                         │
│    [I] Socialize Uncovered Loss (if > 0):                   │
│        _socializeLoss(marketId, uncoveredLoss, user)        │
└────────────────────┬────────────────────────────────────────┘
                     ↓
┌─────────────────────────────────────────────────────────────┐
│ 7. SOCIALIZED LOSS DISTRIBUTION (ADL)                        │
│    _socializeLoss(marketId, lossAmount, liquidatedUser)    │
│    ↓                                                         │
│    [A] Find Profitable Positions:                           │
│        For each user in market (exclude liquidated):        │
│            unrealizedPnL = (mark - entry) × size / TICK     │
│            If unrealizedPnL > 0:                            │
│                profitScore = unrealizedPnL × |size|         │
│                Add to candidates                            │
│    ↓                                                         │
│    [B] Select Top K:                                        │
│        Sort by profitScore (highest first)                  │
│        Take top adlMaxCandidates (default: 50)              │
│    ↓                                                         │
│    [C] Calculate Allocations:                               │
│        For each position i:                                 │
│            notional_i = |size_i| × markPrice                │
│            targetAssign_i = lossAmount × (notional_i / totalNotional)│
│    ↓                                                         │
│    [D] Cap by Available Equity:                             │
│        equity_i = marginLocked + unrealizedPnL              │
│        maintenance_i = notional_i × mmrBps / 10000          │
│        cap_i = max(0, equity_i - maintenance_i)             │
│        assign_i = min(targetAssign_i, cap_i)                │
│    ↓                                                         │
│    [E] Apply Haircuts:                                      │
│        position.socializedLossAccrued6 += assign_i          │
│        unitsTagged = (assign_i × 1e18) / markPrice          │
│        position.haircutUnits18 += unitsTagged               │
│        userSocializedLoss[user] += assign_i                 │
│        emit HaircutApplied(user, marketId, assign_i, ...)   │
│    ↓                                                         │
│    [F] Second Pass for Remainder:                           │
│        If unallocated > 0:                                  │
│            Distribute to positions with remaining capacity  │
│    ↓                                                         │
│    [G] Record Bad Debt:                                     │
│        If still unallocated:                                │
│            marketBadDebt[marketId] += remaining             │
│            emit BadDebtRecorded(marketId, remaining, user)  │
└─────────────────────────────────────────────────────────────┘
```

### Partial Liquidation Flow

```
┌─────────────────────────────────────────────────────────────┐
│ Partial Liquidation via updatePositionWithLiquidation()     │
│                                                              │
│ 1. Determine if trade closes exposure                       │
│    closesExposure = (oldSize > 0 && sizeDelta < 0) ||      │
│                     (oldSize < 0 && sizeDelta > 0)          │
│                                                              │
│ 2. If NOT closing: Execute position netting                 │
│    - Calculate new size: newSize = oldSize + sizeDelta      │
│    - Calculate required margin at execution price           │
│    - Execute PositionManager.executePositionNetting()       │
│    - Update margin accounting                               │
│    - Return (no liquidation penalty for increasing)         │
│                                                              │
│ 3. If closing: Calculate partial close amounts              │
│    closeAbs = min(|sizeDelta|, |oldSize|)                   │
│    newSize = oldSize + sizeDelta (may be 0 or flip)         │
│                                                              │
│ 4. Calculate partial trading loss & penalty                 │
│    tradingLossClosed = lossPerUnit × closeAbs               │
│    penaltyClosed = (closeAbs × execPrice) × 10%             │
│                                                              │
│ 5. Determine seizure from margin                            │
│    newRequiredMargin = _calculateExecutionMargin(newSize)   │
│    confiscatable = oldLocked - newRequiredMargin            │
│    seized = min(confiscatable, tradingLoss + penalty, collateral)│
│                                                              │
│ 6. Apply anchor protection for uncovered loss               │
│    anchorTradingLoss = calculate loss at anchor price       │
│    allowedUncovered = max(0, anchorLoss - seized)           │
│    excess = uncoveredLoss - allowedUncovered                │
│    Record excess as marketBadDebt                           │
│                                                              │
│ 7. Update position                                          │
│    position.size = newSize                                  │
│    position.marginLocked = newRequiredMargin                │
│    If newSize == 0: remove position                         │
│    Else: set isUnderLiquidationPosition = true              │
│                                                              │
│ 8. Socialize allowed uncovered loss                         │
│    _socializeLoss(marketId, allowedUncovered, user)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Function Reference

### LiquidationManager Key Functions

| Function | Purpose | Called By | Returns |
|----------|---------|-----------|---------|
| `isLiquidatable()` | Check if position meets liquidation criteria | OrderBook facet | `bool` |
| `getLiquidationPrice()` | Get stored liquidation trigger price | External views | `(uint256, bool)` |
| `setUnderLiquidation()` | Mark position as under liquidation control | OrderBook | - |
| `liquidateShort()` | Execute full short liquidation | OrderBook | - |
| `liquidateLong()` | Execute full long liquidation | OrderBook | - |
| `updatePositionWithLiquidation()` | Execute partial liquidation | OrderBook | - |
| `socializeLoss()` | Public entry for loss socialization | OrderBook | - |
| `payMakerLiquidationReward()` | Distribute maker rewards | OrderBook | - |
| `getAvailableCollateral()` | Calculate withdrawable funds | External | `uint256` |

### OBLiquidationFacet Key Functions

| Function | Purpose | Access | Returns |
|----------|---------|--------|---------|
| `pokeLiquidations()` | Trigger liquidation scan | External | - |
| `pokeLiquidationsMulti()` | Run multiple liquidation rounds | External | - |
| `setConfigLiquidationScanOnTrade()` | Enable auto-scan after trades | Owner | - |
| `setLiquidationScanParams()` | Configure batch sizes | Owner | - |
| `setConfigLiquidationDebug()` | Toggle debug events | Owner | - |

### CoreVault Liquidation Interface

| Function | Purpose | Called By | Returns |
|----------|---------|-----------|---------|
| `setUnderLiquidation()` | Set liquidation control flag | OrderBook | - |
| `getAvailableCollateral()` | View available balance | Anyone | `uint256` |
| `topUpPositionMargin()` | User adds margin to position | User | - |
| `payMakerLiquidationReward()` | Transfer rewards to makers | OrderBook | - |

---

## Socialized Loss Mechanism

### Haircut Lifecycle

1. **Accrual**: When position is profitable and selected for ADL
   ```solidity
   position.socializedLossAccrued6 += assignedLoss;
   position.haircutUnits18 += (assignedLoss × 1e18) / markPrice;
   userSocializedLoss[user] += assignedLoss;
   ```

2. **Realization**: When position is closed or partially closed
   ```solidity
   haircutClosed = (socializedLossAccrued6 × unitsReleased) / haircutUnits18;
   position.socializedLossAccrued6 -= haircutClosed;
   position.haircutUnits18 -= unitsReleased;
   // Deducted from payout in position netting
   ```

3. **Payout Calculation**:
   ```
   grossPnL = (exitPrice - entryPrice) × size / TICK_PRECISION
   netPayout = marginLocked + grossPnL - haircutRealized
   ```

### ADL Selection Algorithm

1. **Candidate Identification**:
   - Scan all positions in market
   - Filter for `unrealizedPnL > 0`
   - Calculate profit score: `unrealizedPnL × |size| / 1e18`

2. **Top-K Selection**:
   - Sort candidates by profit score (descending)
   - Take top `adlMaxCandidates` (default: 50)

3. **Proportional Allocation**:
   ```
   notional_i = |size_i| × markPrice / 1e18
   targetAssign_i = lossAmount × (notional_i / Σnotional)
   ```

4. **Capacity Capping**:
   ```
   equity_i = marginLocked_i + unrealizedPnL_i
   maintenance_i = notional_i × mmrBps / 10000
   cap_i = max(0, equity_i - maintenance_i)
   actualAssign_i = min(targetAssign_i, cap_i)
   ```

5. **Second-Pass Distribution**:
   - Remaining loss allocated to positions with spare capacity
   - Prevents under-utilization of available winner equity

### Anchor Price Protection

**Purpose**: Prevent excessive socialization when liquidation execution is delayed

**Mechanism**:
1. When position enters liquidation control (`isUnderLiquidationPosition = true`):
   ```solidity
   liquidationAnchorPrice[user][marketId] = currentMarkPrice;
   liquidationAnchorTimestamp[user][marketId] = block.timestamp;
   ```

2. On liquidation, calculate loss at **both** execution price and anchor price:
   ```solidity
   executionTradingLoss = (execPrice - entry) × size
   anchorTradingLoss = (anchorPrice - entry) × size
   ```

3. Allow socialization only up to anchor-based loss:
   ```solidity
   allowedUncovered = max(0, anchorTradingLoss - seized)
   excess = uncoveredLoss - allowedUncovered
   if (excess > 0) marketBadDebt[marketId] += excess;
   ```

**Example**:
- Position enters liquidation at mark = $2.08 (anchor set)
- Market moves to $2.50 before execution
- Trading loss at $2.50: $15.00
- Trading loss at anchor $2.08: $10.80
- Seized collateral: $8.00
- Allowed socialization: $10.80 - $8.00 = $2.80
- Excess recorded as bad debt: $15.00 - $8.00 - $2.80 = $4.20

---

## Edge Cases & Safety Mechanisms

### 1. Insufficient Liquidity
**Scenario**: No opposing orders to close liquidated position

**Handling**:
- Market order attempts up to 5 times for partial fills
- Falls back to direct vault liquidation at mark price
- Vault uses mark price as settlement price
- No slippage penalty if no executions occurred

### 2. Gap Loss (Slippage)
**Scenario**: Execution price worse than liquidation trigger price

**Handling**:
- Calculate gap loss: `|executionPrice - liquidationPrice| × size`
- Confiscate from user's **available** collateral (not locked margin)
- Prevents socializing slippage losses to winners
- Graceful degradation if user has insufficient available funds

### 3. Partial Fills
**Scenario**: Only part of position can be executed

**Handling**:
- Process each fill individually via `updatePositionWithLiquidation()`
- Calculate penalty proportional to closed size
- Allow multiple attempts (up to 5 iterations)
- Remaining position stays under liquidation control

### 4. Bad Debt
**Scenario**: Winners cannot fully absorb losses

**Handling**:
- Track per-market: `marketBadDebt[marketId]`
- Recorded when:
  - ADL capacity exhausted
  - Anchor protection limits socialization
  - User has zero collateral
- Never reverts liquidation process
- Emits `BadDebtRecorded` for off-chain tracking

### 5. Maker Reward Shortfall
**Scenario**: OrderBook has insufficient balance for full penalty rewards

**Handling**:
- Cap reward pool: `min(expectedPenalty, obBalance)`
- Distribute proportionally to all contributing makers
- Gracefully handle payment failures (best-effort, no revert)

### 6. Recursion Protection
**Scenario**: Liquidation triggers during ongoing liquidation scan

**Handling**:
```solidity
if (liquidationInProgress) {
    pendingLiquidationRescan = true;
    return; // exit immediately
}
// ... process liquidations ...
if (pendingLiquidationRescan) {
    recalculate mark and rescan
}
```

### 7. Batch Limits
**Configuration**:
- `maxLiquidationChecksPerPoke = 50`: Users checked per batch
- `maxLiquidationsPerPoke = 25`: Liquidations executed per batch
- Progressive scanning via `lastCheckedIndex`

**Prevents**: Gas limit issues, ensures fair scanning across all users

### 8. Haircut Floor Protection
**Mechanism**: Margin can be reduced below haircut amount
- Haircuts are NOT enforced as a margin floor
- Haircuts are realized from **payout streams** (when closing)
- Allows organic margin adjustments without artificial constraints

### 9. Cross-Chain Credit vs Collateral
**Mechanism**: Funds consumed in priority order
1. Realized PnL (converted to 6 decimals)
2. Cross-chain credit (`userCrossChainCredit`)
3. On-chain collateral (`userCollateral`)

**Preservation**: When crediting OrderBook or makers, maintain backing type

---

## Mathematical Formulas Reference

### PnL Calculations
```
Standard PnL (18 decimals):
    pnl18 = (markPrice - entryPrice) × size / TICK_PRECISION
    where markPrice, entryPrice in 6 decimals, size in 18 decimals

Liquidation Loss (6 decimals):
    loss6 = (priceGap × size) / (DECIMAL_SCALE × TICK_PRECISION)
    = (priceGap × size) / (1e12 × 1e6)
```

### Margin Requirements
```
Long margin: notional × 100% = (size × price / 1e18)
Short margin: notional × 150% = (size × price / 1e18) × 1.5

Maintenance margin: notional × mmrBps / 10000
```

### Liquidation Trigger (Fixed Price)
```
For longs:
    liqPrice = (mark - equity/size) × 10000 / (10000 - mmrBps)

For shorts:
    liqPrice = (mark + equity/size) × 10000 / (10000 + mmrBps)

where equity = marginLocked + unrealizedPnL6
```

### Socialized Loss Allocation
```
Target allocation:
    assign_i = totalLoss × (notional_i / Σnotional_j)

Capacity cap:
    cap_i = max(0, equity_i - maintenance_i)
    equity_i = marginLocked_i + unrealizedPnL_i
    maintenance_i = notional_i × mmrBps / 10000

Actual assignment:
    actualAssign_i = min(assign_i, cap_i)
```

---

## Configuration Parameters

### Liquidation Constants
```solidity
LIQUIDATION_PENALTY_BPS = 1000          // 10%
SHORT_MARGIN_REQUIREMENT_BPS = 1500     // 150%
LONG_MARGIN_REQUIREMENT_BPS = 1000      // 100%
DECIMAL_SCALE = 1e12                    // 18d → 6d conversion
TICK_PRECISION = 1e6                    // Price precision
```

### MMR Parameters (Current: Fixed 20%)
```solidity
baseMmrBps = 1000           // 10% base
penaltyMmrBps = 1000        // +10% penalty
maxMmrBps = 2000            // 20% cap
scalingSlopeBps = 0         // disabled
priceGapSlopeBps = 0        // disabled
mmrLiquidityDepthLevels = 1 // minimal depth sampling
```

### ADL Controls
```solidity
adlMaxCandidates = 50           // Top-K profitable positions considered
adlMaxPositionsPerTx = 10       // Max reductions per ADL execution
adlDebug = false                // Verbose event logging
```

### Liquidation Scanning
```solidity
maxLiquidationChecksPerPoke = 50    // Users scanned per poke
maxLiquidationsPerPoke = 25         // Liquidations executed per poke
liquidationScanOnTrade = false      // Auto-scan after trades
```

### Slippage Tolerance
```solidity
liquidationSlippageBps = 1500       // ±15% from mark price
```

---

## Events Reference

### Liquidation Events
```solidity
event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
event MarginConfiscated(address indexed user, uint256 marginAmount, uint256 totalLoss, uint256 penalty, address indexed liquidator);
event AutoLiquidationTriggered(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 markPrice);
```

### Socialized Loss Events
```solidity
event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
event HaircutApplied(address indexed user, bytes32 indexed marketId, uint256 debitAmount, uint256 collateralAfter);
event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
```
> Gap-loss telemetry now lives entirely in `LiquidationMarketGapDetected`; no additional collateral seizure events are emitted.

### Reward Events
```solidity
event MakerLiquidationRewardPaid(address indexed maker, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount);
event LiquidatorRewardPaid(address indexed liquidator, address indexed liquidatedUser, bytes32 indexed marketId, uint256 rewardAmount, uint256 liquidatorCollateral);
```

### Debug Events (when `adlDebug = true`)
```solidity
event DebugIsLiquidatable(...);  // Detailed liquidation check breakdown
event ProfitablePositionFound(...);  // ADL candidate identification
event DebugProfitCalculation(...);  // PnL calculation details
event DebugPositionReduction(...);  // ADL position reduction
event SocializationCompleted(...);  // ADL distribution summary
event SocializationFailed(...);  // ADL failure reason
```

---

## Integration Points

### CoreVault ↔ LiquidationManager
- **Delegation**: CoreVault uses `delegatecall` to LiquidationManager
- **Shared Storage**: Both contracts must maintain **identical** storage layout
- **Functions Delegated**: `liquidateShort`, `liquidateLong`, `updatePositionWithLiquidation`, `socializeLoss`

### OrderBook ↔ CoreVault
- **Roles**: OrderBook has `ORDERBOOK_ROLE` on CoreVault
- **Calls**: `setUnderLiquidation`, `liquidateShort/Long`, `updatePositionWithLiquidation`, `payMakerLiquidationReward`
- **Views**: `isLiquidatable`, `getMarkPrice`, `getPositionSummary`, `getAvailableCollateral`

### OBLiquidationFacet ↔ OBTradeExecutionFacet
- **Trade Execution**: Liquidation facet delegates to trade execution via internal call:
  ```solidity
  address(this).call(abi.encodeWithSignature(
      "obExecuteTrade(address,address,uint256,uint256,bool,bool)",
      buyer, seller, price, amount, buyerMargin, sellerMargin
  ));
  ```
- **Maker Tracking**: Liquidation facet tracks contributions for reward distribution

---

## Summary

This liquidation system implements a sophisticated multi-layered approach:

1. **Trigger Detection**: Continuous scanning via `pokeLiquidations()` with batch processing
2. **Market Execution**: Primary path through order book matching with slippage protection
3. **Gap Protection**: Confiscates additional collateral for execution slippage
4. **Vault Liquidation**: Calculates losses, seizes margin, distributes rewards
5. **Anchor Protection**: Prevents over-socialization from delayed executions
6. **ADL Distribution**: Proportionally haircuts profitable positions
7. **Bad Debt Tracking**: Records unrecoverable losses without reverting

**Key Innovations**:
- Partial liquidation support with penalty calculations
- Maker reward distribution from penalty pool
- Anchor price capping for fair socialization
- Haircut realization from payout streams (not margin floor)
- Graceful degradation at every failure point

**Gas Optimization**:
- Batch processing with configurable limits
- Progressive scanning via index tracking
- Library delegation for complex logic
- Capped ADL candidates and recipients

