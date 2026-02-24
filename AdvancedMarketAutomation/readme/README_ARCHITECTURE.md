# Interactive Market Stimulator — Architecture & Implementation Reference

> **Purpose of this document:** Provide an AI (or developer) with enough context to fully understand, modify, and extend the `interactive-market-stimulator.ts` system and its supporting library modules. Every architectural decision, data flow, type contract, and edge-case guard is documented here so that new code can be written against this codebase without ambiguity.

---

## 1. System Overview

The Interactive Market Stimulator is a **resumable, gasless liquidity packer** for on-chain order-book markets. It automates the placement of **resting limit orders** on both sides of an order book using a fleet of wallets, communicating through a local Next.js application's API layer rather than submitting raw on-chain transactions. All trades are relayed through a **gasless session** mechanism (EIP-712 signed permits), meaning wallets never need native gas tokens.

### Core Invariants

- **No market orders.** The stimulator only places resting (non-crossing) limit orders.
- **No spread crossing.** Multiple layers of guards ensure a buy order is never placed at or above the best ask (and vice versa).
- **Collateral-capped.** Each wallet's open-order margin is bounded by a configurable fraction of its available vault collateral, preventing wallet drainage.
- **Resumable.** All state is persisted to disk. The process can be killed and restarted, picking up where it left off with the same sessions and role assignments.
- **Idempotent session creation.** Sessions are only re-created when expired or missing.

---

## 2. Directory Structure

```
AdvancedMarketAutomation/
├── interactive-market-stimulator.ts   # Main entry point (this file)
├── wallets.csv                        # Private keys + addresses (git-ignored)
├── state/                             # Persisted run state (git-ignored)
│   └── <chainId>/
│       └── <orderBookAddress>/
│           ├── checkpoint.json        # MarketCheckpoint (run config, wallet map)
│           ├── actions.jsonl          # Append-only action journal
│           └── wallets/
│               └── <address>.json     # Per-wallet session/state
└── lib/
    ├── env.ts                         # Environment variable loader
    ├── wallets.ts                     # CSV wallet parser
    ├── markets.ts                     # /api/markets fetcher + formatter
    ├── strategy.ts                    # Legacy strategy decision engine (DecidedAction)
    ├── stateStore.ts                  # Checkpoint + action log persistence
    ├── gaslessSession.ts              # EIP-712 session permit building + signing
    ├── gaslessTrade.ts                # Gasless trade relay submission
    └── orderbookChain.ts              # Direct on-chain order book reads (ethers.js)
```

---

## 3. Library Modules — Type Contracts & Responsibilities

### 3.1 `lib/env.ts` — `AmaEnv`

Loads configuration from `.env.local` (or `.env`) with fallback manual parsing. Returns:

```typescript
type AmaEnv = {
  appUrl: string;               // Base URL of the Next.js app (default http://localhost:3000)
  rpcUrl: string;               // JSON-RPC endpoint for the target chain
  sessionRegistryAddress: string; // 0x-address of the on-chain SessionRegistry contract
  chainId: number;              // Numeric chain ID
};
```

**Required env vars:** `RPC_URL` (or `RPC_URL_HYPEREVM`), `SESSION_REGISTRY_ADDRESS`, `CHAIN_ID` (or `NEXT_PUBLIC_CHAIN_ID`). `APP_URL` defaults to `http://localhost:3000`.

The loader tries `dotenv.config()` first, then falls back to manual regex extraction from `.env.local` / `.env` files. This dual approach handles cases where `dotenv` isn't available or the file uses non-standard quoting.

### 3.2 `lib/wallets.ts` — `WalletRow`

Parses a CSV file with columns `nickname, address, privateKey`. Supports quoted fields. Validates that addresses are `0x` + 40 hex chars and private keys are `0x` + 64 hex chars.

```typescript
type WalletRow = {
  nickname: string;
  address: string;      // checksummed 0x-address
  privateKey: string;   // 0x-prefixed 32-byte hex
};
```

### 3.3 `lib/stateStore.ts` — Persistence Layer

Central persistence for run state. All files live under `AdvancedMarketAutomation/state/<chainId>/<orderBook>/`.

**Key types:**

