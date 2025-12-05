# Liquidation & Socialized Loss Documentation

## Overview

This folder contains comprehensive documentation for the DexExtra liquidation and socialized loss system. The system implements a sophisticated multi-layered approach to position liquidation with automated loss distribution across profitable positions.

---

## Documentation Files

### 📖 [LIQUIDATION_SYSTEM_GUIDE.md](./LIQUIDATION_SYSTEM_GUIDE.md)
**Primary technical reference** - Complete system architecture and implementation details.

**Contents:**
- System architecture and design philosophy
- Core components (CoreVault, LiquidationManager, OBLiquidationFacet)
- Detailed function reference with parameters and return values
- Socialized loss (ADL) mechanism
- Edge cases and safety mechanisms
- Mathematical formulas
- Configuration parameters
- Events reference
- Integration points

**Use this when:** You need to understand how any component works, looking up function signatures, or understanding the overall system design.

---

### 🔀 [FUNCTION_FLOW_DIAGRAMS.md](./FUNCTION_FLOW_DIAGRAMS.md)
**Function call chains and execution flows** - Visual representation of how functions interact.

**Contents:**
- 10 detailed function flow diagrams covering:
  - Automated liquidation scan
  - Partial liquidation via trade execution
  - Socialized loss distribution (ADL)
  - Haircut realization on position close
  - Available collateral calculation
  - Liquidation price calculation
  - Mark price updates
  - User topup flow
  - Gap loss confiscation
  - Maker reward distribution
- Cross-contract call summary
- Position and haircut state machines

**Use this when:** Tracing execution paths, understanding cross-contract interactions, or debugging call sequences.

---

### 🧮 [WORKED_EXAMPLES.md](./WORKED_EXAMPLES.md)
**Numerical examples with step-by-step calculations** - Real-world scenarios with complete math.

**Contents:**
- 6 comprehensive worked examples:
  1. Full liquidation of short position (sufficient collateral)
  2. Liquidation with insufficient collateral → socialization
  3. Liquidation with socialization (true shortfall)
  4. Haircut realization on position close
  5. Multi-round partial liquidation
  6. Anchor price protection limiting socialization
- All calculations shown in full detail
- Summary comparison table

**Use this when:** Understanding how numbers flow through the system, validating calculations, or explaining scenarios to others.

---

## Quick Reference

### Core Contracts

| Contract | Location | Purpose |
|----------|----------|---------|
| **CoreVault** | `src/CoreVault.sol` | Central collateral and position management |
| **LiquidationManager** | `src/LiquidationManager.sol` | Heavy liquidation logic (delegated from CoreVault) |
| **OBLiquidationFacet** | `src/diamond/facets/OBLiquidationFacet.sol` | Order book-side liquidation execution |
| **PositionManager** | `src/PositionManager.sol` | Position netting and management library |

---

### Key Concepts

#### 1. **Liquidation Trigger**
A position becomes liquidatable when:
- `isUnderLiquidationPosition == true` (manually flagged), OR
- Mark price crosses stored `liquidationPrice` trigger, OR
- Equity ≤ Maintenance Margin (fallback calculation)

#### 2. **Liquidation Execution Path**
```
Market Order (Primary)
  ↓ (partial fills or no liquidity)
Gap Protection (confiscate from available collateral)
  ↓
Vault Liquidation (calculate losses, seize margin)
  ↓ (if trading loss > seized)
Anchor Protection (cap socialization at trigger price)
  ↓
Socialized Loss Distribution (haircut profitable positions)
  ↓ (if insufficient winner capacity)
Bad Debt Recording (system shortfall)
```

#### 3. **Socialized Loss (ADL)**
- **Selection**: Top K profitable positions by profit score
- **Allocation**: Proportional to notional at mark price
- **Capacity**: Capped by equity above maintenance margin
- **Tracking**: `socializedLossAccrued6` and `haircutUnits18`
- **Realization**: Deducted from payout when position closes

