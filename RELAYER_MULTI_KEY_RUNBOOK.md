## Multi-relayer key architecture (runbook)

This document describes **how to safely and scalably run multiple relayer EOAs** (multiple private keys) so the backend can submit **multiple transactions per second** without nonce races.

It is written for our current architecture where “relayer” means server-side transaction submission from a funded EOA.

---

### Decision: routing strategy

We will use **load-aware assignment** (not purely deterministic hashing).

- **Why this is safest**: it prevents single-key hot spots under bursty traffic and allows us to automatically route around a stuck/paused key. The safety comes from **strict per-key nonce allocation with a distributed lock** (see below), not from “sticky” routing.
- **Why this scales best**: with \(N\) keys we get up to \(N\) parallel nonce streams, and load-aware selection keeps those streams evenly utilized.

If we later need “strict per-user ordering”, we can layer it on by forcing *per-trader* sequencing (separate from key routing). Do not rely on sticky routing for correctness.

---

## Architecture overview

### Components

- **Relayer key pool**: `K` funded EOAs. Each key has its own nonce stream.
- **Router**: chooses which key handles a request (load-aware).
- **Nonce allocator**: allocates nonces safely for a chosen key using a **distributed lock**.
- **Sender**: signs + broadcasts a transaction with an **explicit nonce** and returns `txHash`.
- **Receipt tracker (optional)**: monitors pending txs, detects stuck txs, and can speed up / rebroadcast.

### Golden rules

1) **Never** let two concurrent processes send from the same relayer address without coordination.
2) Every tx must be sent with an explicit `nonce` allocated by the allocator.
3) Treat “pending tx backlog” as the main signal for routing decisions.
4) Secrets (private keys) must never be committed or logged.

---

## Deposit relaying (bridge deposits) — how this fits the architecture

We currently have **two classes of relayed transactions**:

- **Trading/session actions** (gasless trading UX on the hub chain)
- **Deposits** (gasless deposit UX via hub-and-spoke bridge)

Deposits are *still relayer transactions* and must use the same **multi-key + nonce allocation** discipline.

### Deposit pipeline (high level)

Our “gasless deposit” architecture is **transfer-only for the user**, and relayer-driven for bridging:

1) **User** transfers ERC20 (e.g. Spoke USDC / “Spook”) to `SpokeVault` on the spoke chain.
2) **Relayer (spoke)** submits `SpokeBridgeOutboxWormhole.sendDeposit(dstDomainHub, user, token, amount, depositId)`.
3) **Relayer (hub)** submits `HubBridgeInboxWormhole.receiveMessage(srcDomainSpoke, srcAppBytes32, payload)` which calls `CollateralHub.creditFromBridge(...)` → credits CoreVault externally.

There are *two separate on-chain submissions* in the deposit path (spoke outbox, hub inbox). Each needs:

- an assigned relayer key
- a correctly allocated nonce for that key on that chain
- good retry semantics for transient errors

### Key pools: one pool vs per-chain pools

**Strong recommendation**: treat each chain as an independent nonce stream and model it explicitly.

- **Option A — Single key pool used across multiple chains**
  - Simple to configure.
  - Still requires nonce allocation to be **per (relayerAddress, chainId)**.

- **Option B — Separate pools per chain (recommended operationally)**
  - Example: `RELAYER_PRIVATE_KEYS_HUB_JSON` and `RELAYER_PRIVATE_KEYS_ARBITRUM_JSON`.
  - Reduces blast radius: a stuck/hot spoke key doesn’t impact hub trading throughput.
  - Lets you fund/monitor balances per chain independently.

### Deposit idempotency rules (important)

Deposits must be idempotent, because relayers and webhooks can retry:

- **Hub idempotency**: `CollateralHub.creditFromBridge(...)` reverts with `"deposit processed"` for an already-credited `depositId`.
  - Treat this as **success** (already credited) in the relayer send path.
  - Your sender should:
    - `staticCall` preflight where possible, and
    - if you still send and it reverts with `"deposit processed"`, record it as `mined/already_processed`.

### Nonce collision is the #1 deposit failure mode under load

The most common production failure looks like:

- `"nonce has already been used"` / `"nonce too low"` / `"known transaction"` / `"replacement transaction underpriced"`

