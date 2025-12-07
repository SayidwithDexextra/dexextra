# Liquidation System - Executive Summary

## 📋 Table of Contents
- [System Overview](#system-overview)
- [Architecture](#architecture)
- [Liquidation Pipeline](#liquidation-pipeline)
- [Key Features](#key-features)
- [Contract Responsibilities](#contract-responsibilities)
- [Documentation Guide](#documentation-guide)

---

> **Notice (Dec 2025):** Legacy `pokeLiquidations` scanners and scan-on-trade toggles have been removed. This summary still references them for legacy deployments; current systems rely exclusively on `liquidateDirect`.

## System Overview

The DexExtra liquidation system is a **multi-layered, gas-optimized liquidation engine** that handles position liquidations with sophisticated loss distribution across profitable traders.

### Core Objectives
1. **Automated Liquidation**: Continuous scanning and execution of underwater positions
2. **Fair Loss Distribution**: Proportional socialization across profitable positions (ADL)
3. **Execution Optimization**: Market order matching before vault-side fallback
4. **Slippage Protection**: Gap loss confiscation and anchor price protection
5. **Maker Incentives**: Reward liquidity providers from penalty pool

---

## Architecture

### Component Hierarchy

```
┌─────────────────────────────────────────────────────────┐
│                    CoreVault                            │
│  - User collateral & positions                          │
│  - Delegates heavy logic to LiquidationManager          │
│  - Coordinates with OrderBook facets                    │
└────────────┬────────────────────────────────────────────┘
             │
             │ delegatecall (shared storage)
             ↓
┌─────────────────────────────────────────────────────────┐
│              LiquidationManager                         │
│  - Liquidation calculations                             │
│  - Socialized loss distribution (ADL)                   │
│  - Anchor price protection                              │
│  - Bad debt tracking                                    │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│             OBLiquidationFacet                          │
│  (Diamond Pattern - OrderBook side)                     │
│  - Automated liquidation scanning                       │
│  - Market order execution                               │
│  - Gap protection & maker rewards                       │
└─────────────────────────────────────────────────────────┘
```

### Data Flow

```
1. Trigger Detection
   OBLiquidationFacet.pokeLiquidations()
   └→ Batch scan users for liquidatable positions

2. Liquidation Check
   LiquidationManager.isLiquidatable()
   └→ Check: Under liquidation flag OR price trigger OR equity < MMR

3. Market Order Execution (Primary Path)
   OBLiquidationFacet._executeLiquidationMarketOrder()
   ├→ Match against order book (up to 5 attempts for partials)
   ├→ Track maker contributions for rewards
   └→ Record worst execution price

4. Gap Protection
   OBLiquidationFacet._processEnhancedLiquidationWithGapProtection()
   └→ Confiscate available collateral for execution slippage

5. Vault-Side Liquidation
   LiquidationManager.liquidateShort/Long()
   ├→ Calculate trading loss and penalty
   ├→ Seize margin from user
   ├→ Credit OrderBook with penalty (for maker rewards)
   └→ Determine uncovered loss

6. Anchor Price Protection
   Apply cap to uncovered loss at liquidation trigger price
   └→ Prevents over-socialization from delayed execution

7. Socialized Loss Distribution (ADL)
   LiquidationManager._socializeLoss()
   ├→ Find profitable positions (exclude liquidated user)
   ├→ Sort by profit score, select top K
   ├→ Allocate loss proportionally by notional
   ├→ Cap by available equity above maintenance
   ├→ Apply haircuts to positions
   └→ Record bad debt if remainder exists

8. Maker Reward Distribution
   OBLiquidationFacet._distributeLiquidationRewards()
   └→ Pay rewards from penalty pool, proportional to liquidity provided
```

---

## Liquidation Pipeline

### Phase 1: Detection (Automated)
- **Trigger**: `pokeLiquidations()` called by keeper/automated system
- **Batch Size**: 50 users per scan (configurable)
- **Criteria**: Position crosses liquidation trigger or equity ≤ maintenance

### Phase 2: Execution (Multi-Path)
- **Path A (Primary)**: Market order matching on order book
  - Up to 5 attempts for partial fills
  - 15% slippage tolerance from mark price
  - Tracks execution metrics and maker contributions
  
- **Path B (Fallback)**: Direct vault liquidation
  - Used when no order book liquidity
  - Settles at mark price
  - No maker rewards (no counterparty)

### Phase 3: Loss Calculation
```
Trading Loss = |executionPrice - entryPrice| × |size|
Penalty = notional × 10%
Seized = min(tradingLoss + penalty, marginLocked, userCollateral)
Uncovered = max(0, tradingLoss - seized)
```

### Phase 4: Protection Mechanisms
- **Gap Protection**: Confiscate for slippage beyond trigger price
- **Anchor Protection**: Cap socialization at liquidation entry price
- **Fund Priority**: Consume external credit before on-chain collateral

### Phase 5: Socialization (If Uncovered > 0)
```
1. Identify profitable positions (PnL > 0)
2. Calculate profit scores: unrealizedPnL × |size|
3. Select top K candidates (default: 50)
4. Allocate proportionally by notional
5. Cap by equity above maintenance margin
6. Apply haircuts to position.socializedLossAccrued6
7. Tag units: position.haircutUnits18
8. Record bad debt if insufficient capacity
```

### Phase 6: Rewards (If Penalty Collected)
```
Reward Pool = min(expectedPenalty, OrderBook balance)
For each maker: share = rewardPool × (contribution / totalContribution)
Payment: OrderBook → Maker (preserve funding type)
```

---

## Key Features

### 1. Partial Liquidation Support
- Positions can be liquidated incrementally
- Each partial fill incurs proportional penalty
- Margin adjusts based on remaining position size
- Supports multi-round execution

### 2. Anchor Price Protection
- Captures price when liquidation control begins
- Limits socialized loss to amount at anchor price
- Prevents unfair socialization from execution delays
- Excess recorded as bad debt instead

**Example:**
```
Position enters liquidation at $2.00 (anchor set)
Market moves to $2.50 before execution
Loss at $2.50: $15.00
Loss at anchor $2.00: $10.00
Allowed socialization: $10.00
Excess bad debt: $5.00
```

### 3. Gap Loss Confiscation
- Detects when execution price worse than trigger price
- Confiscates from user's **available** collateral (not locked margin)
- Prevents socializing slippage losses to winners
- Best-effort (doesn't revert liquidation if insufficient)

### 4. Haircut Lifecycle
```
Accrual (ADL triggered):
  position.socializedLossAccrued6 += assignedLoss
  position.haircutUnits18 += (assignedLoss × 1e18) / markPrice

Realization (position closed):
  haircutClosed = (accrued × unitsReleased) / haircutUnits
  Deducted from payout: marginRelease + PnL - haircutClosed
```

### 5. Maker Rewards
- Funded from 10% penalty on liquidated position
- Distributed proportionally to liquidity providers
- Capped by OrderBook's available balance
- Maximum 64 recipients per liquidation

### 6. Gas Optimization
- Batch processing (configurable limits)
- Progressive scanning via `lastCheckedIndex`
- Library delegation for complex logic
- Capped ADL candidates and recipients
- Graceful degradation (no reverts on failures)

---

## Contract Responsibilities

### CoreVault
**Storage & Coordination**
- User collateral: `userCollateral[address]`
- Positions: `userPositions[address][]`
- Realized PnL: `userRealizedPnL[address]` (18 decimals)
- Socialized loss ledger: `userSocializedLoss[address]` (6 decimals)
- Market bad debt: `marketBadDebt[marketId]` (6 decimals)

**Key Functions**
- `getAvailableCollateral(user)`: Calculate withdrawable balance
- `setUnderLiquidation(user, marketId, state)`: Liquidation control flag
- `topUpPositionMargin(marketId, amount)`: User adds margin
- Delegates to LiquidationManager for heavy logic

### LiquidationManager
**Core Liquidation Logic**
- `isLiquidatable(user, marketId, mark)`: Check liquidation criteria
- `liquidateShort/Long(user, marketId, liquidator, execPrice)`: Full liquidation
- `updatePositionWithLiquidation(...)`: Partial liquidation
- `_socializeLoss(marketId, lossAmount, liquidatedUser)`: ADL distribution
- `payMakerLiquidationReward(...)`: Transfer rewards to makers

**MMR Calculation**
- Current: Fixed 20% (base 10% + penalty 10%)
- Future: Can incorporate liquidity-based dynamic MMR

### OBLiquidationFacet
**Scanning & Execution**
- `pokeLiquidations()`: Batch liquidation scan
- `pokeLiquidationsMulti(rounds)`: Multi-round scanning
- `_checkPositionsForLiquidation(mark)`: User iteration logic
- `_checkAndLiquidateTrader(trader, mark)`: Single user liquidation
- `_executeLiquidationMarketOrder(...)`: Order book matching
- `_processEnhancedLiquidationWithGapProtection(...)`: Post-execution handling
- `_distributeLiquidationRewards(...)`: Maker reward payout

**Configuration**
- `setLiquidationScanParams(checks, maxLiqs)`: Batch limits
- `setConfigLiquidationScanOnTrade(enabled)`: Auto-scan toggle
- `setConfigLiquidationDebug(enabled)`: Verbose events

### PositionManager (Library)
**Position Operations**
- `executePositionNetting(...)`: Update position with trade
- Handles entry price calculation (weighted average for same direction)
- Manages margin locking/releasing
- Realizes haircuts proportionally on close
- Returns `NettingResult` with haircut confiscated amount

---

## Documentation Guide

### 📚 For Different Audiences

#### New Developers
**Start here:**
1. [README.md](./README.md) - Overview and quick start
2. [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - One-page cheat sheet
3. [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md) - Example 1

**Then:**
4. [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) - Full architecture
5. [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md) - Execution flows

#### Smart Contract Developers
**Priority:**
1. [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md) - Function call chains
2. [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) - Function reference
3. [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md) - All examples

**Key Sections:**
- Storage layout (for delegatecall compatibility)
- Decimal precision handling
- Error handling patterns

#### Frontend Developers
**Essential:**
1. [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - API quick ref
2. [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) - "For Frontend Developers" section

**Key Views:**
- Health ratio calculation
- Liquidation price display
- Accrued haircuts per position
- Available balance (not just collateral)

#### System Operators / Keepers
**Focus:**
1. [README.md](./README.md) - "For Backend/Keeper Operators" section
2. [QUICK_REFERENCE.md](./QUICK_REFERENCE.md) - Configuration parameters
3. [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) - Events reference

**Monitoring:**
- Configure `pokeLiquidations` cron jobs
- Monitor liquidation events
- Track bad debt accumulation
- Alert on socialization events

#### Auditors / Security Researchers
**Critical Paths:**
1. [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md) - All flows
2. [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md) - Edge cases
3. [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md) - All examples

**Focus Areas:**
- Anchor price protection logic
- Socialized loss capping
- Bad debt vs socialization split
- Fund consumption priority
- Haircut realization math

---

## File Summary

| File | Size | Purpose | Audience |
|------|------|---------|----------|
| **README.md** | 12 KB | Entry point, structure, integration guide | All |
| **QUICK_REFERENCE.md** | 11 KB | One-page cheat sheet, formulas, common operations | All |
| **LIQUIDATION_SYSTEM_GUIDE.md** | 38 KB | Complete architecture, function reference | Developers |
| **FUNCTION_FLOW_DIAGRAMS.md** | 22 KB | Execution flows, call chains, state machines | Developers |
| **WORKED_EXAMPLES.md** | 23 KB | 6 scenarios with full calculations | All |
| **SYSTEM_SUMMARY.md** | This file | Executive overview, architecture summary | Management |

**Total:** ~112 KB of comprehensive documentation

---

## Key Metrics & Limits

| Parameter | Default Value | Purpose |
|-----------|--------------|---------|
| Liquidation Penalty | 10% | Incentive for liquidators/makers |
| Maintenance Margin (MMR) | 20% | Liquidation threshold |
| Max Checks Per Poke | 50 | Batch size for scanning |
| Max Liquidations Per Poke | 25 | Execution limit per batch |
| ADL Max Candidates | 50 | Top profitable positions |
| Liquidation Slippage | ±15% | Market order price bounds |
| Max Maker Recipients | 64 | Reward distribution cap |

---

## Critical Invariants

1. **Penalties are NEVER socialized**: Only trading losses
2. **Haircuts ≤ Profit**: ADL capped by equity above maintenance
3. **No Margin Below Haircut Floor**: Margin can drop below accrued haircut (haircuts realized from payouts, not margin)
4. **Fund Consumption Order**: Realized PnL → External credit → Collateral
5. **Anchor Protection**: Socialization ≤ loss at liquidation trigger price
6. **Bad Debt Transparency**: All unrecoverable losses tracked per market

---

## Future Enhancements

### Potential Improvements
1. **Dynamic MMR**: Liquidity-based maintenance margin scaling
2. **Insurance Fund**: Backstop for bad debt before socialization
3. **Liquidation Auctions**: Time-delayed dutch auction for better fills
4. **Cross-Market ADL**: Socialize across correlated markets
5. **Liquidation Bonding**: Staked liquidators with performance incentives

### Optimization Opportunities
1. **Parallel Liquidations**: Process multiple users simultaneously
2. **Predictive Scanning**: ML-based liquidation candidate prediction
3. **Gas Batching**: Combine multiple liquidations in single transaction
4. **Off-Chain Matching**: Order book matching before on-chain settlement

---

## Production Checklist

### Pre-Deployment
- [ ] Configure MMR parameters for target risk profile
- [ ] Set appropriate batch limits for network gas constraints
- [ ] Deploy LiquidationManager and link to CoreVault
- [ ] Grant ORDERBOOK_ROLE to facets
- [ ] Test delegatecall storage alignment

### Post-Deployment
- [ ] Configure automated `pokeLiquidations` calls
- [ ] Set up event monitoring and alerting
- [ ] Deploy keeper infrastructure with redundancy
- [ ] Establish bad debt resolution process
- [ ] Create emergency pause procedures

### Monitoring
- [ ] Real-time health ratio tracking
- [ ] Liquidation execution success rates
- [ ] Bad debt accumulation trends
- [ ] Socialized loss distribution fairness
- [ ] Maker reward distribution accuracy

---

## Support & Resources

**Documentation Files:**
- Main Guide: [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md)
- Quick Ref: [QUICK_REFERENCE.md](./QUICK_REFERENCE.md)
- Examples: [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md)
- Flows: [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md)

**Related Documentation:**
- Project README: `../../README.md`
- MMR System: `../../MMR_SYSTEM_EXPLAINED.md`
- Contract Interactions: `../../CONTRACT_INTERACTIONS_SUMMARY.md`

**Smart Contracts:**
- CoreVault: `../../src/CoreVault.sol`
- LiquidationManager: `../../src/LiquidationManager.sol`
- OBLiquidationFacet: `../../src/diamond/facets/OBLiquidationFacet.sol`
- PositionManager: `../../src/PositionManager.sol`

---

**Version:** 1.0  
**Last Updated:** December 2025  
**Status:** Production Ready


