## One‑Year Settlement + Rollover Logic — Implementation Plan (Dexextra)

This document describes how to implement fixed one‑year market lifecycles with conditional rollovers, event‑driven automation, and a 24‑hour settlement challenge window across our existing stack:
DexetraV5 (Solidity, diamond pattern), Supabase (Postgres + Realtime), and Next.js (Vercel). It favors configuration via .env.local and non‑disruptive contract upgrades.


### Goals
- Ensure each market has a one‑year lifecycle with a deterministic settlement timestamp.
- Open a rollover window exactly one month before settlement.
- Conditionally create successor markets if the trailing 30‑day trade count meets a configurable threshold.
- Drive all off‑chain automation from on‑chain events (not polling).
- Provide a 24‑hour pre‑settlement “challenge window” signal for UI, LPs, and operators.
- Persist market lineage (parent → child) for analytics and seamless UI continuity.


### Glossary
- Settlement Timestamp: Unix timestamp set at market creation, exactly one year forward.
- Rollover Window: Period starting 30 days before settlement where rollover eligibility is evaluated.
- Settlement Challenge Window: Period starting 24 hours before settlement; trading behavior may be restricted and disputes/challenges are enabled.
- Successor Market: The child market in the lineage chain created during rollover.


## Architecture Overview

### A. Smart Contracts (DexetraV5 – diamond friendly, minimal surface change)
Focus: additive, facet‑based changes to avoid redeploying core vaults or altering addresses already wired in production.

1) New or extended storage on market facet(s)
- settlementTimestamp: uint256 set at creation time (now + 365 days).
- parentMarket: address (zero for genesis markets).
- childMarket: address (zero until created).
- challengeWindowStart: uint256 (derived as settlementTimestamp − 24h; can be stored once signaled).
- rolloverWindowStart: uint256 (derived as settlementTimestamp − 30 days; can be stored once signaled).

2) Events (emit once; off‑chain infra reacts)
- MarketCreated(market, underlyingId, settlementTimestamp, parentMarket)
- TradeExecuted(market, trader, size, price, timestamp) — already exists in some form; confirm payload aligns with ingestion.
- RolloverWindowStarted(market, rolloverWindowStart)
- RolloverEligible(market, tradeCount30d, threshold) — optional but recommended for observability.
- RolloverCreated(parentMarket, childMarket, settlementTimestamp)
- SettlementChallengeWindowStarted(market, challengeWindowStart)
- MarketSettled(market, settlementTimestamp, finalPriceOrOracleRound) — if not present today, add.

3) Views for front‑end state detection
- getSettlementTimestamp(market) -> uint256
- isInRolloverWindow(market) -> bool (block.timestamp >= settlementTimestamp − 30 days)
- isInSettlementChallengeWindow(market) -> bool (block.timestamp >= settlementTimestamp − 24 hours)
- getMarketLineage(market) -> (parent, child)

4) Keeper/worker entrypoints (permissioned or open‑but‑idempotent)
Because EVM cannot schedule itself, expose small “signal” functions that emit events once thresholds are crossed:
- startRolloverWindow(market) — emits RolloverWindowStarted if time condition met.
- startSettlementChallengeWindow(market) — emits SettlementChallengeWindowStarted if time condition met.
- linkRolloverChild(parent, child) — sets childMarket on parent, parentMarket on child, emits RolloverCreated. Optionally restricted to factory/orchestrator.

Notes
- The actual 30‑day trade count check is off‑chain (computed from indexed trades). Contracts should not count trades on‑chain for cost reasons.
- To minimize risk, success paths are additive and guarded; revert if called outside allowed time windows or if child/parent already set.
- Favor a new MarketLifecycleFacet to group these concerns, preserving existing core logic.