This happens when:

- multiple runtime instances send from the **same relayer address** without coordination, or
- the same relayer key is used for **both trading and deposits** without a shared allocator, or
- a webhook relayer and an API relayer both share the same key.

Solution: nonce allocator + per-key lock (described below), and ideally **separate pools per chain**.

---

## Session trading (sign once, trade many) — multi-relayer authorization (V2)

We upgraded sessions so a trader can **authorize a set of relayers** with a single signature.

### What changed

- **Old**: session permit bound to one `relayer` address.
- **New**: session permit binds to `relayerSetRoot` (Merkle root of allowed relayer EOAs).

On-chain enforcement is via `GlobalSessionRegistry`:\n
- A session trade succeeds only if `msg.sender` is included in the Merkle set for that session.
- Each session trade includes a Merkle proof.

Operational implication:

- If you rotate the relayer keyset, existing sessions may fail with `session: bad relayer`.\n  UX should prompt the user to re-init gasless sessions.

### App integration notes

- The client fetches the current relayer set root from:\n  - `/api/gasless/session/relayer-set`\n  and signs it into the permit.\n- The server chooses a relayer key for each session trade and attaches the Merkle proof automatically.\n
---

## Smart contract role checklist (onboarding new relayer keys)

This is the **minimum on-chain permissions checklist** required before a new relayer EOA can safely take on
deposit delivery and/or trading responsibilities.

### Deposits (spoke → hub credit)

To let a relayer handle deposits end-to-end:

- **Spoke chain (e.g., Arbitrum)**
  - **`SpokeBridgeOutboxWormhole.DEPOSIT_SENDER_ROLE` → relayer EOA**
    - Required to call `sendDeposit(...)` after observing user transfers into `SpokeVault`.

- **Hub chain**
  - **`HubBridgeInboxWormhole.BRIDGE_ENDPOINT_ROLE` → relayer EOA**
    - Required to call `receiveMessage(...)` to deliver deposit payloads to the hub.

Contract-to-contract wiring that must already be in place (these are NOT per-relayer):

- **Hub chain**
  - **`CollateralHub.BRIDGE_INBOX_ROLE` → `HubBridgeInboxWormhole` contract**
    - Allows hub inbox to call `CollateralHub.creditFromBridge(...)`.
  - **`CoreVault.EXTERNAL_CREDITOR_ROLE` → `CollateralHub` contract**
    - Allows CollateralHub to call `CoreVault.creditExternal(...)` / `debitExternal(...)`.

Idempotency note:

- If hub delivery reverts with `"deposit processed"`, treat it as **success** (already credited).

### Withdrawals (hub → spoke release)

If you want a relayer to also handle the withdraw path:

- **Hub chain**
  - **`CollateralHub.WITHDRAW_REQUESTER_ROLE` → relayer EOA** *(optional)*
    - Only required if you want the relayer to call `CollateralHub.requestWithdraw(user, ...)` on behalf of users.

- **Spoke chain (e.g., Arbitrum)**
  - **`SpokeBridgeInboxWormhole.BRIDGE_ENDPOINT_ROLE` → relayer EOA**
    - Required to call `SpokeBridgeInboxWormhole.receiveMessage(...)` for withdraw deliveries.

Contract-to-contract wiring that must already be in place (NOT per-relayer):

- **Spoke chain**
  - **`SpokeVault.BRIDGE_INBOX_ROLE` → `SpokeBridgeInboxWormhole` contract**
    - Allows the spoke inbox to call `SpokeVault.releaseToUser(...)`.

### Trading / gasless actions (hub)

For the gasless trading endpoints in this repo, the relayer EOA typically does **not** require an AccessControl
role on CoreVault/OrderBooks to submit:

- **Meta trades** (`metaPlace*`, `metaCancel*`): authorized by user EIP-712 signature + nonce.
- **Meta top-up** (`CoreVault.metaTopUpPositionMargin`): authorized by user signature + `topUpNonces(trader)`.

Session-based trading (sign once, trade many) has a different requirement:

- **Sessions** (`sessionPlace*`, `sessionCancel*`)
  - Authorization is *not a role*; the on-chain check is:
    - `msg.sender == session.relayer` (or the global session registry enforces relayer allowlist),
  - Which means: **each trader session must be created for the relayer address that will execute it**.

