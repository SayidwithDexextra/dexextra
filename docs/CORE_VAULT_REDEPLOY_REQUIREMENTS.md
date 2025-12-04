### CoreVault Redeploy — Objectives, Refactor Plan, and Runbook

This document summarizes what is required to safely upgrade or redeploy the CoreVault contract and bring the system back to an operational state. Redeploying CoreVault is a last‑resort action. Strongly prefer upgradeability (proxy) and/or small diamond‑facet changes plus configuration over wholesale redeploys.

#### Objectives
- Eliminate out‑of‑gas failure modes in OrderBook liquidations by paging user enumeration at the vault.
- Make gasless (cross‑chain) deposits first‑class: users credited via `creditExternal` become visible to liquidation scanners and analytics without requiring a native hub deposit.
- Minimize operational risk: avoid moving user balances where possible; keep OrderBook/Spoke logic unchanged except where strictly necessary to rewire addresses.

#### Refactor plan
1) Extend CoreVault with per‑market user indexing and paged views:
   - Maintain `usersWithPositions[marketId]` and `userInMarket[user][marketId]` and update them whenever a user’s position in a market flips `0 ↔ non‑0` (inside `updatePositionWithMargin` and `updatePositionWithLiquidation`).
   - Add `getUsersWithPositionsInMarketCount(marketId)` and `getUsersWithPositionsInMarketPage(marketId, offset, limit)` to support predictable, small‑page enumeration.
   - Call `_ensureUserTracked(user)` from `creditExternal(...)` and from both position update paths so that gasless‑credited users are always tracked.
2) Update `OBLiquidationFacet` to use paged vault reads:
   - Replace ad‑hoc, in‑memory candidate assembly with: `count = getUsersWithPositionsInMarketCount`, then read a small page (e.g., 20–50 users) starting from `s.lastCheckedIndex`, process a bounded number (e.g., 3–5), and store the next index for subsequent pokes.
   - Keep early‑exit when both `bestBid` and `bestAsk` are zero; wrap `updateMarkPrice` in `try/catch`.
3) (If CoreVault address must change) add a tiny admin facet to OrderBook, e.g. `OBVaultAdminFacet::setVault(address newVault)` restricted to `onlyOwner`, to re‑point `OrderBookStorage.state().vault` without redeploying the diamond.

#### Make Liquidations & ADL small‑block friendly
To ensure liquidation and administrative deleveraging (ADL) fit within small block gas budgets:

- **Vault‑paged enumeration (small, deterministic cost per tx)**  
  Use `getUsersWithPositionsInMarketCount(marketId)` and `getUsersWithPositionsInMarketPage(marketId, offset, limit)` to fetch tiny pages (e.g., 20 users). In the order‑book facet, process at most 3–5 users per poke and advance `s.lastCheckedIndex` for the next tx.

- **Early pruning**  
  If both `bestBid` and `bestAsk` are zero, return immediately. For each paged user, first call `isLiquidatable(user, marketId, mark)` (via `try/catch`) and skip non‑liquidatable accounts to avoid touching the book unnecessarily.

- **Bounded crossing & partial closes**  
  In `_executeLiquidationMarketOrder`, cap the number of price levels (or cumulative notional) crossed per tx (e.g., 2–3 levels). If the entire position cannot be closed within the budget, close partially and return; the next poke resumes on the next page of users.

- **Defer expensive maker‑reward distribution**  
  On liquidation, compute `rewardPool` and emit a single `MakerRewardAccrued(liquidatedUser, rewardPool, totalScaled)` event; defer per‑maker payouts to a separate `settleMakerRewards(liquidatedUser, makers[], amounts[])` call (keeper‑driven) or switch to a claim‑based model so the hot path remains O(1).

- **Optional single‑user liquidation entrypoint**  
  Provide `liquidateUser(address user)` to allow keepers to submit tiny, targeted liquidations for known‑bad accounts discovered via off‑chain `callStatic` screening.

- **Suggested defaults**  
  `MAX_PAGE = 20`, `MAX_USERS_PER_TX = 3`, cap price‑levels per user (2–3), invoke multiple small pokes per minute rather than a single jumbo transaction.

Key constraints
- CoreVault holds user collateral (USDC, 6 decimals). A new deployment does not transfer funds from the old vault.
- OrderBook diamonds store a reference to the vault at initialization and cannot change it without a diamond upgrade. Existing OrderBooks will continue to point at the old vault until updated/redeployed (or until an admin facet sets a new vault address).
- The FuturesMarketFactory originally “points to” a vault; depending on version, this may be immutable or admin‑updatable.

When a redeploy is justified
- Critical non‑upgradeable bug or storage layout issue in CoreVault.
- Chain migration or security incident requiring all new admin keys/role graph.
- Protocol‑level change incompatible with existing CoreVault bytecode.

Pre‑deployment prerequisites
- Governance approval and communication plan (downtime window, user notices).
- Operating procedures in place to pause trading and withdrawals (CoreVault.pause()).
- Updated deployment configuration with all known addresses:
  - USDC collateral token address (must be 6 decimals).
  - Libraries: VaultAnalytics, PositionManager (reuse existing addresses).
  - LiquidationManager implementation address (if applicable).
  - CollateralHub (if using cross‑chain credit); ensure it can be pointed to the new CoreVault via `setCoreVaultParams`.
  - FuturesMarketFactory (existing and/or new).
  - All OrderBook addresses and their marketIds.
