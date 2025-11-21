## Gasless Trading Integration — Minimal-Change Plan

### Goals
- Enable a “gasless” UX where users sign EIP‑712 messages and a relayer pays gas.
- Avoid breaking existing behavior that relies on `msg.sender` across facets and the vault.
- Make only small, targeted changes to smart contracts; prefer additive over invasive edits.

### Current Architecture Observations
- Order placement pipelines already thread the real trader address through internal functions:
  - Private internals accept `address trader` and perform all core logic (matching, events, vault ops).
- External entrypoints use `msg.sender` to confirm ownership and identity.
- The vault actions used by the order book are role-gated (`ORDERBOOK_ROLE`) and called by the diamond, not by end users.
- There are explicit comments acknowledging cross‑facet `msg.sender` pitfalls during settlement; the surface area for a global `_msgSender()` retrofit is high.

### Options Considered
- ERC‑2771 (Trusted Forwarder + `ERC2771Context`): Would require systematically switching from `msg.sender` to `_msgSender()` across many facets (order placement, modify, cancel, admin, factory, vault user functions), plus maintaining a trusted forwarder list. This is a large cross‑cutting change and has higher breakage risk.
- Gasless Meta Facet (recommended): Add a dedicated facet that verifies EIP‑712 signatures then calls the existing order book internals while explicitly providing the `trader` address. This avoids changing current external methods or the vault and preserves event semantics.

### Recommended Approach (Minimal Changes)
1) Add `MetaTradeFacet` (new file, added to the Diamond):
   - Holds an EIP‑712 domain (name, version, chainId, verifyingContract = diamond).
   - For each supported action, verifies a typed struct signed by the real trader, then performs a cross‑facet self‑call into the OrderBook facet to execute as if the trader called it.
   - Maintains a per‑user `metaNonce` mapping for replay protection across actions.
   - Emits a common “meta call” event including digest, trader, and action for observability.

2) Add “self‑call only” entrypoints to `OBOrderPlacementFacet` (“By” variants):
   - `cancelOrderBy(address trader, uint256 orderId)`
   - `placeLimitOrderBy(address trader, uint256 price, uint256 amount, bool isBuy)`
   - `placeMarginLimitOrderBy(address trader, uint256 price, uint256 amount, bool isBuy)`
   - `placeMarketOrderBy(address trader, uint256 amount, bool isBuy)`
   - `placeMarginMarketOrderBy(address trader, uint256 amount, bool isBuy)`
   - `modifyOrderBy(address trader, uint256 orderId, uint256 newPrice, uint256 newAmount)`

   Each should:
   - Start with `require(msg.sender == address(this), "Only self-calls allowed");`
   - Reuse existing private helpers to avoid duplication (e.g., `_placeLimitOrder(trader, ...)`, `_placeMarket(trader, ...)`).
   - Replace `msg.sender` occurrences with the explicit `trader` parameter in ownership checks, list updates, and events.
   - Keep identical event shapes to maintain indexer compatibility.

3) Relayer Service (backend):
   - Receives signed EIP‑712 payloads from the client.
   - Validates signatures off‑chain, checks `deadline`, `metaNonce` (via JSON‑RPC call if needed), action allowlist, size/price/risk constraints, per‑user rate limits.
   - Submits a transaction invoking the corresponding `MetaTradeFacet.meta<Verb>` method.
   - Funds HYPE gas; monitors receipts, stores tx status, exposes status API to the frontend.

4) Frontend:
   - Build typed data for the chosen action (Cancel, PlaceLimit, Place/Modify Market, etc.).
   - Sign with the user’s wallet (no gas) and POST to the relayer.
   - Show optimistic UI with pending status, then confirm based on relayer callbacks or polling.
   - Fallback to on‑chain transaction path if relayer unavailable.

### Why This Is Minimal and Safe
- No need to retrofit `_msgSender()` everywhere; we leave existing methods intact.
- The diamond already possesses `ORDERBOOK_ROLE`, so vault calls from OB internals remain authorized when invoked via cross‑facet self‑call.
- All current event shapes and semantics are preserved.
- Changes are additive: a new facet + a handful of guarded “By” methods in the OB facet.

### Cancel Orders — Specifics
- Current cancel relies on `require(order.trader == msg.sender)` and unreserves margin in the vault (via `ORDERBOOK_ROLE`‑gated calls).
- Minimal change:
  - Add `cancelOrderBy(address trader, uint256 orderId)` with self‑call guard, using the provided `trader` for the ownership check and user‑list removal, and emitting `OrderCancelled(orderId, trader)`.
  - Keep both namespaced `reservationId` and legacy `bytes32(orderId)` unreserve calls for backward compatibility.
- Meta flow:
  - The relayer submits `MetaTradeFacet.metaCancelOrder(trader, orderId, deadline, nonce, signature)`.
  - The facet verifies signature and nonce, then calls `address(this).cancelOrderBy(trader, orderId)`.
  - Replays after a successful cancel revert because the order no longer exists; the `metaNonce` blocks cross‑action replay attempts.

