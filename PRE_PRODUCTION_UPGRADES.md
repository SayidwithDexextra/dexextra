# Pre-Production Upgrades

Complete checklist for the CoreVault upgrade, state migration, and dependent rewiring.

---

## Phase 1: Solidity Contract Work

### 1A. Add Dependencies
- Install `@openzeppelin/contracts-upgradeable` (v5.4.x)
- Bump Hardhat Solidity compiler from `0.8.20` to `0.8.22+`

### 1B. Extract VaultViewsManager (new contract)
Move all read-only view functions out of CoreVault into a delegatecall target (same pattern as LiquidationManager):
- `getUnifiedMarginSummary`, `getMarginSummary`, `getAvailableCollateral`, `getWithdrawableCollateral`
- `getCollateralBreakdown`, `getMarginUtilization`, `getTotalMarginUsed`, `getTotalMarginLockedInMarket`
- `getPositionSummary`, `getPositionEquity`, `getPositionFreeMargin`, `getLiquidationPrice`
- `getEffectiveMaintenanceMarginBps`, `getEffectiveMaintenanceDetails`
- `getUsersWithPositionsInMarket`
- MMR computation helpers: `_computeEffectiveMMRMetrics`, `_computeEffectiveMMRBps`, `_getCloseLiquidity`

Must mirror CoreVault's storage layout prefix for delegatecall safety.

### 1C. Extract SettlementManager (new contract)
Move `settleMarket` and `_getUsersWithPositionsInMarket` into a delegatecall target. CoreVault keeps a thin wrapper. Same storage alignment requirement as LiquidationManager.

Apply the settlement solvency fix inside the new SettlementManager:
- First solvency scan: `uint256 balance = userCollateral[user] + userCrossChainCredit[user];`
- Second pass (debit): `uint256 balance2 = userCollateral[user2] + userCrossChainCredit[user2];`

