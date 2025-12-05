### CoreVault Redeploy — Requirements and Runbook (Summary)

This document summarizes what is required to safely redeploy the CoreVault contract and bring the system back to an operational state. Redeploying CoreVault is a last‑resort action. Strongly prefer reconfiguration via addresses and environment variables over redeploys whenever possible.

Key constraints
- CoreVault holds user collateral (USDC, 6 decimals). A new deployment does not transfer funds from the old vault.
- OrderBook diamonds store a reference to the vault at initialization and cannot change it without a diamond upgrade. Existing OrderBooks will continue to point at the old vault until updated/redeployed.
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
  - CollateralHub (if using cross‑chain credit).
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

3) Factory alignment
- If your factory supports it, update the factory to point to the new CoreVault for future markets. Otherwise, deploy a new FuturesMarketFactory targeting the new CoreVault and grant it required roles.

4) OrderBook alignment (CRITICAL)
- Existing OrderBooks reference the old vault via storage set in `OrderBookInit.obInitialize()`. There is no post‑init setter in the shipped facets, so you must do ONE of:
  - Diamond upgrade path: add a small admin facet with an owner/admin‑only function to update `s.vault` and execute a diamond cut across all OrderBooks; or
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
  - `node scripts/inspect-orderbook-liq.js` (verifies vault/market relations and signals).
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
- App health:
  - UI loads new addresses from config.
  - API servers use the configured addresses from environment/config (no hardcoded addresses).

Production safety guardrails
- Execute in a maintenance window; publish user communications.
- Keep the old CoreVault fully accessible for audit and user withdrawals if you are not migrating funds programmatically.
- Monitor on‑chain events (PositionUpdated, MarginLocked/Released, VaultMarketSettled) and backend logs for anomalies.

Strong recommendation
- Avoid redeploying core contracts. Prefer using configured addresses in deployment config and `.env.local` and adding small, targeted upgrades (diamond cuts) over wholesale redeploys. If you must redeploy CoreVault, plan for OrderBook rewiring and a clear funds migration strategy before making the change live.


