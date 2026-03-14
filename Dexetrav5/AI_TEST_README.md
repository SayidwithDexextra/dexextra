# AI Order Book Test Runner

A non-interactive CLI that allows an AI model to simulate market conditions, execute hack-mode commands, and receive structured JSON responses — all without any interactive prompts.

## Architecture

```
┌──────────────────┐     commands      ┌────────────────────┐     JSON     ┌───────────┐
│   AI Model       │ ───────────────→  │  ai-test-runner.js │ ──────────→  │  stdout   │
│  (Cursor Agent)  │  --commands/      │  (HeadlessTrader)  │   market     │  (parsed  │
│                  │  --file/          │                    │   state      │   by AI)  │
│                  │  --snapshot       │  Hardhat + Solidity│   snapshot   │           │
└──────────────────┘                   └────────────────────┘              └───────────┘
                                              │
                                        Hardhat Node
                                        (localhost:8545)
```

## Prerequisites

1. **Hardhat node running:**
   ```bash
   cd Dexetrav5
   npx hardhat node
   ```

2. **Contracts deployed to localhost:**
   ```bash
   cd Dexetrav5
   npm run deploy:localhost
   ```

## Usage

### Run inline commands

```bash
cd Dexetrav5
npx hardhat run scripts/ai-test-runner.js --network localhost -- \
  --commands "U1 DEP 5000; U2 DEP 5000; U1 LB 2.5 1 100; U2 LS 2.5 1 100"
```

### Run from a scenario file

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- \
  --file ./scenarios/ai-tests/001-basic-limit-match.txt
```

### Snapshot current state (no commands)

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- --snapshot
```

### Include raw logs

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- \
  --commands "U1 DEP 5000" --verbose