### EIP‑712 Typed Data (Schemas)
- Domain:
  - `name`: “DexetraMeta” (example)
  - `version`: “1”
  - `chainId`: HyperEVM chainId
  - `verifyingContract`: Diamond address

- Types (examples, adjust as needed):
  - CancelOrder: `{ address trader; uint256 orderId; uint256 deadline; uint256 metaNonce; }`
  - PlaceLimit: `{ address trader; uint256 price; uint256 amount; bool isBuy; bool isMargin; uint256 deadline; uint256 metaNonce; }`
  - PlaceMarket: `{ address trader; uint256 amount; bool isBuy; bool isMargin; uint256 maxPriceOrMinPrice; uint256 deadline; uint256 metaNonce; }`
  - ModifyOrder: `{ address trader; uint256 orderId; uint256 newPrice; uint256 newAmount; uint256 deadline; uint256 metaNonce; }`

Notes:
- Include a `deadline` to bound signature validity.
- Per‑user `metaNonce` prevents cross‑action replay and allows idempotency control.

### Security & Policy
- Restrict meta actions to a specific allowlist inside the relayer and optionally in the facet.
- Enforce reasonable bounds (e.g., slippage caps, max sizes) before forwarding.
- Per‑address daily gas caps and rate limiting in the relayer.
- Consider a server‑side rules engine for maintenance windows (e.g., settlement), market pauses, and kill switches.
- Store and expose execution traces/revert reasons for support.

### Token Approvals and Deposits
- Trading requires collateral availability in the vault:
  - To make “first‑time” funding gasless, adopt EIP‑2612 permits for tokens that support it, or use Permit2.
  - If the collateral token lacks permit, users will still need to perform an on‑chain approval/deposit once.
  - This plan avoids modifying the vault for ERC‑2771; approvals can be achieved via signature flows where supported.

### Configuration
- Keep addresses and endpoints in environment configuration:
  - `NEXT_PUBLIC_DIAMOND_ADDRESS`
  - `NEXT_PUBLIC_RELAYER_URL`
  - `NEXT_PUBLIC_CHAIN_ID`
  - `RELAYER_PRIVATE_KEY` (server only)
  - `RPC_URL_HYPEREVM`
  - `EIP712_DOMAIN_NAME`, `EIP712_DOMAIN_VERSION`
- Use `.env.local` for deploy‑specific values; do not hardcode in the app.

### Deployment & Rollout
1) Deploy `MetaTradeFacet` and add to the diamond (diamond cut).
2) Add the “By” self‑call methods to `OBOrderPlacementFacet` and cut the facet.
3) Stand up the relayer with a funded signer; connect it to HyperEVM RPC.
4) Wire the frontend: add a “Gasless” toggle, sign EIP‑712 messages, and POST to relayer.
5) Start with cancel + limit/market placement; add modify flows next.
6) Add permit‑based deposit/approval where supported, to fully remove first‑time on‑chain steps.
7) Monitor and iterate on rate limits, caps, and observability.

### Testing Strategy
- Unit tests (Solidity):
  - Signature recovery and nonce handling in `MetaTradeFacet`.
  - `cancelOrderBy`/`place*By` logic parity with existing external methods.
  - Vault unreserve behavior unchanged and properly role‑gated.
- Integration tests (JS/TS):
  - End‑to‑end meta cancel/placement through the relayer.
  - Replay attempts (same signature) revert due to `metaNonce` or state changes.
  - Edge cases: margin orders, partial fills, market with no liquidity.

### Optional Future: ERC‑2771 (Forwarder)
- If desired later, you can layer OZ `MinimalForwarder` and adopt `ERC2771Context` gradually, but it requires refactoring to `_msgSender()` throughout all identity checks. The meta‑facet approach provides gasless UX now without that refactor.

### Minimal Contract Delta (Summary)
- New: `MetaTradeFacet` (EIP‑712 + dispatcher; maintains `metaNonce`).
- OB Facet: Add 4–6 “By” methods (self‑call guarded) to reuse existing internals with an explicit `trader`.
- No changes required to `CoreVault`, `FuturesMarketFactory`, or other facets.
- No changes to existing external methods or events; no global sender abstraction change.

### Key Benefits
- Gasless UX with minimal risk to existing logic.
- Additive changes, easy rollback (remove facet or disable relayer).
- Preserves vault roles and diamond storage; avoids a large `_msgSender()` retrofit.

### Next Steps
- Implement `MetaTradeFacet` and the OB “By” methods.
- Stand up the relayer and wire the frontend EIP‑712 flow.
- Ship behind a feature flag (“Gasless” toggle), then ramp traffic.

## Part 2 — Multi‑chain, Gasless Vault Funding (Credit Ledger)

### Goals
- Let users deposit on any blockchain and start trading on HyperEVM without ever touching HYPE.
- Keep changes minimal and additive; favor role‑gated credits over invasive vault rewrites.

### Design Overview
- Treat external deposits as “credit entries” recorded in the HyperEVM vault.
- Users fund addresses on origin chains; off‑chain watchers attest deposits; a relayer submits a gas‑paid credit tx on HyperEVM.
- Trading logic counts this credit as available collateral; withdrawals are handled via a separate, explicit flow.