```typescript
type MarketRef = {
  symbol: string;
  market_identifier?: string;
  market_address: string;       // OrderBook diamond/proxy address
  market_id_bytes32: string;    // 32-byte market identifier
  chain_id: number;
  tick_size?: number | null;
};

type RunConfig = {
  makerRatio: number;           // Legacy, unused by liquidity packer
  maxOpenOrdersPerMaker: number;// Legacy, unused by liquidity packer
  minDelayMs: number;           // Min sleep between packing cycles
  maxDelayMs: number;           // Max sleep between packing cycles
  sizeMin: number;              // Minimum order size in asset units
  sizeMax: number;              // Maximum order size in asset units
  mode: 'MEAN' | 'UP' | 'DOWN';// Legacy directional bias, always 'MEAN' for packer
};

type WalletCheckpoint = {
  nickname: string;
  role: 'MAKER' | 'TAKER';     // Always 'MAKER' for liquidity packer
  sessionId?: string;
  sessionExpiry?: number;       // Unix seconds
  lastActionAt?: number;        // Unix milliseconds
};

type MarketCheckpoint = {
  version: number;
  chainId: number;
  orderBook: string;
  market: MarketRef;
  run: { runId: string; startedAt: string; updatedAt: string };
  config: RunConfig;
  wallets: Record<string, WalletCheckpoint>; // key = address.toLowerCase()
};

type ActionLogLine = {
  ts: number;                   // Unix ms
  runId: string;
  chainId: number;
  orderBook: string;
  marketIdBytes32: string;
  trader: string;
  nickname?: string;
  role?: 'MAKER' | 'TAKER';
  action: 'SESSION_INIT' | 'PLACE_LIMIT' | 'PLACE_MARKET'
        | 'CANCEL_ORDER' | 'MODIFY_ORDER' | 'SKIP' | 'ERROR';
  params?: any;
  txHash?: string;
  error?: string;
};
```

**`AmaStateStore` class methods:**

| Method | Purpose |
|---|---|
| `loadCheckpoint(chainId, orderBook)` | Read `checkpoint.json`, return `null` if missing |
| `saveCheckpoint(cp)` | Atomic write (tmp + rename) of `checkpoint.json` |
| `loadWallet(chainId, orderBook, trader)` | Read per-wallet JSON |
| `saveWallet(chainId, orderBook, trader, w)` | Atomic write per-wallet JSON |
| `appendAction(line)` | Append one JSONL line to `actions.jsonl` |
| `readActions(chainId, orderBook, maxLines)` | Read last N action lines (tail) |

All writes use atomic tmp-file-then-rename to prevent corruption on crash. File permissions are `0o600`.

### 3.4 `lib/markets.ts` — Market Discovery

Fetches active markets from `GET /api/markets?limit=N&status=ACTIVE`. Returns `MarketRef[]` after validating each row has a valid symbol, 40-char hex address, 64-char hex market ID, and positive chain ID.

`formatMarketLabel(m)` produces a human-readable string like `"ETH (ETH-USD)  orderBook=0x1234…abcd  chain=999"`.

### 3.5 `lib/strategy.ts` — Legacy Decision Engine

Provides `decideNextAction()` which returns a `DecidedAction` union type. **The liquidity packer does NOT use this module** — it has its own inline packing logic. This module exists for backward compatibility and could be used by alternative stimulator modes (taker bots, spread-chasing makers, etc.).

```typescript
type DecidedAction =
  | { kind: 'SKIP'; reason: string }
  | { kind: 'PLACE_LIMIT'; isBuy: boolean; price: number; amount: number }
  | { kind: 'PLACE_MARKET'; isBuy: boolean; amount: number }
  | { kind: 'MODIFY_OLDEST'; price: number; amount: number }
  | { kind: 'CANCEL_ONE'; orderId: bigint };
```

### 3.6 `lib/gaslessSession.ts` — Session Permit System

Implements the full EIP-712 typed-data signing flow for creating gasless trading sessions.