5) Contract upgrade details (diamond-friendly)
- Scope: introduce a new facet (suggested name: MarketLifecycleFacet) and, if needed, a tiny addition to the market factory for initialization of lifecycle data at creation. No redeploy of vaults or address changes.
- Storage (per-market; keyed by market address):
  - settlementTimestamp: uint256 — immutable once set (except one-time initializer for legacy markets).
  - rolloverWindowStart: uint256 — cached when signaled (derived = settlementTimestamp − 30 days).
  - challengeWindowStart: uint256 — cached when signaled (derived = settlementTimestamp − 24 hours).
  - rolloverWindowStarted: bool — idempotency guard.
  - challengeWindowStarted: bool — idempotency guard.
  - parentMarket: address — zero for genesis; set once.
  - childMarket: address — zero until set; set once.
- Events (topics aligned for off-chain indexers):
  - MarketCreated(market, underlyingIdOrSymbol, settlementTimestamp, parentMarket)
  - RolloverWindowStarted(market, rolloverWindowStart)
  - RolloverEligible(market, tradeCount30d, threshold) [optional]
  - RolloverCreated(parentMarket, childMarket, childSettlementTimestamp)
  - SettlementChallengeWindowStarted(market, challengeWindowStart)
  - MarketSettled(market, settledAtTimestamp, finalPriceOrOracleRound)
- External views (read-only integration points for UI/automation):
  - getSettlementTimestamp(market) -> uint256
  - getRolloverWindowStart(market) -> uint256
  - getChallengeWindowStart(market) -> uint256
  - isInRolloverWindow(market) -> bool
  - isInSettlementChallengeWindow(market) -> bool
  - getMarketLineage(market) -> (address parent, address child)
- Keeper/worker entrypoints (idempotent; revert if called out-of-window or already set):
  - startRolloverWindow(market)
  - startSettlementChallengeWindow(market)
  - linkRolloverChild(parent, child)
- Initialization flows:
  - New markets: factory must set `settlementTimestamp = block.timestamp + 365 days` and (optionally) parent address at creation time.
  - Legacy markets: add a one-time `initializeLifecycle(market, settlementTimestamp, parent)` callable by owner/factory. After first call, further calls revert for that market.
- Access control:
  - onlyFactory for initial lifecycle set.
  - onlyRole(KEEPER_ROLE) or onlyOwner for `start*` and `linkRolloverChild` (recommend distinct KEEPER_ROLE for ops; OWNER can always act).
  - Enforce one-child-per-parent and one-parent-per-child invariants.
- Safety:
  - Use a dedicated diamond storage slot (keccak-based) to avoid layout collisions.
  - Mark signal functions idempotent and time-gated; never emit the same event twice.
  - No thresholds stored on-chain; eligibility remains off-chain.

6) Factory integration (FuturesMarketFactory)
- Update `create/deploy` path to:
  - Compute settlementTimestamp = block.timestamp + 365 days.
  - Emit MarketCreated with settlementTimestamp and optional parent.
  - Call the lifecycle facet initializer for the new market (ensures single source of truth inside the diamond).
- Optional: pass forward a `parentMarket` argument when creating a rollover successor so lineage is set atomically (factory knows both addresses).

7) Optional contract-level trading rules (reduce-only during challenge window)
- If we choose to enforce on-chain restrictions:
  - Add a check in the order/position entry point (e.g., PositionManager or OrderRouter facet) that disallows new net-increasing exposure when `isInSettlementChallengeWindow(market)` returns true; allow reduce/close and liquidations.
  - Gate this with a config flag so production can enable/disable without redeploy. Default off; UI/back-end can still enforce via policy.
- If we keep enforcement off-chain initially:
  - Leave this as future work; UI will respect the window using the facet’s view methods and DB signals.

8) Selector/ABI additions (names only)
- Views: getSettlementTimestamp, getRolloverWindowStart, getChallengeWindowStart, isInRolloverWindow, isInSettlementChallengeWindow, getMarketLineage.
- Actions: startRolloverWindow, startSettlementChallengeWindow, linkRolloverChild, initializeLifecycle (one-time for legacy).

