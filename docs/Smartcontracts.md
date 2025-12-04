## Smart Contracts and Diamond Facets Overview

This document summarizes every core smart contract and each EIP‑2535 diamond facet used in the Dexetra v5 system (folder: `Dexetrav5/src`). It explains what each component is responsible for, how they interact, and any important roles, permissions, and integration points.

### Architecture at a glance
- **OrderBook per-market is an EIP‑2535 Diamond**: `Diamond.sol` routes calls to modular facets that implement placement, execution, liquidation, pricing, admin, views, lifecycle, session-based meta-trade dispatch, and initialization.
- **CoreVault**: Central ledger for user collateral, cross-chain trading credits, margin, positions, settlement, and liquidation delegation.
- **FuturesMarketFactory**: Deploys market-specific OrderBook diamonds and registers them with `CoreVault`; provides meta-create path and admin hooks (leverage/oracles).
- **LiquidationManager**: Separate implementation for liquidation and ADL that `CoreVault` delegates into, keeping the vault bytecode small.
- **Collateral hub/spoke + Wormhole bridges**: Cross-chain deposits/withdraw intents with idempotency and remote app validation.


## Core contracts (non-diamond)

### `CoreVault.sol`
Responsibility: The system-of-record for collateral, positions, margin, and settlement.

- Tracks user balances in 6-decimal collateral (USDC), realized PnL (18d), cross-chain credit (math-only), positions (via `PositionManager`), pending order reservations, per-market mark prices, bad debt, and socialized loss ledgers.
- Locks/releases margin for orders and positions; computes available margin and portfolio health; exposes unified portfolio views.
- Authorizes OrderBooks and maps `marketId -> orderBook` and `orderBook -> markets[]`.
- Performs oracle‑agnostic settlement: finalizes all positions in a market at a provided terminal price, scales payouts when needed (socialized loss), writes winners’ realized PnL and debits losers up to locked margin; records bad debt transparently.
- Delegates heavy liquidation/ADL logic to `LiquidationManager` via `delegatecall` to keep bytecode small but preserve storage layout and events.
- Emits a comprehensive set of events for deposits, withdrawals, margin changes, settlement, ADL, and liquidation flows.
- Roles and permissions (OpenZeppelin AccessControl):
  - `DEFAULT_ADMIN_ROLE`: pause/unpause, risk/ADL param updates
  - `ORDERBOOK_ROLE`: trade-time calls (update positions, lock/release/reserve margin, liquidation hooks)
  - `SETTLEMENT_ROLE`: update mark price
  - `FACTORY_ROLE`: market authorization/registration
  - `EXTERNAL_CREDITOR_ROLE`: cross-chain math-only credit/debit (hub integration)

Key integration points:
- Called by OrderBook facets for executing trades, reserving margin, adjusting positions, and updating marks.
- Called by `FuturesMarketFactory` to register/assign new markets and seed prices.
- Called by bridge hub for cross-chain credits/debits.


### `LiquidationManager.sol`
Responsibility: Full liquidation engine and Administrative Position Closure (ADL) implementation used by `CoreVault` via `delegatecall`.

- Computes liquidation trigger logic (with fixed trigger or equity/MMR fallback), supports debug emission, and provides public helpers.
- Executes liquidations and partial closes, with gap-loss handling, penalty computation, maker reward pool creation, and reward distribution.
- Implements socialized loss assignment across profitable counterparties, tagging position units for haircut attribution, and recording bad debt if residual remains.
- Mirrors relevant vault storage layout to operate under `delegatecall` semantics; uses OrderBook pricing depth to inform risk.
- Exposes ADL and MMR configuration knobs and analytics-like helpers used by the vault.


### `FuturesMarketFactory.sol`
Responsibility: Creates new futures markets as Diamonds (OrderBooks), registers them with the vault, and manages per‑market metadata and leverage/oracle controls.

- Two creation paths:
  - `createFuturesMarketDiamond(...)`: direct deployment of `Diamond` with an initializer facet call.
  - `metaCreateFuturesMarketDiamond(...)`: gasless creation via EIP‑712 signature from a logical creator (relayer submits).