```

## JSON Output Format

Every run outputs a single JSON object to stdout:

```json
{
  "success": true,
  "commandCount": 6,
  "passedCount": 6,
  "failedCount": 0,
  "aborted": false,
  "results": [
    { "cmd": "U1 DEP 5000", "status": "ok", "summary": "DEP $5000" },
    { "cmd": "U1 LB 2.50 1 100", "status": "ok", "summary": "LB 100 @ $2.5 gas=..." }
  ],
  "errors": [],
  "state": {
    "users": [
      {
        "index": 0,
        "label": "Deployer",
        "address": "0x...",
        "walletUSDC": "...",
        "collateral": "...",
        "available": "...",
        "marginUsed": "...",
        "marginReserved": "...",
        "isHealthy": true,
        "positions": [
          { "marketId": "0x...", "side": "LONG", "size": "100.00000000", "entryPrice": "2.500000" }
        ],
        "orders": [],
        "socializedLoss": "0.000000"
      }
    ],
    "orderBook": {
      "bestBid": "0.000000",
      "bestAsk": "0.000000",
      "bids": [],
      "asks": []
    },
    "timestamp": "2026-03-14T..."
  }
}
```

### Key Fields

| Field | Description |
|-------|-------------|
| `success` | `true` if zero errors across all commands |
| `commandCount` | Total commands executed |
| `passedCount` | Commands that completed without error |
| `failedCount` | Commands that threw an error |
| `aborted` | `true` if `STRICT ON` was active and a failure stopped the batch |
| `results[]` | Per-command outcome with `cmd`, `status` ("ok"/"error"), `summary` |
| `errors[]` | Subset of results where `status === "error"` |
| `state` | Full market snapshot taken **after** all commands complete |
| `state.users[]` | Per-user: collateral, positions, open orders, health status |
| `state.orderBook` | Best bid/ask and depth (up to 10 levels) |

### Exit Codes

| Code | Meaning |
|------|---------|
| `0` | All commands succeeded, all assertions passed |
| `1` | One or more commands/assertions failed |

## Hack-Mode Command Reference

### Orders

| Command | Syntax | Description |
|---------|--------|-------------|
| `LB` | `[U#] LB <price> <mode> <value>` | Limit Buy (mode 1=ALU units, 2=USDC notional) |
| `LS` | `[U#] LS <price> <mode> <value>` | Limit Sell |
| `MB` | `[U#] MB <mode> <value> [slipBps]` | Market Buy (default slippage 100bps = 1%) |
| `MS` | `[U#] MS <mode> <value> [slipBps]` | Market Sell |

### Collateral

| Command | Syntax | Description |
|---------|--------|-------------|
| `DEP` | `[U#] DEP <amountUSDC>` | Deposit collateral |
| `WDR` | `[U#] WDR <amountUSDC>` | Withdraw collateral |

### Order Management

| Command | Syntax | Description |
|---------|--------|-------------|
| `CA` | `[U#] CA` | Cancel all orders for user |
| `CO` | `[U#] CO <orderId>` | Cancel specific order by ID |
| `CNO` | `[U#] CNO <index>` | Cancel Nth order (1-based) |

### Margin

| Command | Syntax | Description |
|---------|--------|-------------|
| `TUP` | `[U#] TUP <posIndex> <amountUSDC>` | Top up position margin |
| `RED` | `[U#] RED <posIndex> <amountUSDC>` | Reduce position margin |

### Liquidation

| Command | Syntax | Description |
|---------|--------|-------------|
| `LD` | `LD <targetUserIndex>` | Direct liquidation via CoreVault |
| `LMLD` | `LMLD <targetUserIndex>` | Liquidation via LiquidationManager |
| `POKE_VAULT` | `POKE_VAULT` | Trigger vault liquidation sweep |

### User Context

| Command | Syntax | Description |
|---------|--------|-------------|
| `SU` | `SU <userIndex\|@\|DEPLOYER>` | Switch active user |

### Assertions

| Command | Syntax | Description |
|---------|--------|-------------|
| `ASSERT BID` | `ASSERT BID <op> <price>` | Check best bid (ops: ==, >=, <=, >, <, !=) |
| `ASSERT ASK` | `ASSERT ASK <op> <price>` | Check best ask |
| `ASSERT BID NONE` | `ASSERT BID == NONE` | Check no bids on book |
| `ASSERT ASK NONE` | `ASSERT ASK == NONE` | Check no asks on book |
| `ASSERT BOOK_EMPTY` | `ASSERT BOOK_EMPTY` | Both sides empty |
| `ASSERT POSITION` | `ASSERT POSITION [U#] LONG\|SHORT <op> <units>` | Check position size |
| `ASSERT COLLAT` | `ASSERT COLLAT [U#] <op> <usdc>` | Check total collateral |
| `ASSERT AVAIL` | `ASSERT AVAIL [U#] <op> <usdc>` | Check available margin |

### Control Flow

| Command | Syntax | Description |
|---------|--------|-------------|
| `STRICT ON` | `STRICT ON` | Stop batch on first error |
| `STRICT OFF` | `STRICT OFF` | Continue despite errors (default) |
| `SLEEP` | `SLEEP <ms>` | Pause between commands |

### User Addressing

- `U1` through `U4` — non-deployer users (mapped to Hardhat signers 1–4)
- `@`, `DEP`, `DEPLOYER` — deployer account (signer 0)
- If no prefix: uses the currently selected user (default = deployer)

## Test Catalog

All test files are in `Dexetrav5/scenarios/ai-tests/`.

### Basic Matching (001–006)

| # | File | Description |
|---|------|-------------|
| 001 | `001-basic-limit-match.txt` | Two opposing limit orders at same price → immediate fill |
| 002 | `002-limit-buy-resting.txt` | Limit buy with no opposing sell → rests on book |
| 003 | `003-limit-sell-resting.txt` | Limit sell with no opposing buy → rests on book |
| 004 | `004-market-buy-into-asks.txt` | Market buy sweeps resting asks |
| 005 | `005-market-sell-into-bids.txt` | Market sell sweeps resting bids |
| 006 | `006-partial-fill.txt` | Large buy partially filled by smaller sell |

### Book Structure (007–012)

| # | File | Description |
|---|------|-------------|
| 007 | `007-multiple-price-levels.txt` | Multiple bid levels, verify best-bid tracks highest |
| 008 | `008-cancel-order.txt` | Cancel all orders, verify book empties |
| 009 | `009-deposit-withdraw.txt` | Deposit and withdraw collateral, verify accounting |
| 010 | `010-multi-user-opposing.txt` | 3 users: 1 buyer sweeps 2 sellers |
| 011 | `011-spread-maintenance.txt` | Bid-ask spread maintained when no cross |
| 012 | `012-market-order-no-liquidity.txt` | Market buy on empty book → graceful failure |

### Edge Cases (013–018)

| # | File | Description |
|---|------|-------------|
| 013 | `013-self-trade-prevention.txt` | Same user places both buy and sell |
| 014 | `014-price-improvement.txt` | Buyer crosses above resting ask → gets maker price |
| 015 | `015-cascading-fills.txt` | Buyer sweeps through multiple ask levels |
| 016 | `016-collateral-insufficient.txt` | Order placement with insufficient margin |
| 017 | `017-position-netting.txt` | Open long, close it → position nets to zero |
| 018 | `018-position-reversal.txt` | Long → sell more → flip to short |

### Margin & Collateral (019–024)

| # | File | Description |
|---|------|-------------|
| 019 | `019-margin-topup.txt` | Top up margin on an open position |
| 020 | `020-multi-user-deposits.txt` | 4 users deposit, verify isolation |
| 021 | `021-switch-user-context.txt` | SU command to switch user, then trade |
| 022 | `022-cancel-nth-order.txt` | Cancel specific order by index (CNO) |
| 023 | `023-usdc-notional-mode.txt` | Mode 2 sizing (USDC notional → auto ALU conversion) |
| 024 | `024-bid-ask-update-after-fill.txt` | BBO updates correctly after level exhaustion |

### Liquidation (025–028)

| # | File | Description |
|---|------|-------------|
| 025 | `025-liquidation-direct.txt` | Direct liquidation via LD command |
| 026 | `026-liquidation-manager.txt` | Liquidation via LiquidationManager (LMLD) |
| 027 | `027-multi-user-liquidation.txt` | Multiple users liquidated simultaneously |
| 028 | `028-topup-prevents-liquidation.txt` | Margin top-up saves user from liquidation |

### Order Book Mechanics (029–034)

| # | File | Description |
|---|------|-------------|
| 029 | `029-book-depth-stacking.txt` | Same-price orders from multiple users, FIFO priority |
| 030 | `030-market-buy-slippage.txt` | Market buy with tight slippage cap |
| 031 | `031-short-opens-and-closes.txt` | Open and close a short position |
| 032 | `032-short-in-profit.txt` | Short position realizes profit |
| 033 | `033-long-in-profit.txt` | Long position realizes profit |
| 034 | `034-long-in-loss.txt` | Long position realizes loss |

### Advanced Scenarios (035–048)

| # | File | Description |
|---|------|-------------|
| 035 | `035-deployer-as-counterparty.txt` | Deployer (@) acts as trade counterparty |
| 036 | `036-strict-mode-stops-on-error.txt` | STRICT ON halts batch on first error |
| 037 | `037-market-sell-slippage.txt` | Market sell with tight slippage cap |
| 038 | `038-cancel-and-replace.txt` | Cancel and replace order (modify flow) |
| 039 | `039-large-position-open.txt` | Stress test: very large position |
| 040 | `040-rapid-order-placement.txt` | 10 orders placed rapidly in sequence |
| 041 | `041-snapshot-clean-state.txt` | Empty batch: just capture state |
| 042 | `042-socialized-loss.txt` | Undercollateralized liquidation → socialized loss |
| 043 | `043-withdraw-after-trade.txt` | Withdraw collateral after closing a trade |
| 044 | `044-multiple-markets-setup.txt` | Incremental deposits and withdrawals |
| 045 | `045-poke-vault-sweep.txt` | POKE_VAULT sweep command |
| 046 | `046-orderbook-integrity-after-cancels.txt` | Book integrity after selective cancels |
| 047 | `047-zero-position-after-netting.txt` | Full netting leaves zero position |
| 048 | `048-weighted-average-entry.txt` | Weighted average entry across two fills |

### Liquidation & Fallback (049–060)

| # | File | Description |
|---|------|-------------|
| 049 | `049-empty-book-liquidation.txt` | Liquidation with zero book liquidity → ADL/socialized-loss fallback |
| 050 | `050-partial-liquidation-fill.txt` | Thin book → only 25% of liquidation amount filled |
| 051 | `051-dust-position-precision.txt` | 0.001 ALU position → PositionManager rounding edge case |
| 052 | `052-very-large-position.txt` | 100,000 ALU position → unchecked overflow boundary test |
| 053 | `053-high-price-precision.txt` | Full 6-decimal price precision ($2.123456) |
| 054 | `054-very-low-price.txt` | Trade at $0.01/ALU → low-price arithmetic |
| 055 | `055-very-high-price.txt` | Trade at $1000/ALU → high-price overflow check |
| 056 | `056-fifo-queue-deep.txt` | 10 orders at same level from 4 users → deep FIFO sweep |
| 057 | `057-many-price-levels-gas.txt` | 20 separate price levels → O(n) traversal gas stress |
| 058 | `058-liquidation-cascade.txt` | Cascading liquidations: first triggers second |
| 059 | `059-socialized-loss-all-underwater.txt` | All positions underwater → no profitable users for haircut |
| 060 | `060-socialized-loss-distribution.txt` | Verify haircut applied to profitable counter-party |

### Economic Attacks & Edge Cases (061–072)

| # | File | Description |
|---|------|-------------|
| 061 | `061-sandwich-attack.txt` | Front-run + back-run simulation on a large market order |
| 062 | `062-spoofing-cancel-before-fill.txt` | Large "spoof" order cancelled before anyone fills |
| 063 | `063-withdraw-while-position-open.txt` | Withdraw more than available while margin locked |
| 064 | `064-withdraw-exact-available.txt` | Withdraw at exact available boundary |
| 065 | `065-margin-exhaustion-multiple-orders.txt` | Stack orders until margin runs out |
| 066 | `066-position-accumulation-multiple-fills.txt` | 5 fills at increasing prices → weighted average entry |
| 067 | `067-partial-close-repeated.txt` | Close 100-unit position in 5 batches of 20 |
| 068 | `068-short-margin-requirement-150pct.txt` | 150% short margin requirement enforced vs 100% for longs |
| 069 | `069-rapid-open-close-cycle.txt` | Open/close 5× rapidly → no state corruption |
| 070 | `070-cross-spread-aggressive.txt` | Buy at $10 vs ask at $1 → fills at maker price |
| 071 | `071-double-deposit.txt` | Two rapid deposits → cumulative correctness |
| 072 | `072-withdraw-to-zero.txt` | Full withdrawal → collateral exactly zero |

### Liquidation Deep-Dive (073–084)

| # | File | Description |
|---|------|-------------|
| 073 | `073-liquidation-penalty-10pct.txt` | Verify 10% liquidation penalty deduction |
| 074 | `074-topup-then-trade-more.txt` | Top up + increase position size |
| 075 | `075-four-users-circular-trade.txt` | U1→U2→U3→U4→U1 circular trade |
| 076 | `076-market-order-max-slippage.txt` | Market order with max 5000bps (50%) slippage |
| 077 | `077-slippage-exceeds-cap.txt` | Slippage > 5000bps should be rejected |
| 078 | `078-position-size-after-liquidation.txt` | Position zeroed after successful liquidation |
| 079 | `079-collateral-after-losing-trade.txt` | Collateral decreases by realized loss |
| 080 | `080-collateral-after-winning-trade.txt` | Collateral increases by realized profit |
| 081 | `081-zero-collateral-order.txt` | Order with zero deposit → rejection |
| 082 | `082-short-liquidation-price-up.txt` | Short liquidated when price rises sharply |
| 083 | `083-long-liquidation-price-down.txt` | Long liquidated when price drops sharply |
| 084 | `084-deposit-trade-withdraw-cycle.txt` | Full lifecycle: deposit → trade → close → withdraw |

### Production Stress Tests (085–100)

| # | File | Description |
|---|------|-------------|
| 085 | `085-cross-margin-position-and-orders.txt` | Position + resting orders share margin |
| 086 | `086-cancel-during-partial-fill.txt` | Partial fill then cancel remainder |
| 087 | `087-multiple-liquidations-poke-vault.txt` | POKE_VAULT sweeps multiple underwater users |
| 088 | `088-order-at-boundary-price.txt` | Minimum price $0.000001 (1 wei in 6 decimals) |
| 089 | `089-pnl-zero-sum-check.txt` | Verify PnL is zero-sum across counterparties |
| 090 | `090-three-level-ask-sweep.txt` | Different maker at each level, buyer sweeps all |
| 091 | `091-health-status-transition.txt` | Healthy → unhealthy → healthy via top-up |
| 092 | `092-bid-ask-equal-no-cross.txt` | Self-cross netting (same user both sides) |
| 093 | `093-liquidation-short-all-margin-consumed.txt` | Short loss exceeds entire margin → bad debt |
| 094 | `094-order-replacement-same-level.txt` | Cancel + re-place at same price level |
| 095 | `095-opposing-market-orders.txt` | Two market orders with no resting liquidity |
| 096 | `096-many-small-fills-gas.txt` | 4 makers × 1 unit, single taker sweep → gas bench |
| 097 | `097-position-flip-in-single-tx.txt` | Long 50 → sell 150 → short 100 in one order |
| 098 | `098-haircut-survives-close.txt` | Socialized loss haircut deducted on position close |
| 099 | `099-max-users-trading.txt` | All 5 users active simultaneously |
| 100 | `100-stress-100-operations.txt` | 100 sequential operations → system stability |

## How the AI Should Use This

### Running a Single Test

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- \
  --file ./scenarios/ai-tests/001-basic-limit-match.txt
```

Parse the JSON output. If `success === true`, the test passed. Otherwise, check `errors[]` for details.

### Running Ad-Hoc Commands

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- \
  --commands "U1 DEP 5000; U2 DEP 5000; U1 LB 2.50 1 100; U2 MS 1 100; ASSERT POSITION U1 LONG == 100"
```

### Inspecting State

```bash
npx hardhat run scripts/ai-test-runner.js --network localhost -- --snapshot
```

Returns the full market state without executing any commands.

### Interpreting Results

1. **Check `success`** — `true` = all assertions passed
2. **Check `state.users[].positions`** — verify positions are as expected
3. **Check `state.users[].collateral`** — verify collateral accounting
4. **Check `state.orderBook.bestBid` / `bestAsk`** — verify book state
5. **Check `state.users[].isHealthy`** — verify margin health
6. **Check `errors[]`** — for debugging failures

### Writing New Tests

Create a `.txt` file in `scenarios/ai-tests/` with hack-mode commands, one per line. Lines starting with `#` are comments. Use `STRICT ON` at the top to stop on first failure. Use `ASSERT` commands to verify expected outcomes. Use `SLEEP <ms>` between commands if state propagation is needed.

## npm Scripts

```bash
# From the Dexetrav5 directory:
npm run ai:test -- --file ./scenarios/ai-tests/001-basic-limit-match.txt
npm run ai:test -- --commands "U1 DEP 5000"
npm run ai:test -- --snapshot
```