9) Diamond cut and rollback
- Add `MarketLifecycleFacet` via diamondCut; register the selectors above.
- Keep a reversible plan: selectors can be removed if needed; storage remains but is benign.
- No changes to existing selectors; avoid signature collisions by using unique names.

10) Settlement event alignment
- If a settlement event already exists, ensure it is emitted from the canonical settlement path; otherwise add `MarketSettled`.
- The life‑cycle facet does not settle markets; it only emits window signals and stores lineage/timestamps used by other components.

11) No‑redeploy guarantee (EIP‑2535 Diamond)
- Address stability: The Diamond proxy (the deployed contract users and integrations interact with) does not change. We add functionality by registering new function selectors pointing to `MarketLifecycleFacet` via `diamondCut`. All existing addresses (vaults, routers, analytics, factory) remain untouched.
- Shared state: Facets execute via delegatecall, so they read/write the same storage as the Diamond. We isolate new lifecycle data in a dedicated diamond storage slot to avoid collisions; no migration of existing storage is required.
- Add/remove without downtime: `diamondCut` supports adding, replacing, and removing selectors atomically. We only add the new selectors (and optionally an init call) — no redeploy of the proxy or core facets.
- One‑time initializer: For legacy markets, an initializer function can be executed in the same `diamondCut` transaction to seed `settlementTimestamp`/parent pointers safely. This avoids separate maintenance windows.
- Rollback path: If needed, the same `diamondCut` can remove the added selectors, instantly disabling new logic while preserving state and addresses.
- Permissions and safety: Only the Diamond owner/timelock executes `diamondCut`. We keep changes additive and idempotent; no changes to existing selectors or core storage layouts.
- Operational impact: Front‑end, Supabase, and off‑chain workers keep using the same contract addresses and ABIs plus the added facet interface; no reconfiguration of allowances or address maps is necessary.

### Settlement 24‑hour Challenge Window — End‑to‑End (current + new)

- Source of truth and trigger
  - On‑chain: `settlementTimestamp` per market. At `block.timestamp >= settlementTimestamp − 24h`, a keeper calls `startSettlementChallengeWindow(market)` on the lifecycle facet.
  - Event: `SettlementChallengeWindowStarted(market, challengeWindowStart)` is emitted exactly once (facet stores an idempotent guard).
  - Views: UI/back‑end can confirm via `isInSettlementChallengeWindow(market)` for defense‑in‑depth.

- Supabase updates (driven by the event)
  - The orchestrator listens for `SettlementChallengeWindowStarted` and sets:
    - `markets.settlement_window_expires_at = now() + interval '24 hours'`
    - Optionally: `markets.proposed_settlement_value` and `markets.proposed_settlement_by` if the initiator provides a proposal at start.
    - Optionally: `markets.market_status = 'SETTLEMENT_REQUESTED'` to make state explicit for queries.
  - Broadcast: use Supabase Realtime or existing sockets to notify subscribed clients immediately.

- Front‑end behavior (tokens page)
  - `MetricLivePrice` already reads `proposed_settlement_value` and `settlement_window_expires_at`. When `settlement_window_expires_at > now`, it renders the “Settlement window active” banner and routes users to the settlement flow.
  - In production, disable the demo override and rely on DB/event signals; a preview flag `NEXT_PUBLIC_FORCE_SETTLEMENT_DEMO` is available for non‑prod.
  - Additional UI: show a countdown (target = `settlement_window_expires_at`), proposer/price if present, and a dispute badge when `settlement_disputed = true`.

- Trading policy during the window
  - Contract‑level (optional): if enabled, the order/position entry path rejects net‑increasing exposure when `isInSettlementChallengeWindow(market)` is true; reduce/close and liquidations remain allowed.
  - Default (off‑chain enforcement): API routes and UI enforce reduce‑only behavior; attempts to increase exposure are blocked server‑side before submitting to chain.