- Computes `marketId`, deploys `Diamond`, runs `obInitialize(vault, marketId, feeRecipient)` on the init facet, registers the OrderBook with `CoreVault`, seeds its start price, and optionally initializes lifecycle (if the facet is present).
- Tracks market metadata: symbol, URL, settlement date, creator; manages oracle settings (default/custom, UMA reward), exposes views, and admin updates (fees, access, public creation flag).
- Leverage management: turns leverage on/off per market by calling `OBAdminFacet` in the target market diamond; can set leverage controller.


### `Diamond.sol` and `LibDiamond.sol`
Responsibility: EIP‑2535 diamond router and storage library.

- `Diamond.sol`: constructor sets owner then applies an initial `diamondCut`; implements `IDiamondCut`, `IDiamondLoupe`, `IERC173` ownership, and a `fallback` that delegates to the facet that owns the called selector.
- `LibDiamond.sol`: diamond storage slot, selector-to-facet mapping, `add/replace/remove` selector management, ownership updates, and delegatecall initializer for cuts.


### `GlobalSessionRegistry.sol`
Responsibility: Global “sign once, trade many” session registry applying budget and method allowlists across all markets.

- EIP‑712 `SessionPermit` signed by trader creates a session with expiry, relayer, per‑trade and per‑session notional caps, and method bitmap.
- OrderBooks that enable session-based flows call `chargeSession(sessionId, trader, methodBit, notional)` which enforces expiry, method allowlist, relayer, and budgets, then increments usage.


### Libraries used by core
- `PositionManager.sol` (library): Position data model and all position netting math, including weighted entry price logic, realized PnL on closes, per-trade haircut realization, and margin change deltas. Designed to minimize overflow and bytecode size.
- `VaultAnalytics.sol` (library): Standardized P&L and portfolio computations (18d P&L; 6d collateral), margin summaries, protection ratios, and validation helpers.


## OrderBook Diamond: facets and storage

The per‑market OrderBook is a Diamond composed of the following facets and storage libraries. All facets share a dedicated OrderBook diamond storage via `OrderBookStorage.state()`.

### Storage libraries
- `OrderBookStorage.sol`: Defines the `State` struct for the entire order book, including vault integration, market settings (fees, leverage/margin params), price levels and linked lists of orders, user orders, fill tracking, trade history (including a last‐20 ring buffer), mark/VWAP configuration, liquidation scanning state and metrics, and simple reentrancy guard for execution.
- `MarketLifecycleStorage.sol`: Dedicated diamond storage for lifecycle metadata (settlement timestamp), rollover and challenge windows, parent/child market pointers, and testing overrides.


### Initialization and admin

#### `OrderBookInitFacet` (`OrderBookInit.sol`)
Responsibility: One‑time initializer run during factory deployment.

- Sets `vault`, `marketId`, `feeRecipient`, default trading parameters (1:1 margin, 0.1% fee, 5% slippage), VWAP defaults, last trade price seed, and unit-margins per ALU for long/short.

#### `OBAdminFacet.sol`
Responsibility: Owner‑only administrative controls for trading parameters and leverage.

- Update margin requirement and fees, set fee recipient.
- Enable/disable leverage; enforce margin floor relative to max leverage.
- Set leverage controller (used by off-chain policy/controllers).
- Set max slippage for market orders.


### Read and pricing

#### `OBViewFacet.sol`
Responsibility: Read‑only getters for UI and services.

- Fetch trading parameters, leverage info, static config (vault, marketId), best prices, last trade price, slippage setting, order/user mappings, position size (via vault), and total margin locked in this market.

#### `OBPricingFacet.sol`
Responsibility: Computes mark price and exposes order book depth and price stats.

- Mark price is computed from mid price with optional hybrid VWAP (up to last four trades) or fallbacks (two-trade VWAP, last trade, or side best) to maintain stability in sparse books.
- Returns best bid/ask, depth arrays, spread and spreadBps, and a consolidated `getMarketPriceData()` bundle.
- Owner can configure VWAP window and minimum volume and toggle hybrid/VWAP usage.


### Order placement, matching, and execution

#### `OBOrderPlacementFacet.sol`
Responsibility: Order ingress and matching; margin reservation for limit orders; slippage‑bounded market orders.

- Place/cancel/modify limit orders (spot is disabled; margin only). Margin limit orders reserve required collateral in the vault using namespaced reservation IDs; reservations are released or right‑sized after partial matches.
- Market orders check liquidity and compute slippage‐bounded max/min price; margin market orders pre‑check available collateral before execution.
- Matching engine crosses against resting levels, self‑cross nets without executing a trade, and for each actual trade calls `OBTradeExecutionFacet.obExecuteTrade` to update positions/fees/mark.
- Emits detailed matching and liquidity debug events; triggers liquidation scans when book liquidity changes.