**Flow:**
1. `fetchRelayerSetRoot(appUrl)` — GET the Merkle root of allowed relayers from the API.
2. `fetchSessionNonce(appUrl, trader)` — GET the current nonce for the trader address.
3. `buildSessionPermit({...})` — Construct a `SessionPermit` struct with a random salt, the relayer root, expiry, allowed markets, and a methods bitmap (bits 0-5 = placeLimit, placeMarginLimit, placeMarket, placeMarginMarket, modify, cancel).
4. `signSessionPermit({privateKey, chainId, registryAddress, permit})` — Sign the permit using ethers.js `Wallet.signTypedData` against the `DexetraMeta` EIP-712 domain.
5. `createGaslessSessionViaApi({appUrl, orderBook, permit, signature})` — POST the signed permit to `/api/gasless/session/init`. Returns `{ sessionId, txHash, blockNumber }`.

**EIP-712 Domain:**
```typescript
{ name: 'DexetraMeta', version: '1', chainId, verifyingContract: registryAddress }
```

**SessionPermit struct fields:** `trader`, `relayerSetRoot`, `expiry`, `maxNotionalPerTrade`, `maxNotionalPerSession`, `methodsBitmap`, `sessionSalt`, `allowedMarkets`, `nonce`.

BigInt values are serialized as strings for JSON transport to the API.

### 3.7 `lib/gaslessTrade.ts` — Trade Relay

Submits trades via `POST /api/gasless/trade` with body `{ orderBook, method, sessionId, params }`.

**Available methods:**
```typescript
type SessionTradeMethod =
  | 'sessionPlaceLimit'
  | 'sessionPlaceMarginLimit'     // Used by the liquidity packer
  | 'sessionPlaceMarket'
  | 'sessionPlaceMarginMarket'
  | 'sessionModifyOrder'
  | 'sessionCancelOrder';         // Used for churn/cleanup
```

Returns `{ txHash, blockNumber? }`. The `tradeParams` record is method-specific — for `sessionPlaceMarginLimit` it contains `{ trader, price, amount, isBuy }` where `price` is a string of a 6-decimal fixed-point integer and `amount` is a string of an 18-decimal fixed-point integer.

### 3.8 `lib/orderbookChain.ts` — On-Chain Reader

Direct JSON-RPC reads against the OrderBook contract. Used for:
- `getChainId()` — Verify the RPC matches expected chain.
- `getUserOpenOrders(orderBook, trader)` — Enumerate a wallet's live orders (filters out zero-address/cancelled).
- `bestBidAsk(orderBook)` — Read top-of-book.

**`ObOrder` type:**
```typescript
type ObOrder = {
  orderId: bigint;
  trader: string;
  price: bigint;        // 6-decimal fixed point
  amount: bigint;       // 18-decimal fixed point
  isBuy: boolean;
  timestamp: bigint;
  nextOrderId: bigint;
  marginRequired: bigint;
  isMarginOrder: boolean;
};
```

---

## 4. Main Script Flow (`interactive-market-stimulator.ts`)

### 4.1 Startup Phase

1. **Parse CLI args** — `--csv <path>` (default `AdvancedMarketAutomation/wallets.csv`), `--wallets <n>` (default 10).
2. **Load environment** — `loadAmaEnv()` reads `.env.local`.
3. **Initialize providers** — `OrderbookChainReader` and `ethers.JsonRpcProvider` from `rpcUrl`. Verify chain ID matches env.
4. **Load wallets** — Parse CSV, slice to first N.
5. **Interactive market selection** — `pickMarketInteractively()` presents a paginated, filterable list of active markets fetched from `/api/markets`. User types a search term or selects by index.
6. **Resume or configure** — If a checkpoint exists for the selected market, prompt to resume (reuses config + sessions) or start fresh. Fresh starts prompt for `minDelayMs`, `maxDelayMs`, `sizeMin`, `sizeMax`.
7. **Reconcile action journal** — On resume, replay `actions.jsonl` to rebuild per-wallet `lastActionAt` timestamps.
8. **Build checkpoint** — Seed wallet entries, preserving prior session IDs and expiry where valid.
9. **Session initialization** — For each wallet missing or expiring a session: fetch nonce, build permit, sign with wallet's private key, POST to create session. Sessions last 24 hours and are scoped to the selected market.
10. **Rehydrate open orders** — Read each wallet's open orders from chain to establish ground truth.

### 4.2 Packer Configuration Prompts

