# CoreVault + FuturesMarketFactory Redeploy Runbook (Gasless Top-Up)

Purpose: deploy the CoreVault with meta top-up support, deploy a factory that can be retargeted to a new vault, and grant all roles so markets work against the new vault.

## Prereqs
- Admin key with DEFAULT_ADMIN_ROLE on the new CoreVault and admin on the factory.
- Relayer RPC + private key configured for broadcasting.
- All addresses handy: USDC (6 decimals), LiquidationManager impl, existing OrderBooks + marketIds, CollateralHub (if used), settlement operators.

## Deploy CoreVault (new)
1) Deploy CoreVault (constructor: USDC, admin).
2) Set liquidation manager: `setLiquidationManager(<impl>)`.
3) Grant roles on new vault:
   - FACTORY_ROLE -> FuturesMarketFactory (new).
   - ORDERBOOK_ROLE (and SETTLEMENT_ROLE if used) -> each OrderBook that should trade.
   - EXTERNAL_CREDITOR_ROLE -> CollateralHub (if used).
4) Register existing OrderBooks and market mappings on the new vault:
   - `registerOrderBook(orderBook)`
   - `assignMarketToOrderBook(marketId, orderBook)`
5) Verify params (MMR, fees) if you configure them via factory/OB facets.

## Make OrderBooks point at the new vault
- Option A (diamond cut): add a tiny admin facet to each OrderBook to update `s.vault`, run a diamond cut per OB, then verify `marketToOrderBook` on the new vault.
- Option B (redeploy OBs): redeploy each OrderBook via the factory using the new vault, reassign marketId mappings on the new vault, and update any front/back-end configs that cache OB addresses.

## Deploy FuturesMarketFactory (configurable vault)
1) Deploy the new factory with constructor args: (vault, admin, feeRecipient).
2) If the vault address changes later, call `updateVault(newVault)` as admin.
3) Grant roles on the new vault (step above) so the factory can register/assign markets.

## Wire gasless top-up (contract side)
- CoreVault now exposes `metaTopUpPositionMargin(user, marketId, amount, deadline, v, r, s)` with EIP-712 domain: name "CoreVault", version "1", verifyingContract = CoreVault, chainId = runtime.
- Nonce: `topUpNonces[user]`. Relayer should increment after successful send.

## Config / artifacts to update
- Deployment JSONs: `Dexetrav5/deployments/{network}-deployment.json` with new CoreVault + factory (and any new OBs).
- Front/back-end env: CORE_VAULT_ADDRESS, FUTURES_MARKET_FACTORY_ADDRESS, LIQUIDATION_MANAGER, COLLATERAL_HUB, etc.
- ABI refresh: regenerate `src/lib/abis/CoreVault.json` and any generated types after compile.

## Validation checks
- Roles: FACTORY_ROLE, ORDERBOOK_ROLE, SETTLEMENT_ROLE, EXTERNAL_CREDITOR_ROLE set as intended.
- Mappings: `marketToOrderBook` populated on the new vault for every active market.
- Top-up: relayer call to `metaTopUpPositionMargin` succeeds with a valid user signature and does not move funds without signature.
- Factory: `updateVault` callable by admin and reflects in subsequent market deployments.

## Minimal command skeleton (pseudo)
- Deploy CoreVault -> record address
- Deploy LiquidationManager (if new) -> `setLiquidationManager`
- Deploy FuturesMarketFactory(newVault, admin, feeRecipient)
- Grant roles on vault: FACTORY_ROLE to factory; ORDERBOOK_ROLE/SETTLEMENT_ROLE to each OB; EXTERNAL_CREDITOR_ROLE to CollateralHub
- For each OB: register + assign marketId on new vault; update OB vault reference (cut or redeploy)
- Update configs/env; redeploy front/back-end if needed
- Smoke tests: deposit, place order, gasless top-up, settlement