#### `OBTradeExecutionFacet.sol`
Responsibility: Executes a single matched trade, updates positions via the vault, computes fees, and maintains trade history and marks.

- Enforces “margin only” for futures (spot disabled).
- For margin trades, updates both sides’ positions with correct margin model and basis price selection; applies pre‑trade solvency guard when closing exposure.
- Deducts symmetric fees (bps of notional) to `feeRecipient` through the vault.
- Updates last trade price; recomputes mark using pricing facet; writes mark into the vault.
- Maintains an append‑only trade table and a last‑20 ring buffer; exposes views for recent trades, user trade pagination, statistics, and time-range queries.


### Liquidations and settlement

#### `OBLiquidationFacet.sol`
Responsibility: Periodic/liquidity‑triggered liquidation scanning and execution with gap protection and maker reward distribution.

- On `pokeLiquidations`, recomputes mark and scans a bounded window of traders (round‑robin), calling into the vault to test liquidatability. If liquidatable, issues a synthetic market order on behalf of the OB to close the position within 15% slippage bounds, crossing the book via internal matching functions.
- Tracks worst execution, average price, and per‑maker contribution (scaled notional) to build a reward pool funded from OB balance (capped by expected penalty). Distributes rewards proportionally and emits detailed debug events.
- Handles recursion/rescan guards and resynchronizes best prices/mark. Works with vault hooks for marking positions “under liquidation,” confiscating available collateral, and socializing gap losses when required.

#### `OBSettlementFacet.sol`
Responsibility: Owner‑triggered market settlement from the OB side.

- Cancels all resting orders and fully releases reserved margin, then calls `CoreVault.settleMarket(marketId, finalPrice)` to realize PnL, apply haircuts, and close all positions.
- Provides `isSettled()` view to reflect vault state.


### Meta-trading and lifecycle

#### `MetaTradeFacet.sol`
Responsibility: EIP‑712 meta‑transaction dispatcher and session-based “sign once, trade many” entry points.

- Verifies typed data signatures for cancel/place/modify and forwards to the corresponding “By” entrypoints in `OBOrderPlacementFacet` via self‑calls so that internal logic and guards remain unchanged.
- Optional global session enforcement: when a `sessionRegistry` is configured, all session calls charge usage and enforce per‑trade/session budgets and method allowlists. Otherwise, a local (per‑market) session store is enforced.

#### `MarketLifecycleFacet.sol`
Responsibility: Per‑market timebox metadata (settlement timestamp) and rollover/challenge windows with lineage.

- One-time initializer sets terminal settlement timestamp (T0 + 365 days) and optional parent link (for rollovers).
- Emits `RolloverWindowStarted` (T0 – 30d) and `SettlementChallengeWindowStarted` (T0 – 24h) when timegated; provides views to discover windows even before signal.
- Stores parent/child pointers and provides owner-only testing overrides and debug emitters to support automation/integration testing.


## Collateral and cross‑chain bridging

### `CollateralHub.sol`
Responsibility: Hub‑chain adapter used to (a) credit users on deposits received from spokes and (b) issue withdraw intents (debit ledger) for spoke release.

- Keeps per‑spoke registry (chainId → spoke config) and toggles; enforces idempotency for deposit/withdraw IDs.
- `creditFromBridge(...)`: called by hub bridge inbox; credits user’s math-only cross-chain ledger in `CoreVault` via `EXTERNAL_CREDITOR_ROLE` methods.
- `requestWithdraw(user, targetChainId, amount)`: debits the cross-chain ledger and emits a withdraw intent event; can be called by user or authorized requester.

### `SpokeVault.sol`
Responsibility: Spoke‑chain vault that passively holds ERC‑20 tokens and releases funds upon verified withdraw messages.

- Maintains allowlist of tokens to release; deposits are simple `transfer()`s into the contract.
- `releaseToUser(...)`: called by spoke bridge inbox on verified withdraw messages; idempotent via `processedWithdrawIds` and restricted to `BRIDGE_INBOX_ROLE`.