Practical guidance:

- If you rotate/expand relayers, either:
  - ensure session permits are created with the selected relayer address, or
  - standardize on a “session relayer pool” and route session trades only within that pool.

## Data model (shared state)

We need a shared store accessible by all runtime instances (serverless included). Postgres works well for this (Supabase Postgres is fine).

Create a table to represent each relayer key/address:

- `relayer_keys`
  - `id` (uuid)
  - `address` (text, lowercase)
  - `chain_id` (int) — **required**; nonce streams are per-chain
  - `enabled` (bool)
  - `next_nonce` (bigint) — our best known next nonce to use
  - `pending_count` (int) — approximate backlog (derived; can be materialized)
  - `last_error` (text)
  - `last_seen_at` (timestamp)
  - `min_balance_wei` (numeric/bigint) — optional threshold

Add a uniqueness constraint:

- `(address, chain_id)` unique

Create a table to track submissions (for observability + backlog calculation):

- `relayer_txs`
  - `id` (uuid)
  - `relayer_address` (text)
  - `nonce` (bigint)
  - `tx_hash` (text, nullable until broadcast succeeds)
  - `chain_id` (int)
  - `status` (text: `allocated|broadcasted|mined|reverted|dropped|replaced|failed`)
  - `method` (text) — e.g. `metaPlaceLimit`, `sessionPlaceMarket`, `sendDeposit`, `receiveMessage`
  - `orderbook` (text, nullable)
  - `trader` (text, nullable)
  - `deposit_id` (text, nullable) — for deposit pipeline observability
  - `src_chain_id` (int, nullable) — for deposits (spoke chain)
  - `request_id` / `trace_id` (text)
  - `created_at`, `updated_at`

Add a uniqueness constraint:

- `(relayer_address, chain_id, nonce)` unique

This makes accidental nonce duplication visible immediately.

---

## Step-by-step implementation plan

### Step 1 — Key pool configuration (no code yet, just approach)

- Maintain keys as secrets in the deployment environment (Vercel env vars, secret manager, etc.).
- Expose them to the server runtime as an array-like configuration.

Example pattern:

- `RELAYER_PRIVATE_KEYS_JSON='["<key1>","<key2>", "..."]'`
  - or `RELAYER_PRIVATE_KEY_0`, `RELAYER_PRIVATE_KEY_1`, ...

At runtime we should derive addresses and register them in `relayer_keys` on startup (or via an admin script).

Security requirements:

- **Never log** full private keys.
- **Validate** each key produces a valid EOA address.
- **Enforce allowlist**: only these addresses may be used as relayers.

### Step 2 — Distributed lock strategy (required)

We must enforce **exactly-one nonce allocator per relayer address at a time**.

Choose one:

- **Postgres advisory locks** (recommended if we already rely on Postgres): `pg_advisory_lock(hash(relayer_address, chain_id))`
- **Redis lock** (also fine): `SET lock:key NX PX <ttl>`

Postgres advisory locks are simple and avoid running Redis.

Lock rules:

- Lock scope: **per (relayer address, chain id)**
- TTL / safety: if using Redis, include TTL. If using Postgres advisory locks, ensure code always releases on completion and has timeouts.

### Step 3 — Nonce allocator (the critical correctness piece)

Implement `allocateNonce(relayerAddress, chainId)`:

1) Acquire lock for `(relayerAddress, chainId)` (lock scope must include chain).
2) Read `chainPendingNonce = getTransactionCount(relayerAddress, "pending")` **on that chain**.
3) Read `dbNextNonce` from `relayer_keys.next_nonce` for `(relayerAddress, chainId)`.
4) Compute `useNonce = max(chainPendingNonce, dbNextNonce)`.
5) Persist `relayer_keys.next_nonce = useNonce + 1`.
6) Insert `relayer_txs` row with `(relayerAddress, chainId, nonce=useNonce, status="allocated")`.
7) Release lock.
8) Return `useNonce` + the chosen key id.

Important behaviors:

- If the `(relayer_address, chain_id, nonce)` insert fails (unique constraint), resync and retry inside the lock.
- If chain returns higher-than-db nonce, DB catches up automatically via step (4).