- Proposal and dispute flow (current fields)
  - First proposal: `proposed_settlement_value`, `proposed_settlement_at`, `proposed_settlement_by`.
  - Counterproposal: `alternative_settlement_value`, `alternative_settlement_at`, `alternative_settlement_by`; set `settlement_disputed = true`.
  - These values may be mirrored from on‑chain proposal events or recorded via a service‑role API if the proposal workflow is off‑chain but verifiable.

- Finalization at T0 (settlement moment)
  - Price source: UMA or configured oracle/aggregator resolves the final settlement value.
  - On‑chain: canonical settlement emits `MarketSettled(market, settledAt, finalPriceOrRound)`.
  - Supabase: set `markets.settlement_value`, `markets.settlement_timestamp = now()`, clear/ignore window fields, and set `market_status = 'SETTLED'`.
  - UI: remove the challenge banner, display final settlement, and if a child exists (`market_rollovers`), surface “Next Contract” CTA.

- Reliability and idempotence
  - Repeated keeper calls to `startSettlementChallengeWindow` no‑op after first success (guard flags).
  - DB writes are upserts keyed by `market_id`; the orchestrator remains stateless and re‑entrant.
  - If an event is missed, the orchestrator can backfill by scanning markets where `isInSettlementChallengeWindow` is true and stamping `settlement_window_expires_at`.

- Observability
  - Metrics: windows opened, active disputes, time‑to‑finalization, error rates.
  - Logs: include market identifier/symbol, signal block number, and calculated expiration timestamp.

### Implementation Guide — 24h Settlement Window (step‑by‑step)

1) On‑chain lifecycle (facet)
- Call `startSettlementChallengeWindow(market)` once `block.timestamp >= settlementTimestamp − 24h`.
- Emit `SettlementChallengeWindowStarted(market, challengeWindowStart)`.
- Guard with `challengeWindowStarted == false` and time check; set `challengeWindowStarted = true` and cache `challengeWindowStart`.
- Expose `isInSettlementChallengeWindow(market) -> bool` for UI/back‑end enforcement.

2) Keeper scheduling
- Run a small keeper every 30–60 minutes:
  - Load candidate markets where `now >= settlement_date - 24h` and `challengeWindowStarted == false` (from on‑chain view if indexed or from DB heuristic).
  - Submit `startSettlementChallengeWindow(market)` transactions.
- Recommended config:
  - BACKEND_SETTLEMENT_WINDOW_HOURS = 24
  - BACKEND_SETTLEMENT_EVENT_FINALITY_BLOCKS = 5 (wait N blocks before treating as final in off‑chain processors).

3) Orchestrator flow (event‑driven, idempotent)
- On `SettlementChallengeWindowStarted`:
  - Upsert `markets.settlement_window_expires_at = now() + interval '24 hours'`.
  - Optionally set `markets.proposed_settlement_value` and `markets.proposed_settlement_by` if the initiator supplies a value.
  - Optionally set `markets.market_status = 'SETTLEMENT_REQUESTED'`.
  - Broadcast Realtime event to subscribed clients.
- Reconciliation task (hourly):
  - If an event was missed, detect markets where `now BETWEEN settlement_date - 24h AND settlement_date` and `settlement_window_expires_at IS NULL`; stamp expiration accordingly.
  - Detect expired windows where `now > settlement_window_expires_at` and escalate to settlement finalize workflow.

4) Orchestrator pseudocode

```typescript
// Triggered by on-chain event or scheduled reconciliation
async function onSettlementWindowStart(marketId: string, opts?: { proposedValue?: number; proposer?: string }) {
  await db.upsert('markets', {
    id: marketId,
    settlement_window_expires_at: nowPlusHours(24),
    proposed_settlement_value: opts?.proposedValue ?? db.raw('COALESCE(proposed_settlement_value, NULL)'),
    proposed_settlement_by: opts?.proposer ?? db.raw('COALESCE(proposed_settlement_by, NULL)'),
    proposed_settlement_at: opts?.proposedValue ? new Date().toISOString() : db.raw('proposed_settlement_at')
  }, { key: 'id' });
  await realtime.broadcast({ type: 'settlement_window_started', marketId });
}

async function onSettlementWindowExpire(marketId: string) {
  // hand off to finalize settlement flow (oracle/UMA), then:
  await db.update('markets', marketId, {
    market_status: 'SETTLED',
    settlement_value: /* final value */,
    settlement_timestamp: new Date().toISOString()
  });
  await realtime.broadcast({ type: 'market_settled', marketId });
}
```