### Wormhole bridge adapters
- `HubBridgeInboxWormhole.sol` (hub receiver): Validates remote app ID per source domain and decodes deposit messages; credits users via `CollateralHub.creditFromBridge` (deposit type=1).
- `HubBridgeOutboxWormhole.sol` (hub sender): Emits withdraw messages/events for off-chain relayer to deliver to a spoke (type=2); stores destination app per domain.
- `SpokeBridgeInboxWormhole.sol` (spoke receiver): Validates remote app ID and decodes withdraw messages (type=2); instructs `SpokeVault` to release funds to user.
- `SpokeBridgeOutboxWormhole.sol` (spoke sender): Emits deposit messages/events (type=1) to be delivered to hub.


## Tokens (testing and spokes)

- `MockUSDC.sol`: 6‑decimal ERC‑20 with faucet/mint/burn for hub/testing; large initial supply; mirrors USDC decimals to match vault accounting.
- `SpokeMockUSDC.sol`: 6‑decimal ERC‑20 for spoke chains with owner minting, faucet, and burnFrom; used for local/spoke testing.


## Diamond interfaces and vault interfaces (selected)

- `IDiamondCut.sol`, `IDiamondLoupe.sol`, `IERC173.sol`: Standard diamond interfaces for cut/inspection/ownership.
- `IOBPricingFacet.sol`, `IOBTradeExecutionFacet.sol`, `IOBLiquidationFacet.sol`, `IMarketLifecycleFacet.sol`: Cross‑facet call/typing convenience for pricing, execution, liquidation, and lifecycle.
- `diamond/interfaces/ICoreVault.sol`: Minimal vault interface used by facets for position/margin/settlement interactions (distinct from `collateral/interfaces/ICoreVault.sol` used by CollateralHub).


## How the pieces work together (high‑level flow)

1) A market is created through `FuturesMarketFactory` which deploys a `Diamond` and initializes the OrderBook via `OrderBookInitFacet`, then registers it with `CoreVault` and sets initial mark.
2) Traders deposit USDC (or get cross-chain credit) into `CoreVault`. Available collateral and margin health are computed by the vault using `VaultAnalytics`, with positions maintained by `PositionManager`.
3) Orders are submitted to the OrderBook (directly or via `MetaTradeFacet`). `OBOrderPlacementFacet` matches against resting liquidity; matched trades are executed by `OBTradeExecutionFacet`, which updates positions/margins in the vault and updates marks using `OBPricingFacet`.
4) When mark moves adversely and positions become unsafe, `OBLiquidationFacet` scans and executes liquidation market orders with gap protection; `CoreVault` confiscates collateral as needed (and may socialize residual losses).
5) On settlement, `OBSettlementFacet` cancels all resting orders, releases reservations, and calls `CoreVault.settleMarket` to finalize PnL with haircut scaling if necessary; the market becomes terminal.
6) Cross‑chain users are credited on hub via `CollateralHub` when Wormhole deposit messages are received; withdraw intents on hub are emitted and consumed by spoke inbox to release real tokens.


## File index (by responsibility)

- Core ledger and risk: `CoreVault.sol`, `LiquidationManager.sol`, `PositionManager.sol`, `VaultAnalytics.sol`
- Market deployment/admin: `FuturesMarketFactory.sol`, `Diamond.sol`, `LibDiamond.sol`
- OrderBook facets: `OrderBookInit.sol`, `OBAdminFacet.sol`, `OBViewFacet.sol`, `OBPricingFacet.sol`, `OBOrderPlacementFacet.sol`, `OBTradeExecutionFacet.sol`, `OBLiquidationFacet.sol`, `OBSettlementFacet.sol`, `MarketLifecycleFacet.sol`, `MetaTradeFacet.sol`
- OB storage libs: `OrderBookStorage.sol`, `MarketLifecycleStorage.sol`
- Sessions: `GlobalSessionRegistry.sol`
- Collateral hub/spoke + bridges: `CollateralHub.sol`, `SpokeVault.sol`, Wormhole adapters (`HubBridgeInboxWormhole.sol`, `HubBridgeOutboxWormhole.sol`, `SpokeBridgeInboxWormhole.sol`, `SpokeBridgeOutboxWormhole.sol`), plus interfaces
- Tokens: `MockUSDC.sol`, `SpokeMockUSDC.sol`

This summary reflects the latest contracts discovered under `Dexetrav5/src` and their intended responsibilities in production.