### Minimal CoreVault changes (additive)
- **New role**: `BRIDGE_ROLE` to authorize crediting.
- **Replay protection**: `processed[bytes32 depositKey]` where `depositKey = keccak256(srcChainId, srcTxHash, logIndex)`; must be unique per origin deposit.
- **Credit ledger**: `userBridgedCredit[address user]` in 6 decimals (USDC‑style).
- **Entry point**: `creditFromBridge(address user, uint256 amount6, bytes32 depositKey, uint256 srcChainId)` `onlyRole(BRIDGE_ROLE)`.
  - Validates nonzero `user`/`amount6`, `!processed[depositKey]`, marks processed, increments `userBridgedCredit[user]`.
  - Emits `ExternalDepositCredited(user, amount6, srcChainId, depositKey)`.
- **Availability for trading**: Include `userBridgedCredit[user]` in the collateral used by margin checks (e.g., add into `getAvailableCollateral` computation).
- **Withdrawals (phase 1 safeguard)**:
  - Exclude `userBridgedCredit` from immediate on‑chain `withdrawCollateral` to prevent accidental redemption before outbound rails exist.
  - Revert with a clear reason if the withdraw attempts to draw from bridged credit; or gate behind a new “request withdrawal” path (see below).

These edits are isolated to the vault and do not affect OrderBook facets or events.

### Off‑chain attestation flow (initial, simple)
- **Watchers**: Index deposits on supported chains/tokens; wait for N confirmations per chain policy.
- **Normalization**: Convert origin token amounts to 6‑decimals USDC equivalent (apply off‑chain FX/oracle if accepting non‑stables).
- **Attestation**: Derive `depositKey`; have a threshold signer set (multisig/quorum) sign an attestation payload.
- **Relayer**: Calls `creditFromBridge` with `user`, `amount6`, `depositKey`, `srcChainId`; pays HYPE gas.
- **Observability**: Store source chain receipt, depositKey, credited amount; expose status APIs for the UI.

### Option (later): Trust‑minimized cross‑chain messaging
- Deploy a single `BridgeInbox` on HyperEVM to receive messages from LayerZero/Axelar/Wormhole/Hyperlane/CCIP per origin chain.
- The inbox forwards into `creditFromBridge` (or calls an internal `_creditFromInbox` with stricter msg.sender checks).
- Start with a few large chains; expand as needed without changing the vault interface.

### Security, risk, and policy controls
- **Replay safety**: Enforce `processed[depositKey]` uniqueness; reject duplicates.
- **Allowlists**: Chain and token allowlists; per‑user/per‑day caps; pausability.
- **Confirmations**: Per‑chain finality windows before attesting.
- **Normalization**: 6‑decimals unit; document FX policy if taking volatile assets.
- **Audit trail**: Emit structured events; keep an off‑chain ledger with links to origin txs.

### UX considerations (gasless)
- Users send to deposit addresses/QRs on their preferred chain.
- The HyperEVM credit is applied via your relayer, with no HYPE handling by the user.
- Frontend polls a status endpoint by `depositKey` or origin tx hash; shows “credited” when the HyperEVM event lands.
- All config (chains, tokens, endpoints) supplied via environment variables.

### Minimal contract delta (Part 2)
- CoreVault: add `BRIDGE_ROLE`, `processed` mapping, `userBridgedCredit`, `creditFromBridge`, and a small inclusion in collateral calculations; explicitly gate withdrawals of bridged credit until outbound rails are shipped.
- No changes required to OrderBook facets or trading events.
- Optional: if zero vault changes are required, use a `CreditOverlay` and have the vault read it when computing availability (still a tiny hook) or incorporate overlay at the relayer/UI layer until the vault edit is deployed.

### Withdrawal system (phase 2 of Part 2)
- Add a “withdrawal request” API that:
  - Burns or earmarks `userBridgedCredit` on HyperEVM.
  - Triggers an outbound payment on an external chain (or a local stablecoin transfer if treasury sits on HyperEVM).
  - Uses similar replay/rate‑limit patterns and can be made gasless via relayer.

### Configuration (env)
- `BRIDGE_ATTESTER_SET` or `BRIDGE_INBOX` address (if using on‑chain messaging).
- `DEPOSIT_ALLOWED_CHAINS`, `DEPOSIT_ALLOWED_TOKENS`, `DEPOSIT_CONFIRMATIONS`.
- `RPC_URL_*` per origin chain, `RPC_URL_HYPEREVM`, `CHAIN_ID_HYPEREVM`.
- Relayer secrets and endpoints; feature flags for chain rollouts.

### Rollout plan (Part 2)
1) Implement the vault credit ledger changes; run unit tests for replay/credit math.
2) Ship watchers + relayer; wire status APIs; fund HyperEVM relayer.
3) Enable deposits for 1–2 origin chains; monitor; then expand.
4) Implement the withdrawal request system; then enable redemption of bridged credit.