### 1D. Convert CoreVault to UUPS
- Change inheritance: `Initializable, AccessControlUpgradeable, ReentrancyGuardUpgradeable, PausableUpgradeable, UUPSUpgradeable`
- Replace constructor with `initialize(address _collateralToken, address _admin)`
- `collateralToken` stays immutable (USDC address won't change between upgrades)
- `DOMAIN_SEPARATOR` becomes a runtime function (uses proxy `address(this)`, not implementation)
- Add `_authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE)`

### 1E. Add Session-Based Top-Ups
- Add `address public sessionRegistry` + `setSessionRegistry(address)` admin setter
- Add method bit `MBIT_TOPUP = 1 << 6`
- Add `sessionTopUpPositionMargin(bytes32 sessionId, address user, bytes32 marketId, uint256 amount, bytes32[] calldata relayerProof)` — validates via `GlobalSessionRegistry.chargeSession`, then calls `_topUp`
- Old `metaTopUpPositionMargin` can remain for backward compatibility or be removed to save bytecode

### 1F. Add Migration Functions (temporary)
Admin-only, removable in next upgrade:
- `migrateUserState(address user, uint256 collateral, uint256 crossChainCredit, int256 realizedPnL, uint256 socializedLoss)`
- `migratePositions(address user, Position[] calldata positions)`
- `migrateMarketConfig(bytes32 marketId, address orderBook, uint256 markPrice, bool settled, bool disputed, uint256 badDebt)`
- `migrateOrderBookRegistry(address[] calldata orderBooks)`
- `migrateGlobalConfig(...)`

### 1G. Verify Storage Layout
- Run `forge inspect` or `hardhat-storage-layout` on old vs new CoreVault
- Confirm CoreVault-specific variables start at the same slot (OZ v5 upgradeable contracts use ERC-7201 namespaced storage)
- Update LiquidationManager storage alignment if needed (and redeploy LM if layout changed)

---

## Phase 2: State Migration

### 2A. Snapshot (DONE)
Script: `Dexetrav5/scripts/snapshot-corevault.js`
Snapshot: `Dexetrav5/snapshots/corevault-snapshot-1774960240841.json`
- 47 users, 81 markets, 91 positions, 232 pending orders, 78 OrderBooks
- $1,810 in userCollateral, $12.7M in userCrossChainCredit

### 2B. Deploy
1. Deploy VaultViewsManager (with linked libraries)
2. Deploy SettlementManager (with linked libraries)
3. Deploy new CoreVault implementation (with linked libraries)
4. Deploy ERC1967Proxy pointing to implementation, with `initialize(usdc, admin)` as init calldata
5. Deploy new LiquidationManager if storage layout changed

### 2C. Replay State
1. Call `migrateGlobalConfig(...)` — MMR params, ADL config
2. For each market: `migrateMarketConfig(...)` — register markets and OrderBooks
3. For each user: `migrateUserState(...)` + `migratePositions(...)` — balances and positions
4. Set delegatecall targets: `setLiquidationManager`, `setViewsManager`, `setSettlementManager`

### 2D. USDC
- Vault holds $0 USDC on-chain (all funds are cross-chain credit)
- userCollateral sum ($1,810) needs equivalent USDC deposited by admin into new vault
- Cross-chain credit is math-only, no token transfer needed

### 2E. Verify
- Run verification script: compare all user/market state between old and new vaults
- Confirm `userCollateral`, `userCrossChainCredit`, `userRealizedPnL`, positions, pending orders, market configs all match

---

## Phase 3: Rewiring Dependents

### 3A. On-Chain Transactions
| Dependent | Action | Method |
|---|---|---|
| Each OrderBook Diamond (78) | Point at new vault | `OrderBookVaultAdminFacet.setVault(newProxy)` |
| FuturesMarketFactory | Point at new vault | `factory.updateVault(newProxy)` |
| CollateralHub | Point at new vault | `hub.setCoreVaultParams(newProxy, operator)` |
| MarketBondManagerV2 | Redeploy (immutable vault) | `redeploy-bond-manager-v2.js` |
| GlobalSessionRegistry | Allow new vault to call chargeSession | `registry.setAllowedOrderbook(newProxy, true)` |

### 3B. Role Grants on New Vault
| Role | Recipients |
|---|---|
| `DEFAULT_ADMIN_ROLE` | Admin (set in initializer) |
| `ORDERBOOK_ROLE` | Every OrderBook diamond, CollateralHub |
| `SETTLEMENT_ROLE` | Factory, each OrderBook |
| `FACTORY_ROLE` | Factory, new BondManagerV2 |
| `EXTERNAL_CREDITOR_ROLE` | CollateralHub |

### 3C. Off-Chain Config
| What | Where |
|---|---|
| `CORE_VAULT_ADDRESS` | `.env.local`, Vercel secrets, CI |
| `NEXT_PUBLIC_CORE_VAULT_ADDRESS` | `.env.local`, Vercel secrets |
| Supabase edge function secrets | `liquidation-direct-webhook`, `liquidation-retry-worker` |
| ABI artifact | Regenerate `src/lib/abis/CoreVault.json` |
| Deployment record | Update `Dexetrav5/deployments/hyperliquid-deployment.json` |
| Fallback address | Update `src/lib/contractConfig.ts` |

---

## Phase 4: Execution Order

```
 1. Pause old CoreVault
 2. Re-run snapshot script (fresh state at latest block)
 3. Deploy VaultViewsManager, SettlementManager
 4. Deploy CoreVault implementation + ERC1967Proxy → initialize
 5. Deploy LiquidationManager (if layout changed)
 6. Run migration script (replay users, markets, config)
 7. Admin deposits $1,810 USDC into new vault
 8. Set delegatecall targets (LM, Views, Settlement)
 9. Redeploy BondManagerV2
10. Grant all roles on new vault
11. setVault on all 78 OrderBook diamonds
12. updateVault on Factory
13. setCoreVaultParams on CollateralHub
14. setAllowedOrderbook on GlobalSessionRegistry
15. Run verification script
16. Update env vars, ABIs, deployment JSON
17. Deploy frontend with new env
18. Update Supabase edge function secrets
19. Unpause new vault
```

---

## Contract Size Impact

| Contract | Before | After |
|---|---|---|
| CoreVault | 24,549 bytes (99.89%) | ~16,000 bytes (~65%) |
| VaultViewsManager | — | ~8,000 bytes (new) |
| SettlementManager | — | ~5,000 bytes (new) |
| LiquidationManager | 24,405 bytes (unchanged) | 24,405 bytes (unchanged) |
