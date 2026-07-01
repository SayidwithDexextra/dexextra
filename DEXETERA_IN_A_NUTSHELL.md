# Dexetera in a Nutshell

**Trade Any Metric — Create, and Trade, Community Made Futures Tokens**

---

## The one-sentence version

**Dexetera is a permissionless DeFi protocol on HyperLiquid that lets anyone turn any measurable metric into an on-chain, orderbook-traded futures market — and lets anyone trade it, with settlement secured trustlessly by UMA's Optimistic Oracle.**

If a metric can be measured, it can be traded. The question is no longer *"who will let me trade this?"* but *"what do I want to trade?"*

---

## The problem we remove

Traditional derivatives are defined by exclusion. Listing a new futures contract needs regulatory approval, exchange partnerships, and capital. Trading is gated by geography, wealth, and institutions. Settlement leans on intermediaries who can be slow, opaque, or compromised.

Dexetera inverts that model: **open creation, open access, and no one who controls the outcome.**

---

## What we actually provide (the service, end to end)

Dexetera is three tightly-linked systems that together take a real-world question from *idea* to *tradable market* to *final, verified payout.*

### 1. Permissionless market creation

Anyone can deploy a new futures market — no listing committee.

- Creation happens through a guided **Market Creation Wizard** (metric → trading config → settlement/oracle config → images → review & deploy), with an **AI assistant** that validates the metric and suggests a fair starting price.
- Each market is deployed as its own on-chain **Diamond (EIP-2535) proxy** with isolated per-market storage, so a problem in one market can never affect another.
- All markets share a single global **`FacetRegistry`**, meaning trading/settlement logic upgrades atomically across every market at once.
- A creator defines: the **metric**, its **canonical data source (URL)**, a **settlement date** (1 day to 1 year out), a **starting price**, and **tags**. A creation fee and a refundable **creator bond** keep spam out; creators can earn a share of trading fees.
- Creation can be **gasless** (creator signs an EIP-712 message, a relayer submits the transaction).

**What can be a market?** Any objectively measurable outcome with a credible public data source at settlement — crypto prices and TVL, commodities, macro data (inflation, GDP), indices, weather, sports stats, social metrics, and more. Markets are **scalar futures** (positions on a continuous number), not just yes/no bets.

### 2. On-chain orderbook trading

Unlike AMM/pool-based platforms, Dexetera runs a **true on-chain orderbook**.

- Traders deposit **USDC** into a shared, non-custodial **`CoreVault`** that holds collateral, positions, and margin.
- They open **long or short** positions using **limit orders** and **market orders** (with slippage protection), matched by an on-chain matching engine with real bid/ask price discovery.
- A **mark price** derived from market activity drives unrealized PnL and liquidation thresholds; keeper-callable **liquidation** protects solvency.
- Every order, fill, and cancellation is recorded on-chain. **Gasless (meta) trading** is supported via signed sessions and relayers.

### 3. Metric tracking + trustless settlement

This is what makes "any metric" real and safe to settle.

- **Metric tracking:** each market carries its own defined data source. An **AI metric worker** reads and analyzes the source URLs (at creation and near settlement) to propose values with confidence and reasoning, and feeds time series for charting.
- **Settlement lifecycle:** markets move through `Unsettled → Rollover → ChallengeWindow → Settled`, automated by scheduled jobs.
  1. At the settlement date, trading pauses and a **challenge window** opens.
  2. **Anyone can propose** the final metric value (with on-chain evidence).
  3. **Anyone can challenge** it by posting a bond.
  4. Disputes **escalate to UMA's Optimistic Oracle / DVM**, where the correct answer is decided by tokenholder vote.
  5. Once resolved, positions close at the **oracle-verified settlement price** (not the mark price), and the vault pays out PnL — with bad-debt haircuts and batch settlement for very large markets.

Settlement is "optimistic": proposals are assumed correct unless economically challenged, so honest settlement happens without constant oracle intervention.

---

## How the pieces fit together

```
        Creator                         Trader
          │                               │
   Market Wizard + AI              Deposit USDC → CoreVault
          │                               │
   FuturesMarketFactoryV2          Limit / Market orders
          │                               │
   Diamond market proxy  ◄── shared ──►  FacetRegistry
   (own orderbook + storage)             (global logic)
          │                               │
   Orderbook matching  ───────────►  Positions & margin (CoreVault)
          │
   Settlement date reached
          │
   Propose value → (Challenge?) → UMA Optimistic Oracle / DVM
          │
   SettlementManager: close positions at verified price → payout
```

---

## Three ways to track a metric

A market is only as good as the number it tracks. Dexetera supports three ways to define what a market measures. The rule of thumb across all of them: the best markets track a number that is **continuously observable** (it ticks on its own, so the price genuinely moves up and down) and settles from a **credible, public, archivable source**.

