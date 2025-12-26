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

## Data model (shared state)

We need a shared store accessible by all runtime instances (serverless included). Postgres works well for this (Supabase Postgres is fine).

Create a table to represent each relayer key/address:

- `relayer_keys`
  - `id` (uuid)
  - `address` (text, unique, lowercase)
  - `enabled` (bool)
  - `next_nonce` (bigint) — our best known next nonce to use
  - `pending_count` (int) — approximate backlog (derived; can be materialized)
  - `last_error` (text)
  - `last_seen_at` (timestamp)
  - `min_balance_wei` (numeric/bigint) — optional threshold

Create a table to track submissions (for observability + backlog calculation):

- `relayer_txs`
  - `id` (uuid)
  - `relayer_address` (text)
  - `nonce` (bigint)
  - `tx_hash` (text, nullable until broadcast succeeds)
  - `chain_id` (int)
  - `status` (text: `allocated|broadcasted|mined|reverted|dropped|replaced|failed`)
  - `method` (text) — e.g. `metaPlaceLimit`, `sessionPlaceMarket`
  - `orderbook` (text, nullable)
  - `trader` (text, nullable)
  - `request_id` / `trace_id` (text)
  - `created_at`, `updated_at`

Add a uniqueness constraint:

- `(relayer_address, nonce)` unique

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

- **Postgres advisory locks** (recommended if we already rely on Postgres): `pg_advisory_lock(hash(relayer_address))`
- **Redis lock** (also fine): `SET lock:key NX PX <ttl>`

Postgres advisory locks are simple and avoid running Redis.

Lock rules:

- Lock scope: **per relayer address**
- TTL / safety: if using Redis, include TTL. If using Postgres advisory locks, ensure code always releases on completion and has timeouts.

### Step 3 — Nonce allocator (the critical correctness piece)

Implement `allocateNonce(relayerAddress)`:

1) Acquire lock for `relayerAddress`.
2) Read `chainPendingNonce = getTransactionCount(relayerAddress, "pending")`.
3) Read `dbNextNonce` from `relayer_keys.next_nonce`.
4) Compute `useNonce = max(chainPendingNonce, dbNextNonce)`.
5) Persist `relayer_keys.next_nonce = useNonce + 1`.
6) Insert `relayer_txs` row with `(relayerAddress, nonce=useNonce, status="allocated")`.
7) Release lock.
8) Return `useNonce` + the chosen key id.

Important behaviors:

- If the `(relayer_address, nonce)` insert fails (unique constraint), resync and retry inside the lock.
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

- `/api/gasless/trade`
- `/api/gasless/session/init`
- `/api/gasless/session/revoke`
- `/api/gasless/topup`
- any other on-chain submissions that use a relayer key (bridge, webhooks, etc.)

---

## Security notes (non-negotiable)

- Do not store private keys in DB.
- Do not print secrets to logs.
- Prefer a single “key loader” abstraction that:
  - validates key format
  - derives address
  - redacts in logs
- If using Supabase/DB locks, ensure the lock acquisition uses the **service role** (server-side only).