#### 4. **Anchor Price Protection**
- Set when position enters liquidation control
- Limits socialized loss to amount at anchor price
- Prevents over-socialization from delayed execution
- Excess assigned as bad debt instead

---

### Critical Constants

```solidity
LIQUIDATION_PENALTY_BPS = 1000      // 10%
TICK_PRECISION = 1e6                // Price precision (6 decimals)
DECIMAL_SCALE = 1e12                // 18d → 6d conversion
MMR_BPS = 2000                      // 20% (current fixed)
```

---

### Key Formulas

#### Unrealized PnL (18 decimals)
```
pnl18 = (markPrice - entryPrice) × size / TICK_PRECISION
```

#### Trading Loss (6 decimals, for USDC seizure)
```
loss6 = (priceGap × size) / (DECIMAL_SCALE × TICK_PRECISION)
```

#### Liquidation Trigger Price
```
For longs:
  liqPrice = (mark - equity/size) × 10000 / (10000 - mmrBps)

For shorts:
  liqPrice = (mark + equity/size) × 10000 / (10000 + mmrBps)
```

#### Available Collateral
```
available = userCollateral 
          - Σ(position.marginLocked) 
          - Σ(pendingOrder.marginReserved)
          + realizedPnL (6d)
          - Σ(position.socializedLossAccrued6)
```

---

### Common Scenarios

| Scenario | Path | Socialization? | Bad Debt? |
|----------|------|----------------|-----------|
| Position liquidated with full collateral | Market order → Vault seizure | No | No |
| Position liquidated, partial collateral | Market order → Vault seizure → ADL | Yes | No |
| Position liquidated, zero collateral | Market order → Vault seizure → ADL → Bad debt | Yes | Yes |
| Delayed execution beyond anchor | Market order → Gap protection → Vault → Anchor cap | No | Yes |
| Partial fills over multiple attempts | Multiple partial liquidations → Cumulative penalties | Depends | Depends |

---

## Integration Guide

### For Frontend Developers

**Key Views to Display:**
```solidity
// Check if position can be liquidated
vault.isLiquidatable(user, marketId, currentMark)

// Get liquidation trigger price
(liquidationPrice, hasPosition) = vault.getLiquidationPrice(user, marketId)

// Get user's available withdrawable balance
available = vault.getAvailableCollateral(user)

// Get position details
Position[] memory positions = vault.getUserPositions(user)
// Access: positions[i].socializedLossAccrued6 for haircut display
```

**Important Display Elements:**
1. **Liquidation Price**: Show users their trigger price
2. **Health Ratio**: `equity / maintenance` (below 1.0 = liquidatable)
3. **Accrued Haircuts**: Display `socializedLossAccrued6` per position
4. **Available Balance**: Use `getAvailableCollateral()` not `userCollateral`

---

### For Backend/Keeper Operators

**Liquidation Scanning:**
```javascript
// Automated liquidation monitoring
await orderBook.pokeLiquidations();

// Multi-round scanning for deep liquidation events
await orderBook.pokeLiquidationsMulti(rounds);
```

**Configuration:**
```javascript
// Set scan parameters (owner only)
await facet.setLiquidationScanParams(
  checksPerPoke,      // e.g., 50 users per scan
  maxLiquidationsPerPoke  // e.g., 25 liquidations per scan
);

// Enable auto-scan after each trade
await facet.setConfigLiquidationScanOnTrade(true);
```

**Monitoring Events:**
```solidity
// Listen for liquidation events
event AutoLiquidationTriggered(address indexed user, bytes32 indexed marketId, int256 positionSize, uint256 markPrice);
event LiquidationExecuted(address indexed user, bytes32 indexed marketId, address indexed liquidator, uint256 totalLoss, uint256 remainingCollateral);
event SocializedLossApplied(bytes32 indexed marketId, uint256 lossAmount, address indexed liquidatedUser);
event BadDebtRecorded(bytes32 indexed marketId, uint256 amount, address indexed liquidatedUser);
```

---

### For Smart Contract Developers

**Adding New Liquidation Logic:**