### 1. Single-metric markets

Track **one measurable number** directly. The simplest and most intuitive format.

- **Best for:** metrics that move continuously on their own (live prices, on-chain data, follower/viewer counts), so there's always a reason for longs and shorts to disagree.
- **Watch out for:** one-off "reveal" metrics (a value that's frozen until a single future event) — they sit flat, then snap to an answer, and trade poorly. Prefer numbers that already exist and change week to week.

**Example markets:**
- Average US regular gas price on a settlement date (source: EIA)
- A protocol's TVL on a date (source: DefiLlama)
- A chain's daily active addresses on a date (on-chain data)
- An artist's Spotify monthly listeners at album drop (source: Spotify)
- An NFT collection's floor price on a date (marketplace API)
- BTC dominance on a date (source: CoinGecko / TradingView)

### 2. Ratio markets (raw)

Track the **relationship between two metrics** (A ÷ B) at its raw, absolute value. Ratios strip out the common market-wide factor and isolate the *relative* bet, which makes them naturally range-bound and always moving — ideal for two-sided liquidity. Keep the ratio **raw** when the absolute level itself carries meaning.

- **Best for:** standardized ratios traders already quote raw, natural thresholds (e.g. **parity at 1.0**), and "crossover / flippening" narratives. Keeping it raw also lets every market on the same pair share one axis and stay comparable to outside venues.
- **Bonus:** raw ratios settle on just A ÷ B at settlement — one fewer trust-critical input than an indexed market (no baseline to lock), so fewer dispute vectors.

**Example markets:**
- **The Flippening** — ETH market cap ÷ BTC market cap (the whole story is the ratio crossing **1.0**)
- ETH ÷ BTC price ratio (a level pros already anchor to)
- Solana total fees ÷ Ethereum total fees
- A company's P/E ratio or debt-to-GDP on a date (natural thresholds)
- A currency pair vs. parity (e.g. EUR/USD around 1.00)

### 3. Indexed markets (base 100)

Rebase a metric **or** a ratio to **100 at launch**, then trade the **% change from launch**. The value always starts at exactly 100; 120 means "up 20% since launch," 80 means "down 20%." This makes an otherwise illegible or awkwardly-scaled number instantly readable and lets very different markets sit on the same axis.

- **Best for:** ratios/metrics whose raw scale is arbitrary or ugly (0.0000123, 47,000, 0.986), when you want a **deterministic start price** (always 100), when small moves need amplifying into tradeable ones, and when comparing *different* metrics side by side.
- **Requirement:** the baseline value at launch must be locked immutably on-chain, because settlement is `100 × (value at settlement ÷ value at launch)`.

**Example markets:**
- China population ÷ India population, indexed to 100 (reads as relative % shift, not a cryptic 0.986)
- Taylor Swift ÷ Drake Spotify monthly listeners, indexed to 100 (a legible rivalry index)
- AI capex ÷ AI revenue for a company, indexed to 100
- A "creator economy" basket vs. launch, indexed to 100
- Any small-magnitude ratio where raw moves (0.050 → 0.052) are clearer as 100 → 104

> **Quick guide:** track a **single metric** when one number tells the story; use a **raw ratio** when the *level* itself matters (thresholds, parity, the flippening); use an **indexed (base 100)** value when only the *change* matters and you want legibility and comparability.

---

## Why it's different

| | CEX Futures | Most Perp DEXs | Prediction Markets | **Dexetera** |
|---|---|---|---|---|
| Who can list a market | Exchange only | Team/governance | Team/governance | **Anyone** |
| What you can trade | Standardized products | Mostly crypto | Curated events | **Any measurable metric** |
| Trading model | Orderbook | AMM / mark-price | AMM / shares | **On-chain orderbook** |
| Custody | Custodial | Non-custodial | Varies | **Non-custodial (USDC in CoreVault)** |
| Settlement | Centralized | Mark price / funding | Centralized/oracle | **Optimistic proposal + UMA DVM** |

---

## Dexetera in a nutshell

> **Dexetera makes any measurable metric a permissionless, trustlessly-settled futures market.** Anyone creates a market on any real-world number, anyone trades it on a real on-chain orderbook with USDC collateral, and settlement is decided by verifiable evidence backed by UMA — with no exchange, no gatekeeper, and no one who controls the outcome.
>
> **What do you want to trade?**

---

*Sources: `WHITEPAPER.md`, the Learn articles in `src/content/learn/`, the pitch deck (`src/app/pitch/deck/`), and the on-chain contracts in `Dexetrav5/src/` (`FuturesMarketFactoryV2`, `FacetRegistry`, `CoreVault`, `SettlementManager`, `MarketLifecycleFacet`, `DisputeRelay`, and the orderbook facets).*