### Step 4 — Load-aware router (key selection)

We choose a relayer key **before** allocating a nonce.

Signals:

- `enabled = true`
- `pending_count` (from `relayer_txs` where status in `allocated|broadcasted` and “recent”)
- “health”: last error, balance, last_seen_at freshness

Algorithm (simple and effective):

1) Query enabled keys.
2) Filter out unhealthy keys (low balance, repeated failures, disabled).
3) Pick key with smallest `pending_count`. Tie-break by round-robin or random.

Then call `allocateNonce` for the chosen key.

Notes:

- Make `pending_count` approximate; exact accuracy isn’t required as long as it correlates with backlog.
- Under heavy load, keys with long pending queues should naturally receive fewer new requests.

### Step 5 — Transaction send path

After nonce allocation:

1) Build call data (contract call).
2) Estimate gas (optional but recommended).
3) Choose EIP-1559 fees.
4) Send tx with `{ nonce: allocatedNonce, ...fees, gasLimit }`.
5) Update `relayer_txs` row: set `tx_hash`, status = `broadcasted`.
6) Return `txHash` to caller.

### Step 6 — Error handling + resync rules

Classify errors:

- **Nonce-related** (`nonce too low`, `NONCE_EXPIRED`, `replacement underpriced`):
  - Mark tx row `failed` with reason.
  - Under lock: resync `next_nonce` from chain pending nonce.
  - Retry allocation + send (with a new nonce).

- **Revert / simulation failure**:
  - Do **not** retry blindly. Return error. Mark row `reverted` or `failed`.

- **RPC timeouts / transient**:
  - It may have been broadcast even if we didn’t get a hash back.
  - Strategy: prefer `sendTransaction` return-path; if ambiguous, record “unknown” and let tracker reconcile.

### Step 7 — Receipt tracking (recommended for production)

A background worker (cron or queue consumer) periodically:

- finds `broadcasted` txs without receipts
- checks receipt status
- updates to `mined` / `reverted`
- detects “dropped” (no receipt after long time + nonce now mined by another tx)
- optionally performs speed-ups (replace-by-fee) for stuck txs, under lock

### Step 8 — Operational safeguards

- **Kill switch**: `RELAYER_ENABLED=false` to hard-disable relaying.
- **Per-user and global rate limits**: protect relayer funds and prevent spam.
- **Budget caps**: daily gas budget per user/session.
- **Key health**:
  - auto-disable key if balance low or repeated errors
  - alerting on low balance, high pending queue, high failure rate

---

## Minimal integration points for our current code

We currently send txs directly from API routes using one `RELAYER_PRIVATE_KEY`.

Implementation will refactor those routes to:

1) Select a key from the pool (router)
2) Allocate nonce for that key (allocator + lock)
3) Send tx with explicit nonce (sender)

This applies to:

- **Trading/session (hub chain)**
  - `/api/gasless/trade`
  - `/api/gasless/session/init`
  - `/api/gasless/session/revoke`
  - `/api/gasless/topup`
- **Deposits (spoke + hub)**
  - Spoke publish step: `SpokeBridgeOutboxWormhole.sendDeposit(...)` (spoke chain)
  - Hub delivery step: `HubBridgeInboxWormhole.receiveMessage(...)` (hub chain)
  - Any deposit watchers/webhooks that trigger these (e.g. Alchemy webhook handler)
- **Anything else** that submits on-chain txs from a relayer key (bridge ops, admin wiring scripts, etc.)

---

## Security notes (non-negotiable)

- Do not store private keys in DB.
- Do not print secrets to logs.
- Prefer a single “key loader” abstraction that:
  - validates key format
  - derives address
  - redacts in logs
- If using Supabase/DB locks, ensure the lock acquisition uses the **service role** (server-side only).

---

## Operational rollout (env-only pools)

This section documents the concrete env vars + scripts to stand up **multiple relayers** today (env-only),
and how to operate safely until we move to the DB-backed allocator.

### 1) Configure relayer key pools (env)

We separate pools by responsibility to reduce nonce contention and make ops safer:

- **Single global keyset (no slots)**:
  - Set `RELAYER_PRIVATE_KEYS_JSON='["0x...","0x..."]'`
  - All relayer send paths will pull from this set (trade + deposits), unless a pool-specific env var is set.