5) Supabase SQL snippets (idempotent upsert and queries)

```sql
-- Mark window start (idempotent)
UPDATE markets
SET settlement_window_expires_at = COALESCE(settlement_window_expires_at, NOW() + interval '24 hours'),
    market_status = CASE
      WHEN market_status NOT IN ('SETTLED','EXPIRED') THEN 'SETTLEMENT_REQUESTED'
      ELSE market_status
    END
WHERE id = :market_id;

-- Active windows for UI
SELECT id, market_identifier, proposed_settlement_value, settlement_window_expires_at
FROM markets
WHERE settlement_window_expires_at IS NOT NULL
  AND settlement_window_expires_at > NOW();

-- Windows to finalize
SELECT id
FROM markets
WHERE settlement_window_expires_at IS NOT NULL
  AND settlement_window_expires_at <= NOW()
  AND market_status <> 'SETTLED';
```

6) API surfaces (server routes; no business logic duplication)
- POST `/api/settlement/propose`:
  - Body: `{ marketId, value }`
  - Auth: user or operator; server verifies window active, writes `proposed_settlement_value`, sets `proposed_settlement_at/by`.
- POST `/api/settlement/counter`:
  - Body: `{ marketId, value }`
  - Auth: user or operator; server verifies window active, writes `alternative_settlement_value`, sets `alternative_settlement_at/by`, `settlement_disputed = true`.
- POST `/api/settlement/finalize` (operator/automation):
  - Body: `{ marketId }`
  - Loads oracle result, calls on‑chain finalize (if needed), updates `settlement_value/settlement_timestamp`, sets status to `SETTLED`.

7) UI behavior and states
- Tokens page:
  - Uses `MetricLivePrice` to detect active window (`settlement_window_expires_at > now`).
  - CTA: open settlement flow drawer/page; show proposer/value, countdown; offer propose/counter actions (if allowed).
  - When settled: hide banner; show final price; surface “Next Contract” CTA if lineage exists.
- Optional global banner on market detail when window is active.

8) Monitoring and alerts
- Emit structured logs on window start/expire/finalize with `market_identifier`, chain `blockNumber`, and timestamps.
- Set alerts for:
  - Window started but no finalize after 26h.
  - Disputed windows rate > X% over rolling 24h.
  - Oracle failure/retry loops.

9) Failure modes and recovery
- Missed event: reconciliation stamps window expiration if within bounds.
- Chain reorg: wait BACKEND_SETTLEMENT_EVENT_FINALITY_BLOCKS before DB stamping; reconcile on mismatch.
- Duplicate submissions: upserts and idempotent guards prevent double stamping.

10) Testing plan
- Unit (contracts): time‑gated guards, idempotence, view correctness around boundary times.
- Integration (orchestrator + DB): event → upsert → UI observable; expire → finalize path.
- E2E (UI): banner appears only during the window; proposals recorded; dispute badge; finalization clears banner.

### B. Off‑Chain Automation (event‑driven; no blind polling)
We rely on on‑chain events to drive off‑chain work. A lightweight orchestrator listens and reacts:

1) Event ingestion pipeline (existing)
- Ingest TradeExecuted and MarketCreated into Supabase.
- Maintain per‑market rolling 30‑day trade counts (see Data Model).