1. **Storage Layout Critical**: LiquidationManager uses `delegatecall`, so storage layout must match CoreVault exactly.

2. **Error Handling**: Most liquidation operations are best-effort and should not revert the transaction.

3. **Precision**: Always use correct decimal scales:
   - Prices: 6 decimals
   - Sizes: 18 decimals
   - PnL internal: 18 decimals
   - Collateral: 6 decimals

4. **Access Control**: Liquidation functions require `ORDERBOOK_ROLE`.

---

## Testing Scenarios

### Recommended Test Coverage

1. **Basic Liquidations**
   - Long position with sufficient collateral
   - Short position with sufficient collateral
   - Partial liquidation (multiple fills)
   - Full liquidation (single fill)

2. **Socialized Loss**
   - Liquidation with zero collateral
   - Liquidation with partial collateral
   - Multiple profitable positions for ADL
   - Single profitable position (concentration test)
   - No profitable positions (bad debt path)

3. **Anchor Protection**
   - Delayed execution beyond anchor price
   - Execution at anchor price (boundary)
   - Execution better than anchor price

4. **Edge Cases**
   - Zero liquidity on order book
   - Liquidation during price volatility
   - Simultaneous multiple liquidations
   - Haircut realization on position close
   - User tops up margin during liquidation

5. **Gas Optimization**
   - Batch liquidation scanning
   - Large number of winners for ADL
   - Deep order book matching

---

## Debugging Guide

### Common Issues

#### 1. "Position not liquidatable" but appears underwater
- **Check**: Is `isUnderLiquidationPosition` already true?
- **Check**: Has mark price been updated recently?
- **Check**: Calculate equity manually including unrealized PnL

#### 2. Socialized loss not distributing correctly
- **Check**: Are there profitable positions in the market?
- **Check**: Do profitable positions have equity > maintenance?
- **Check**: Is `adlMaxCandidates` limiting the pool?
- **Check**: Is `adlDebug` enabled for detailed events?

#### 3. Bad debt accumulating unexpectedly
- **Check**: Anchor price protection may be limiting socialization
- **Check**: Winners may have insufficient capacity
- **Check**: Market may have imbalanced long/short exposure

#### 4. Liquidation not executing
- **Check**: Is `pokeLiquidations()` being called?
- **Check**: Has the user been scanned yet? (check `lastCheckedIndex`)
- **Check**: Are liquidation limits reached? (`maxLiquidationsPerPoke`)

### Debug Events

Enable debug mode for detailed logging:
```javascript
await facet.setConfigLiquidationDebug(true);
await vault.setAdlDebug(true);
```

**Key Debug Events:**
- `DebugIsLiquidatable`: Detailed liquidation check breakdown
- `ProfitablePositionFound`: ADL candidate identification
- `DebugProfitCalculation`: PnL calculation details
- `DebugRewardComputation`: Maker reward distribution
- `SocializationCompleted`: ADL summary with coverage

---

## Related Documentation

- **Main README**: `../../README.md` - Project overview
- **Contract Interactions**: `../../CONTRACT_INTERACTIONS_SUMMARY.md` - Contract relationships
- **MMR System**: `../../MMR_SYSTEM_EXPLAINED.md` - Maintenance margin details
- **Partial Liquidation (legacy)**: `../../PARTIAL_LIQUIDATION_SOCIALIZATION.md` - Original design notes

---

## Changelog

### v1.0 (Current)
- Full liquidation and partial liquidation support
- Anchor price protection for fair socialization
- Gap loss confiscation for execution slippage
- Maker reward distribution from penalty pool
- Haircut tracking and realization system
- Batch scanning with configurable limits
- Debug mode with detailed event logging

---

## Support & Contact

For questions or issues related to the liquidation system:
1. Review this documentation thoroughly
2. Check worked examples for similar scenarios
3. Enable debug mode and analyze event logs
4. Consult the main codebase documentation

**File Issues**: Include relevant transaction hashes, position data, and debug event logs.

---

## License

MIT License - See main project LICENSE file.