- **Hub trading/session/topup** (tx sender for `/api/gasless/*`):\n  - `RELAYER_PRIVATE_KEYS_HUB_TRADE_JSON` *(optional)*\n  - `RELAYER_PRIVATE_KEY_HUB_TRADE_0`, `RELAYER_PRIVATE_KEY_HUB_TRADE_1`, ...\n\n- **Hub inbox delivery** (tx sender for `HubBridgeInboxWormhole.receiveMessage`):\n  - `RELAYER_PRIVATE_KEYS_HUB_INBOX_JSON` *(optional)*\n  - `RELAYER_PRIVATE_KEY_HUB_INBOX_0`, `RELAYER_PRIVATE_KEY_HUB_INBOX_1`, ...\n\n- **Spoke outbox publish (Arbitrum)** (tx sender for `SpokeBridgeOutboxWormhole.sendDeposit`):\n  - `RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_ARBITRUM_JSON` *(optional)*\n  - `RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_ARBITRUM_0`, ...\n\n- **Spoke inbox delivery (Arbitrum)** (tx sender for `SpokeBridgeInboxWormhole.receiveMessage` for withdraws):\n  - `RELAYER_PRIVATE_KEYS_SPOKE_INBOX_ARBITRUM_JSON` *(optional)*\n  - `RELAYER_PRIVATE_KEY_SPOKE_INBOX_ARBITRUM_0`, ...\n\n- **Polygon pools** (if using Polygon spoke):\n  - `RELAYER_PRIVATE_KEYS_SPOKE_OUTBOX_POLYGON_JSON` / `RELAYER_PRIVATE_KEY_SPOKE_OUTBOX_POLYGON_0..N`\n  - `RELAYER_PRIVATE_KEYS_SPOKE_INBOX_POLYGON_JSON` / `RELAYER_PRIVATE_KEY_SPOKE_INBOX_POLYGON_0..N`

Backward compatibility:

- If a pool is unset/empty, the code falls back to `RELAYER_PRIVATE_KEY` for that pool.

### 2) Generate new relayer keys (optional)

- Script: `Dexetrav5/scripts/relayers/generate-relayer-keys.js`
- Outputs JSON or CSV (treat output as secret; do not commit).

Examples:

- Generate 5 keys JSON:\n  `node Dexetrav5/scripts/relayers/generate-relayer-keys.js --count 5 --out relayers.json`
- Generate 5 keys CSV:\n  `node Dexetrav5/scripts/relayers/generate-relayer-keys.js --count 5 --out relayers.csv --format csv`

### 3) Print relayer addresses (no chain calls)

- Script: `Dexetrav5/scripts/relayers/print-relayer-addresses.js`
- Use this to confirm which addresses will be used from env.

### 4) Grant roles to new relayers

Deposit relayers:

- Hub inbox role grants (run on hub network):\n  `npx hardhat run scripts/relayers/grant-deposit-relayers.js --network hyperliquid`
- Spoke outbox role grants (run on spoke network):\n  `npx hardhat run scripts/relayers/grant-deposit-relayers.js --network arbitrum`

Withdraw relayers (optional):

- Spoke inbox delivery role grants:\n  `npx hardhat run scripts/relayers/grant-withdraw-relayers.js --network arbitrum`
- Hub withdraw requester role grants (optional):\n  `npx hardhat run scripts/relayers/grant-withdraw-relayers.js --network hyperliquid`

### 5) Audit on-chain permissions

- Script: `Dexetrav5/scripts/relayers/audit-relayer-permissions.js`

Examples:

- Hub audit:\n  `npx hardhat run scripts/relayers/audit-relayer-permissions.js --network hyperliquid`
- Spoke audit:\n  `npx hardhat run scripts/relayers/audit-relayer-permissions.js --network arbitrum`

### 6) Notes for production safety (env-only)

- **Avoid multiple independent processes sending from the same relayer address**.\n  Env-only pools + in-process mutex protect only within one Node process.\n- **Prefer separate pools per responsibility** (trade vs inbox vs outbox) to reduce collision.\n- If you need high throughput with serverless/multi-instance concurrency, implement the DB allocator described in this runbook.