2) Orchestrator responsibilities
- On MarketCreated: persist market with settlementTimestamp; schedule internal reminders keyed by timestamps (metadata only; primary trigger remains on‑chain time + callable signal functions).
- On (time >= settlementTimestamp − 30 days): call startRolloverWindow(market). The call emits RolloverWindowStarted (single on‑chain op). This can be triggered by a time‑aware worker or a keeper job; it is not a data poll — it’s a single deterministic call once when eligible.
- On RolloverWindowStarted: query Supabase for trailing 30‑day trade count; compare with configured threshold.
  - If count ≥ threshold: create successor via existing factory (or orchestrator script), then call linkRolloverChild(parent, child). Emit RolloverCreated on‑chain. Index the new market.
  - If count < threshold: mark market as RolloverSkipped in Supabase; no child is created.
- On (time >= settlementTimestamp − 24 hours): call startSettlementChallengeWindow(market) to emit SettlementChallengeWindowStarted.
- On MarketSettled: mark settled in Supabase; front‑end transitions to post‑settlement state and may redirect users to the child market if exists.

3) Configuration for thresholds and modes
- Production: threshold default 20 trades/30 days.
- Testing: threshold 1–2 trades/30 days.
- Read from environment variables for both backend workers and front‑end UI hints. No code changes needed to simulate in dev/test.


### C. Supabase Data Model and Migrations
Extend existing schemas with minimal changes. Target is to keep writes idempotent and joins simple. Verified against System Insider Supabase (project “Dexetera”) via mCPI: the following tables already exist and should be used for rollout.

1) markets (uuid pk: `id`)
- Identity: `id` (uuid), `market_identifier` (text, unique), `symbol`, `name`, `category`.
- Scheduling: `settlement_date` (scheduled settlement; set to creation + 365 days), `trading_end_date` (optional, must be ≤ `settlement_date`).
- State: `market_status` (PENDING | DEPLOYING | ACTIVE | TRADING_ENDED | SETTLEMENT_REQUESTED | SETTLED | EXPIRED | PAUSED | ERROR), `deployment_status`.
- Settlement outcome: `settlement_value`, `settlement_timestamp` (actual settle time; distinct from scheduled `settlement_date`).
- 24h challenge window (already present from migration 010):
  - `proposed_settlement_value`, `proposed_settlement_at`, `proposed_settlement_by`
  - `settlement_window_expires_at` (challenge window end)
  - `alternative_settlement_value`, `alternative_settlement_at`, `alternative_settlement_by`
  - `settlement_disputed` (boolean)
- Display/config: `market_config` (jsonb), media URLs, totals (volume/trades), OI, `last_trade_price`.
- On‑chain refs: `market_address`, `market_id_bytes32`, `chain_id`, `network`.
- Timestamps: `created_at`, `updated_at`, `deployed_at`.

Indexes
- Pre‑existing: identifier/symbol/category/status/created_at/market_address, plus specific indexes on the settlement window fields (e.g., `settlement_window_expires_at`).
- For rollover decisions, derive “window start” from `settlement_date - interval '30 days'` in queries; no extra column needed.

2) user_order_events (trade activity source)
- Fields: `market_metric_id` (text), `event_type` (SUBMITTED/ACCEPTED/PARTIAL_FILL/FILLED/CANCELLED/EXPIRED/REJECTED), price/quantity, tx/log metadata, timestamps.
- Mapping: `user_order_events.market_metric_id` aligns with `markets.market_identifier`.
- Use case: compute trailing 30‑day “trade count” for rollover eligibility. Recommended definition: distinct `order_id` with at least one `FILLED` or `PARTIAL_FILL` event within [now − 30d, now].
- Note: Existing unique and time indexes make range queries feasible. No schema change required.

3) market_series, series_markets, market_rollovers (lineage and continuity)
- `market_series`: groups markets for the same underlying (e.g., Nickel) with metadata and default roll cadence (e.g., monthly/annual).
- `series_markets`: maps individual `market_id` to a series, with `sequence` and `is_primary` flags for routing.
- `market_rollovers`: explicit parent→child link with `from_market_id`, `to_market_id`, optional notes, and defaults (`default_overlap_days`, default 30).
- Use case: when a rollover is created on‑chain, the orchestrator inserts a row in `market_rollovers` and optionally appends to `series_markets`. This powers charts/continuity and “Next Contract” UI.