- Backend/frontend configuration prepared for the new addresses:
  - Update `Dexetrav5/deployments/{network}-deployment.json`.
  - Ensure `Dexetrav5/config/contracts.js` reflects the new `CORE_VAULT` (front‑end reads through `src/lib/dexetrav5Config.ts` → `src/lib/contractConfig.ts`).
  - Update app/server environment files (e.g., `.env.local`) with configured addresses instead of hardcoding.

Contract deployment checklist
1) Deploy new CoreVault
- Constructor: (USDC, admin). USDC must implement `decimals()` and return 6.
- Link existing libraries: VaultAnalytics, PositionManager.

2) Configure new CoreVault
- setLiquidationManager(newImpl) if used.
- setMmrParams(...) to the baseline values you use in production.
- Grant roles on CoreVault:
  - FACTORY_ROLE to FuturesMarketFactory (existing and/or new).
  - SETTLEMENT_ROLE to FuturesMarketFactory and any settlement operators.
  - EXTERNAL_CREDITOR_ROLE to CollateralHub (if you use cross‑chain credit).
  - ORDERBOOK_ROLE (and optionally SETTLEMENT_ROLE) to every OrderBook that should interact with the new vault.
- Register OrderBooks and assign market mappings:
  - registerOrderBook(OB)
  - assignMarketToOrderBook(marketId, OB)

3) CollateralHub alignment (Spokes remain unchanged)
- Point the hub to the new vault and operator:
  - `CollateralHub.setCoreVaultParams(newVault, operator)`
- Ensure `CollateralHub` holds `EXTERNAL_CREDITOR_ROLE` on the new CoreVault.
- Spoke bridge contracts (inboxes/outboxes) continue to interact with `CollateralHub`; they don’t need changes for a CoreVault swap.

4) Factory alignment
- If your factory supports it, update the factory to point to the new CoreVault for future markets. Otherwise, deploy a new FuturesMarketFactory targeting the new CoreVault and grant it required roles.

5) OrderBook alignment (CRITICAL)
- Existing OrderBooks reference the old vault via storage set in `OrderBookInit.obInitialize()`. There is no post‑init setter in the shipped facets, so you must do ONE of:
  - Diamond upgrade path (preferred): add a small admin facet with an owner/admin‑only function to update `s.vault` and execute a diamond cut across all OrderBooks; or
  - Redeploy each OrderBook and initialize it with the new vault; then re‑register and re‑assign market mappings on the new CoreVault.
- Until this step is completed, legacy OrderBooks will continue to call the OLD vault.

Funds and data migration considerations
- User funds remain in the OLD CoreVault after redeploy.
- Options:
  - Operate legacy markets on the old vault and launch new markets on the new vault (dual‑vault period), or
  - Orchestrate a migration plan:
    - Pause trading and withdrawals.
    - Snapshot balances/positions for auditability.
    - Communicate user action: withdraw from old vault, deposit into new vault; optionally provide a claim/airdrop/credit mechanism if you need a gasless path.
    - Resume markets only after OrderBooks are cut over to the new vault and mappings/roles are complete.

Operational runbook (commands/scripts)
- Minimal redeploy helpers (review warnings inside):
  - `Dexetrav5/scripts/redeploy-corevault.js`
  - `Dexetrav5/scripts/regrant-corevault-roles.js`
- Role and mapping verification:
  - `node scripts/check-corevault-roles.js --coreVault 0x... --orderBook 0x...`
  - `node scripts/inspect-orderbook-liq.js` (verifies vault/market relations and orderbook liquidity signals).
- Hub wiring:
  - `CollateralHub.setCoreVaultParams(newVault, operator)`
  - Verify `EXTERNAL_CREDITOR_ROLE` on the new CoreVault for the `CollateralHub` address.
- Update deployments/config, then verify:
  - `Dexetrav5/deployments/{network}-deployment.json`
  - `Dexetrav5/config/contracts.js` → front‑end picks up new addresses.

Post‑deployment validation
- AccessControl: verify all intended roles are set (Factory, OrderBooks, CollateralHub, settlement operators).
- Market wiring:
  - `marketId → OrderBook` mapping correct on the new vault.
  - OrderBooks effectively call the NEW vault (after diamond cut or redeploy).
- Liquidation flows: run smoke tests that exercise `isLiquidatable`, `updatePositionWithLiquidation`, and reward payment paths.
- Settlement: confirm `updateMarkPrice` and settlement operations via authorized callers.
- Paged enumeration & gasless users:
- `getUsersWithPositionsInMarketCount`/`getUsersWithPositionsInMarketPage` return expected values and include users credited via `creditExternal`.
- `OBLiquidationFacet.pokeLiquidations()` processes a small, fixed batch per tx and completes without out‑of‑gas in small blocks.
- App health:
  - UI loads new addresses from config.
  - API servers use the configured addresses from environment/config (no hardcoded addresses).

Production safety guardrails
- Execute in a maintenance window; publish user communications.
- Keep the old CoreVault fully accessible for audit and user withdrawals if you are not migrating funds programmatically.
- Monitor on‑chain events (PositionUpdated, MarginLocked/Released, VaultMarketSettled) and backend logs for anomalies.

Strong recommendation
- Prefer **proxy upgrade** of CoreVault where possible; otherwise, add **targeted diamond‑facet updates** and update addresses/config to avoid moving funds. If you must redeploy CoreVault, plan for OrderBook vault‑pointer updates (admin facet), re‑grant all roles (including `EXTERNAL_CREDITOR_ROLE` to `CollateralHub`), and define a clear funds‑migration/dual‑vault strategy before going live.