After sessions are ready, the user is prompted for four liquidity-packer parameters:

| Parameter | Default | Purpose |
|---|---|---|
| `ordersPerSidePerWallet` | 6 | Target number of resting bids and asks per wallet |
| `maxWalletUtilization` | 0.20 | Fraction (0-1) of available vault collateral allowed for open orders |
| `minDistanceTicks` | 10 | Minimum tick distance from mid-price (anti-crossing buffer) |
| `maxDistanceTicks` | 120 | Maximum tick distance from mid-price (spread of liquidity) |

### 4.3 On-Chain Contract Setup

The script reads from the OrderBook contract:
- `marketStatic()` → `(vault, marketId, useVWAP, vwapWindow)` — identifies the CoreVault and bytes32 market ID.
- `getLeverageInfo()` → `(enabled, maxLev, marginReq, controller)` — extracts `marginReqBps` for margin estimation.

It then constructs a CoreVault contract handle for:
- `getAvailableCollateral(user)` — returns USDC balance (6 decimals).
- `getMarkPrice(marketId)` — fallback mark price (6 decimals).

### 4.4 Core Loop — `ensureWalletPacked()`

The main loop iterates all wallets, calling `ensureWalletPacked()` for each, then sleeps for a random delay between `minDelayMs` and `maxDelayMs`.

**`ensureWalletPacked()` logic:**

1. **Read open orders from chain** via `getUserOpenOrders()`.
2. **Read available collateral** from CoreVault, compute `cap6 = available * maxWalletUtilization`, subtract already-reserved margin to get `remaining6`.
3. **Determine anchor price** — prefer order-book mid (best bid + best ask / 2), fall back to mark price from CoreVault, then `lastTradePrice`.
4. **Cancel excess orders** — If either side exceeds `hardMax = ordersPerSidePerWallet * 2`, cancel oldest orders to bring count down.
5. **Place missing orders** — For each side (buy/sell), if count < `ordersPerSidePerWallet`, call `placeOne()` for each missing level.

**`placeOne()` logic:**
1. Call `pickNonCrossingPrice()` to get a safe price.
2. Compute jittered size using a deterministic cosine hash of `(walletIndex, level)`.
3. Estimate margin required via `estimateMarginRequired6()`.
4. If estimated margin > remaining cap, scale amount down proportionally (with 90% cushion). Reject if still exceeds or amount is dust (<1e13).
5. Submit via `sessionPlaceMarginLimit` through the gasless trade relay.
6. Log action, update wallet state, persist checkpoint.

### 4.5 Price Selection — `pickNonCrossingPrice()`

This is the most critical function for avoiding self-matching and spread crossing.

1. **Deterministic wobble** — Uses `sin(walletSeed * 999 + level * 1337)` to produce a stable 0-1 factor, so the same wallet/level always targets roughly the same distance from mid. This prevents orders from clustering.
2. **Distance calculation** — `distTicks = minDistanceTicks + floor(wobble * span)` where `span = maxDistanceTicks - minDistanceTicks`.
3. **Raw price** — Buy: `mid - distTicks * tickSize`, Sell: `mid + distTicks * tickSize`.
4. **Hard no-cross guards:**
   - Buys are clamped below `bestAsk - bufferTicks * tickSize` and below `bestBid`.
   - Sells are clamped above `bestBid + bufferTicks * tickSize` and above `bestAsk`.
   - `bufferTicks = max(2, floor(minDistanceTicks / 4))`.
5. **Final sanity** — After rounding to tick, reject if buy >= bestAsk or sell <= bestBid.

### 4.6 Kill Switch

- Pressing `q`/`Q` or Ctrl+C sets a `stopping` flag, causing the main loop to exit gracefully.
- `stdin` is set to raw mode for immediate keypress detection.
- On exit, the checkpoint is saved and the readline interface is closed.

---

## 5. API Endpoints Used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/markets?limit=N&status=ACTIVE` | GET | Discover active markets |
| `/api/orderbook/live?symbol=X` | GET | Live best bid/ask, mark price, last trade |
| `/api/gasless/session/relayer-set` | GET | Merkle root for session permit signing |
| `/api/gasless/session/nonce?trader=X` | GET | Current session nonce for a trader |
| `/api/gasless/session/init` | POST | Create a gasless session (signed permit) |
| `/api/gasless/trade` | POST | Submit a gasless trade (limit, market, cancel, modify) |