4) Price streams (for completeness)
- `market_tickers` (latest mark, `is_stale`) and `market_prices` (timeseries) power live price components and are orthogonal to rollover, but useful for banners/countdowns.

5) Rollover decision data path (no polling; event‑driven)
- Ingest on‑chain trade events (existing webhook → processor) → append to `user_order_events`.
- At `RolloverWindowStarted`, orchestrator computes trailing 30‑day trade count from `user_order_events` joined to `markets` via `market_identifier`, compares to threshold (env‑configurable).
- If eligible: create successor on‑chain; then insert `market_rollovers` row (`from_market_id` = parent, `to_market_id` = child) and attach child to the same `market_series` via `series_markets`.
- If not eligible: mark decision in app logs/metadata; no DB schema change needed, but you may store a lightweight “skipped” note on `market_rollovers` with `to_market_id = NULL` if desired (optional).

### D. Front‑End Behavior (Next.js)

1) Market banners and state
- Show “Rollover Window” banner when isInRolloverWindow is true.
- Show “Settlement Challenge Window” banner when isInSettlementChallengeWindow is true.
- Display a countdown to settlement and to the challenge window start.
- If a child exists: surface “Next Contract” with deep link and market summary.

2) Trading restrictions
- During Settlement Challenge Window, apply configured restrictions:
  - Option A: disable new positions; allow reduces/closures only.
  - Option B: fully lock trading except liquidation/close.
- Respect a contract view or an API gate that enforces behavior consistently with back‑end rules.

3) Rollover indicators
- If rollover skipped (low activity): label market as “Expiring — No Successor.”
- If rollover created: show “Successor live” with CTA to migrate/roll to the child market.

4) Config and observability
- Read threshold and mode flags from environment to control banners in dev/test without touching mainnet logic.
- Subscribe to on‑chain events through our provider and/or Supabase Realtime streams for instant UI updates.

5) Tokens page and `MetricLivePrice` integration
- Current behavior (verified): `MetricLivePrice` resolves `marketId` by querying `markets` with either `market_identifier` or `symbol`, then reads `proposed_settlement_value` and `settlement_window_expires_at` to derive a local `isSettlementActive` flag; it exposes a CTA to open the settlement flow. A temporary `FORCE_SETTLEMENT_DEMO` flag forces the banner in dev.
- Planned wiring:
  - Backend orchestrator listens for the on‑chain `SettlementChallengeWindowStarted` event and stamps `markets.settlement_window_expires_at` = now + 24h (and, when applicable, the proposer/value fields).
  - The tokens page reuses `MetricLivePrice` as‑is: when `settlement_window_expires_at` is in the future, the component renders the “Settlement window active” state with a countdown tooltip sourced from that timestamp.
  - For production, remove or gate `FORCE_SETTLEMENT_DEMO` via `NEXT_PUBLIC_FORCE_SETTLEMENT_DEMO` (default false). No UI code changes are required beyond toggling that flag and ensuring the DB fields are updated by the worker.
- Lineage UI:
  - When `market_rollovers` has a row for the current `marketId`, the tokens page can surface a “Next Contract” badge linking to the `to_market_id` market’s detail.
  - For expired markets with no successor, show “Expiring — No Successor.”

### E. Configuration and Environments

Environment variables (names illustrative; final names to be aligned across apps):
- BACKEND_ROLLOVER_THRESHOLD (default 20)
- BACKEND_ROLLOVER_MODE (production | testing)
- NEXT_PUBLIC_ROLLOVER_THRESHOLD (UI hints only)
- NEXT_PUBLIC_ROLLOVER_MODE (production | testing)
- NEXT_PUBLIC_FORCE_SETTLEMENT_DEMO (default false; only for preview/dev to mimic active window)

Rules
- Production deploys use the production threshold.
- Testing and preview deploys (Vercel) can override without changing code.
- Orchestrator and front‑end read their respective vars from .env.local/.env.*.


