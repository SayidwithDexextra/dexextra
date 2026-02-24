# Interactive Market Stimulator — Quick Usage Guide

A hands-on reference for running the gasless liquidity packer.

---

## Prerequisites

1. **Node.js 18+** and **npm** installed.
2. The local Next.js app running (default `http://localhost:3000`).
3. A `.env.local` file at the project root with:
   - `RPC_URL` (or `RPC_URL_HYPEREVM`) — your chain's JSON-RPC endpoint
   - `SESSION_REGISTRY_ADDRESS` — the on-chain session registry contract address
   - `CHAIN_ID` (or `NEXT_PUBLIC_CHAIN_ID`) — numeric chain ID
   - `APP_URL` — optional, defaults to `http://localhost:3000`
4. A wallet CSV at `AdvancedMarketAutomation/wallets.csv` with columns: `nickname, address, privateKey`.

---

## Starting the Script

```bash
npm run ama:liquidity
```

Or directly:

```bash
tsx AdvancedMarketAutomation/interactive-market-stimulator.ts
```

**Optional flags:**

| Flag | Default | What it does |
|---|---|---|
| `--csv <path>` | `AdvancedMarketAutomation/wallets.csv` | Path to your wallet CSV |
| `--wallets <n>` | `10` | Number of wallets to use (first N from CSV) |
| `--help` | — | Print usage and exit |

---

## Interactive Prompts (in order)

### 1. Select a Market

The script fetches all active markets and displays the top 25:

```
Active markets (top 25):
  [0] ETH (ETH-USD)  orderBook=0x1234…abcd  chain=999
  [1] BTC (BTC-USD)  orderBook=0x5678…efgh  chain=999
  ...

Type search text to filter, or enter index to select:
```

- **Type a number** (e.g. `0`) to select that market.
- **Type text** (e.g. `eth`) to filter the list, then select from filtered results.
- Empty input re-displays the list.

### 2. Resume or Fresh Start

If prior state exists for this market:

```
Resume existing state for this market? [Y/n]:
```

- **Enter / Y** — Reuse prior sessions and config. Picks up where you left off.
- **n** — Start fresh with new config (sessions are still reused if valid).

### 3. Configure Run Parameters (fresh start only)

```
Min delay ms [250]:
Max delay ms [1200]:
Order size min (units) [0.05]:
Order size max (units) [0.25]:
```

Press Enter to accept the default shown in brackets.

### 4. Packer-Specific Parameters

```
Orders per side per wallet [6]:
Max wallet collateral usage fraction 0..1 [0.20]:
Min distance from mid in ticks (avoid crossing) [10]:
Max distance from mid in ticks [120]:
```

| Parameter | What it means |
|---|---|
| **Orders per side** | How many resting bids AND asks each wallet maintains |
| **Collateral usage** | Max fraction of each wallet's vault balance to tie up in margin (0.20 = 20%) |
| **Min distance** | Closest an order will sit to mid-price, in tick increments. Higher = safer from fills |
| **Max distance** | Farthest an order will sit from mid-price. Wider = deeper book |

---

## While Running

Once prompts are complete, the script enters its main loop:

```
Sessions ready. Starting stimulator loop. Press q to stop.

[User1] buys=6 sells=6 avail=1200.50 cap=240.10 reserved=180.30
[User2] buys=5 sells=6 avail=980.00 cap=196.00 reserved=150.00
...
```

Each line shows per-wallet status:
- **buys / sells** — Current open order count per side.
- **avail** — Wallet's available vault collateral (USDC).
- **cap** — Max collateral the packer will use (avail * utilization fraction).
- **reserved** — Collateral already locked in open margin orders.

The loop will continuously top up each wallet to the target order count, cancel excess orders, and respect the collateral cap.

---

## Stopping

- Press **q** or **Q** at any time.
- Or press **Ctrl+C**.

The script saves its checkpoint and exits cleanly:

```
Stopped. State checkpoint saved.
```

You can resume later by re-running the same command and answering **Y** at the resume prompt.

---

## State Files

All state is saved under `AdvancedMarketAutomation/state/<chainId>/<orderBookAddress>/`:

| File | Contents |
|---|---|
| `checkpoint.json` | Run ID, config, per-wallet session info |
| `actions.jsonl` | Timestamped log of every action (place, cancel, error) |
| `wallets/<addr>.json` | Individual wallet session and timing data |

These files allow full resume and provide an audit trail. Delete the market's state folder to force a completely fresh start.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `Missing RPC_URL` | Set `RPC_URL` or `RPC_URL_HYPEREVM` in `.env.local` |
| `Missing SESSION_REGISTRY_ADDRESS` | Add the 0x-address to `.env.local` |
| `No active markets` | Ensure the Next.js app is running and has markets seeded |
| `wallets.csv not found` | Generate with `npm run wallets:gen` or pass `--csv <path>` |
| `Session init failed` | Check the Next.js app logs; the relayer may be down |
| Orders not appearing | The collateral cap may be hit; increase `--wallets` count or raise utilization fraction |