---

## 6. Numeric Precision Conventions

| Domain | Decimals | Example |
|---|---|---|
| Prices (on-chain) | 6 | `1500.25` → `1500250000n` |
| Amounts (on-chain) | 18 | `0.5` → `500000000000000000n` |
| Collateral (USDC) | 6 | `100.00` → `100000000n` |
| Margin BPS | basis points | `15000` = 150% |

Helper functions: `toPrice6(float) → bigint`, `toAmount18(float) → bigint`.

Margin estimation: `notional6 = amount18 * price6 / 1e18`, then `margin6 = notional6 * marginReqBps / 10000`.

---

## 7. Extension Points & Guidance for New Code

### 7.1 Adding a New Strategy Mode

The `lib/strategy.ts` module already defines a `DecidedAction` union. To add a new mode:
1. Add the mode string to `RunConfig.mode` (e.g. `'SPREAD_CHASE'`).
2. Implement the decision logic in `decideNextAction()` or a new function.
3. In the main loop, branch on `config.mode` to call either the existing `ensureWalletPacked()` or your new strategy function.

### 7.2 Adding Market-Order / Taker Functionality

The gasless trade API already supports `sessionPlaceMarket` and `sessionPlaceMarginMarket`. The `WalletRole` type includes `'TAKER'`. To add taker flow:
1. During config, let the user assign a ratio of wallets as takers.
2. For taker wallets, skip the packing loop and instead call `submitSessionTrade` with a market-order method.
3. The `decideNextAction()` function in `strategy.ts` already handles taker logic.

### 7.3 Multi-Market Support

Currently the script targets one market per run. To go multi-market:
1. Allow selecting multiple markets in `pickMarketInteractively()`.
2. Create separate checkpoints per market (the state store already keys by `chainId + orderBook`).
3. In the main loop, cycle through markets or use `Promise.all` to pack multiple books concurrently.
4. Session permits already support `allowedMarkets: bytes32[]` — pass multiple market IDs.

### 7.4 Dynamic Rebalancing

The current packer uses static parameters. To add dynamic spread adjustment:
1. Read depth data from `live.depth` (returned by `/api/orderbook/live` but currently unused).
2. Adjust `minDistanceTicks` / `maxDistanceTicks` based on depth imbalance.
3. Cancel and replace orders that have drifted too far from the new target spread.

### 7.5 Monitoring & Metrics

The `actions.jsonl` file is a structured event stream. It can be:
- Tailed in real-time for a dashboard.
- Imported into ClickHouse or another analytics store.
- Used to compute fill rates, collateral utilization over time, and order lifetime distributions.

### 7.6 Adding New `ActionLogLine` Actions

The `action` field is a string union. To add a new action type:
1. Add it to the union in `stateStore.ts`: `'SESSION_INIT' | 'PLACE_LIMIT' | ... | 'YOUR_NEW_ACTION'`.
2. Call `stateStore.appendAction()` with the new action type and relevant `params`.

### 7.7 Session Renewal

Sessions expire after 24 hours. Currently, sessions are only checked at startup. For long-running instances, add a periodic check inside the main loop:
```typescript
if (nowSec + 300 > wcp.sessionExpiry) { /* re-create session */ }
```

---

## 8. Dependencies

| Package | Version | Role |
|---|---|---|
| `ethers` | ^6.13 | EIP-712 signing, contract reads, RPC |
| `tsx` | ^4.19 | TypeScript execution (shebang `#!/usr/bin/env tsx`) |
| `dotenv` | ^17.2 | Environment variable loading |

No other runtime dependencies are required by the AMA subsystem.

---

## 9. Security Notes

- `wallets.csv` contains raw private keys — it is git-ignored and must never be committed.
- Per-wallet JSON files in `state/` contain `sessionId` and `sessionExpiry` but **not** private keys.
- All file writes use mode `0o600` (owner read/write only).
- The script validates all addresses and keys against hex regex patterns before use.
- Sessions are scoped to specific markets via `allowedMarkets` in the permit, limiting blast radius if a session is compromised.