### F. Timelines and State Machine

Key timestamps per market:
- T0: MarketCreated; settlementTimestamp = T0 + 365 days.
- T−30d: RolloverWindowStarted (emit once via startRolloverWindow when eligible).
- T−30d … T−24h: Orchestrator evaluates 30‑day trade count from `user_order_events`; if eligible, creates successor and records `market_rollovers` (parent→child).
- T−24h: SettlementChallengeWindowStarted (emit once via startSettlementChallengeWindow when eligible).
- T0: MarketSettled; market becomes inactive; UI focuses on child if present.

Rollover outcomes:
- Eligible → RolloverCreated → parent.child set to new market.
- Not eligible → Skipped → parent.child remains null; market expires at settlement.


### G. Security and Invariants
- Only one child per parent; enforce once‑only linkage on‑chain.
- start* functions revert if called before time or after already signaled.
- linkRolloverChild allowed for factory/orchestrator only; child must not already have a parent.
- Factory validates successor configuration (underlying, oracle, params) to prevent drift.
- Emit events exactly once; make calls idempotent where possible.
- Emergency circuit‑breaker: owner/operator can pause signal functions if required.


### H. Backfill and Migration Plan
1) Schema migrations
- Markets: already has settlement window columns (proposed/alternative/expires/disputed). Ensure `settlement_date` is set for all live markets (creation + 365d policy).
- Lineage: `market_series`, `series_markets`, and `market_rollovers` exist — no schema change required; confirm indexes.
- Activity: optional future addition of a lightweight rollup or materialized view for trailing 30‑day trade counts; not required to launch (can be computed on demand).

2) Data backfill
- Populate `settlement_date` for live markets using creation date + 365 days (or a chosen alignment policy).
- Initialize lineage where known by inserting rows in `market_rollovers` and associating series via `series_markets`.
- Seed initial activity snapshots if desired (optional; computed on demand otherwise).

3) Contract upgrades
- Deploy MarketLifecycleFacet with events and view functions; wire into diamond.
- No changes to vault addresses or critical core contracts.

4) Orchestrator roll‑out
- Deploy/enable the worker with read‑only access to Supabase and write access to chain via configured signer.
- Dry‑run in testing mode using dev thresholds.


### I. Testing and Verification
- Unit tests for time window guards on views and signal functions.
- Integration tests for orchestrator: window start → eligible decision → successor creation → linkage event.
- Front‑end E2E tests to ensure banners, locks, and redirects appear at correct times.
- Load tests to verify 30‑day rollup performance and query latency.


### J. Acceptance Criteria
- Markets always have a settlementTimestamp one year out at creation.
- RolloverWindowStarted emitted exactly once and not before T−30d.
- SettlementChallengeWindowStarted emitted exactly once and not before T−24h.
- Successor creation happens only when trailing 30‑day trade count ≥ threshold.
- Parent/child pointers are consistent on‑chain and in Supabase (`market_rollovers` row exists and points to correct `from_market_id`/`to_market_id`).
- Front‑end reflects rollover and settlement states without manual refresh.
- Configuration toggles allow testing behavior without touching production logic.


### K. Incremental Delivery Plan (suggested)
1) Contracts: add MarketLifecycleFacet with events + views; no off‑chain usage yet.
2) Supabase: migrations for markets schema, rollup support; backfill.
3) Orchestrator: implement event listeners and 30‑day rollup maintenance.
4) Rollover: implement window signaling and eligibility decision; wire child linking.
5) Front‑end: banners, locks, successor linking, lineage UI.
6) Finalize testing, run a canary market through full lifecycle in testing mode.


### Notes
- Event names are illustrative; adapt to current naming conventions where similar events already exist to avoid duplication.
- If existing events cover TradeExecuted/MarketCreated, reuse them and extend payloads only if necessary.
- This plan is additive and respects current production addresses and Vercel environment variable workflows.


