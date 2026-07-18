# Dexetera B2B Hedging Playbook

> A reference doc for the "businesses hedge real-world risk on custom markets"
> angle of Dexetera. Captures the core thesis, worked examples at every scale,
> why hedging is worth doing, the breakout market categories (culture + AI),
> the strongest market structure of all — **two-directional (mirror) hedging** —
> and **ratio markets**, which let a business hedge its *margin* (the gap between
> two prices) instead of a single price.

---

## 1. The core thesis

Traditional futures only exist for big, standardized, exchange-listed things:
oil, wheat, the S&P, currencies, interest rates. If your business risk is
**niche or idiosyncratic** (a weird input cost, a platform-specific metric, a
regional index), there is no CME contract for it, and a bank will only write you
a custom OTC swap slowly, expensively, and in giant size.

**Dexetera collapses that gap.** On Dexetera a market is not tied to a listed
commodity or a Pyth/Chainlink feed — it is defined by four things:

- a **metric URL** (the public source of truth)
- a **start price**
- a **settlement date** (≤ 365 days out)
- a **data source** descriptor

That means the "underlying" can be **anything you can point a public URL at.**
Any business can spin up a market around the exact number that keeps them up at
night — and hedge it.

### How a market actually gets created (grounded in the code)

- On-chain factory: `Dexetrav5/src/FuturesMarketFactory.sol`
  (`createFuturesMarketV2` / `metaCreateFuturesMarketV2` are the preferred V2
  paths; markets deploy as `DiamondRegistry` order books).
- Client flow: `src/lib/createMarketOnChain.ts` → `POST /api/markets/create`.
- UI: `src/app/create-market/` (wizard + AI assistant that scrapes/validates the
  metric URL and suggests a start price via `metric-ai-worker`).
- Costs: default **100 USDC creation fee** + a refundable **bond**
  (`MarketBondManagerV2`). Creation is **permissionless when enabled**
  (`publicMarketCreation = true`).
- **The creator is set as fee recipient** and earns a cut of trading fees
  (default split ≈ **80% protocol / 20% creator**), tracked in the
  `trading_fees` table via the Alchemy webhook.

### The three price layers (important nuance)

1. **Start price** — creator supplies it at creation (6 decimals, USDC-style).
2. **Live trading price** — emerges from the **on-chain order book**
   (`OBPricingFacet`), *not* an external feed.
3. **Settlement price** — resolved by reading the **metric URL** (AI worker
   proposes) with an on-chain **challenge window** and escalation to **UMA**
   for disputes. A market's hedge is only as trustworthy as its metric is
   objective and durable.

> Note: the "liquidity overlay" (`src/lib/overlay/`) is currently a **visual-only**
> synthetic layer to keep new markets from looking dead. It does **not** fill real
> trades yet (though the data model is designed to become consumable later).

---

## 2. What hedging is (in plain English)

Hedging is just **making a side bet that pays off when your main thing goes bad**,
so you're okay either way — like travel insurance so you don't care as much if
your flight gets cancelled.

Businesses do this because a lot of what makes or breaks them is **out of their
control**. Hedging buys **certainty and survival.**

---

## 3. Worked examples — same idea at every scale

### 3a. Layman scale: the taco truck outside a stadium

You run a taco truck that parks outside a football stadium. Your income depends
entirely on **how many people show up to the games** — which you can't control.

- Packed stadium → you sell out.
- Half-empty stadium (bad team, rain) → you already paid for food/gas/staff and
  eat the loss.

No bank sells "stadium attendance insurance." On Dexetera:

1. The stadium/league publishes attendance → that page becomes the **metric URL**.
2. You create a market tracking attendance.
3. You **bet on LOW attendance.**

Outcome:
- Games packed → you lose the side bet, but the truck made a fortune. ✅
- Games dead → truck had a rough month, but the side bet **pays out** and covers it. ✅

Either way your income is smoothed. **Bonus:** you created the market, so you earn
a slice of fees from every fan/vendor/gambler who trades it.

### 3b. Enterprise scale: the $40B beverage company

A giant drinks company's nightmare is **the weather** — a cold, rainy summer wipes
out hundreds of millions in cold-drink sales. Banks won't cleanly hedge "average
summer temperature across my 12 biggest markets" (weather swaps are thin, OTC,
expensive, giant-size only).

On Dexetera:

1. Use official public weather data as the **metric URL**.
2. Create a market for "average summer temperature in key regions," settling at
   season's end.
3. **Bet on a cold summer.**

Outcome: scorcher → lose the bet but sell a mountain of drinks; washout → sales
tank but the bet cushions the blow. **Earnings stay smooth**, which is exactly
what public markets reward.

**What changes at enterprise scale:**
- They hedge a **whole portfolio** of "un-hedgeable" risks, not just one.
- They can **bring their own liquidity** (balance sheet → real market depth).
- They **earn fees on their own risk** (offsetting or even funding the hedge).
- Big, widely-relevant metrics attract **deep two-sided flow**.

**Enterprise caveats (bigger at this scale):**
- **Capacity** — Dexetera is currently tuned for a closed beta (~100 testers,
  ~100 USDC deposits); needs orders-of-magnitude more liquidity/limits.
- **Settlement trust** — a big hedge needs the final number to be correct and
  un-manipulable; lawyers will stress-test the dispute/UMA process.
- **Compliance & custody** — a public company using an unregulated,
  crypto-collateralized venue (Hyperliquid, USDC bridged from Arbitrum) needs a
  compliant institutional wrapper. This is the biggest "demo → real" gap.
- **Basis risk** — the public metric won't perfectly match actual P&L.

---

## 4. "Wouldn't hedging just be flat — no loss, no gain? Why bother?"

On paper hedging looks like it cancels out. It's still worth it because **the two
outcomes aren't worth the same to a business:**

1. **Losing hurts more than winning helps.** A coin flip of +$100M / −$100M isn't
   neutral — the downside can be **fatal** (layoffs, missed debt, dead company),
   the upside is just nice. Hedging chops off the tail that can kill you.
2. **Certainty itself is worth money.** Predictable cash flow → easier planning,
   cheaper borrowing, and a **higher valuation** (markets pay a premium for
   "boring and reliable"). You're trading a lottery ticket for a paycheck.
3. **You only cancel the part you can't control.** You keep 100% of the gains
   from your actual skill (making/selling your product) and delete only the
   random **luck** (weather, input prices) you have no edge on.
4. **It's insurance, not an investment.** Nobody regrets home insurance because
   the house didn't burn down. The peace of mind *is* the product.

**Dexetera kicker:** because the business **created** the market, it earns a cut
of trading fees — so it can **partially or fully offset the cost of its own
hedge**, flipping the usual "pay a premium" math.

**One-liner:** businesses don't hedge to make more on average — they hedge
because a smooth, survivable, predictable outcome is worth far more than a wild
gamble with the same average. And on Dexetera, you might get *paid* to buy it.

---

## 5. The breakout categories (the "next-breaking" wedge)

Sports and politics broke Polymarket/Kalshi because they had: (1) a massive
already-invested audience, (2) a constant recurring event stream, (3) clean
public outcomes, (4) everyone thinks they have an edge.

**Dexetera's edge over pure prediction markets:** it can attract **both the
gambler AND a real business that needs to hedge the same number.** So the best
wedges add a fifth ingredient: **a real business with money on the line.**

### 5a. Culture / entertainment economy

Headline market: **"How big will [the new movie / show / album] open?"**
Metric = published, objective numbers (Box Office Mojo grosses, Billboard/Spotify
charts, Netflix Top 10, Steam concurrent players).

- **Speculators:** film-Twitter, Letterboxd, music stans, K-pop/Swiftie fandoms,
  gamers — rabid, tribal, built-in audiences.
- **Hedgers:** movie theater chains, studios, concession/merch/toy licensees,
  marketing tie-in partners, labels, tour promoters, streamers, game studios.

Recurring events every week = a "season" that never ends. **Avoid fuzzy metrics**
(critic scores, "cultural impact"); favor hard published numbers.

### 5b. AI (likely *the* defining wedge of this cycle)

Two prongs that feed each other:

**Prong 1 — the hedging killer app: compute / GPU pricing.** Every AI company's
biggest cost is GPU hours, and rates swing wildly. There is no traditional way to
hedge it. Metric = a public GPU rental-rate index. Hedgers = AI startups,
inference providers, resellers, miners. Speculators = the whole tech/VC/AI-Twitter
crowd.

**Prong 2 — the attention magnet: model capability races.** Model launches are
the new sports (livestreamed reveals, benchmark wars, tribal OpenAI-vs-Anthropic-
vs-Google-vs-xAI fandoms). Market = "Will [model] top [leaderboard] by [date]?"
Metric = crowd-voted Elo (LMArena), usage-share dashboards, app-store ranks.
Hedgers = companies with vendor lock-in risk, labs' competitors.

**AI settlement warning:** AI is uniquely prone to settlement fights. Favor hard,
external, published numbers (GPU rates, token/API prices, usage-share, app ranks,
crowd-voted Elo, officially-reported user counts). **Avoid** single self-reported
benchmark scores a lab can game or dispute on methodology.

---

## 6. ⭐ The strongest structure: two-directional (mirror) hedging

The **holy grail** market is one where two *different businesses* have
**mirror-image exposures** and naturally take **opposite sides** — because then
*both* counterparties genuinely need the market. It becomes deep and
self-sustaining **without relying on speculators or the overlay.**

Most markets = hedgers on one side, gamblers on the other.
Mirror markets = **hedgers on BOTH sides.**

### The canonical AI example: GPU buyers vs. GPU sellers

| | Who | Hurt when… | So they… |
|---|---|---|---|
| **Buyers** | AI startups, inference cos, labs — COGS *is* compute | prices **rise** | go **long** |
| **Sellers** | Data centers, GPU clouds, miners renting fleets | prices **fall** (revenue) | go **short** |

Same public number (GPU $/hr), opposite directions, both real businesses. They
clear against each other.

**Worked numbers** — GPUs at **$2.50/hr**; two firms each touch 10,000 GPU-hrs/mo:

- **InferCo** (buys compute) goes **long**; **RigCloud** (sells compute) goes **short**.
- **Spike to $3.50:** InferCo bill +$10k but long pays ~$10k → flat. RigCloud
  revenue +$10k but short loses ~$10k → flat (locked-in predictable revenue).
- **Crash to $1.50:** InferCo saves $10k but loses on long → flat. RigCloud
  revenue −$10k but short pays ~$10k → flat.

Both guarantee a predictable quarter, in opposite directions, trading against
each other. Neither is gambling. The creator earns fees on every trade.

### Why mirror markets are the dream for Dexetera

- **Self-sustaining liquidity** — the buyer's hedge *is* the seller's hedge, flipped.
- **Sticky, recurring flow** — businesses re-hedge every quarter; speculators get bored.
- **Speculators become a bonus, not a requirement.**
- **Legitimacy** — "two real AI companies hedging opposite sides of compute risk"
  is a far stronger pitch than "people betting on stuff."

---

## 7. Ratio markets: hedging your *margin*, not a single price

The mirror markets in §6 hedge **one absolute price** (GPU $/hr). But a business
usually doesn't live or die on one price — it lives on the **gap between two
prices**: what it *charges* vs. what it *pays*. That gap is its **margin**, and a
**ratio market** lets you trade (and therefore insure) it directly.

### The instinct (taco truck)

You buy beef and sell tacos: beef costs **$4**, the taco sells for **$10**. What
actually kills you isn't beef getting expensive — it's beef rising **while you
can't raise taco prices** (a competitor on every corner). That's a **margin
squeeze**: the *gap* closes even though nothing "broke."

- **Simple market** = bet on one number ("will beef get pricier?").
- **Ratio market** = bet on the **gap** ("will my selling price keep up with my
  costs?"). The gap *is* your paycheck, so that's the thing worth insuring.

### The number the market trades: a ratio

Take what a company **sells for** and divide by what its **input costs**:

> **Ratio = selling price ÷ input cost**

For an AI app: **$10 per Mtoken sold ÷ $4 per Mtoken of compute = 2.5.** Read it
as *"for every $1 of compute I burn, I sell $2.50 of AI."* **That 2.5 is the price
of the market** — trading here means betting on that ratio moving, not on either
price alone.

- Ratio **rises** (2.5 → 3.0+) → selling price pulling ahead of cost → **fatter margins**.
- Ratio **falls** (2.5 → 1.5) → cost catching up to price → **margins crushed**.

### Step 1 — a Dexetera user creates the market

An AI founder (call her the creator) opens Dexetera, creates a market whose price
is that ratio, points it at **two public prices** (going rate for AI output; going
rate for compute), sets a settlement date at quarter's end, and posts the small
creation fee + bond. It's live, and she now **earns a cut of every trade** on it.

Picture the ratio as a **tug-of-war rope**: one kind of company pulls it up, the
opposite kind pulls it down. Each wants protection if the rope moves against them.

### Company A — the AI app (lives on a *high* ratio)

- **Real business:** pays for compute, sells AI output; thrives when the ratio is
  **high** (fat slice between pay and charge).
- **Nightmare:** the ratio **falling** — compute rises to $6 while a rival forces
  selling price to $8, so the ratio collapses to **8 ÷ 6 ≈ 1.3** and profit
  evaporates.
- **Hedge:** take the **"ratio goes down"** side — it pays exactly when the
  business is being squeezed.
- **Outcomes:** ratio falls to ~1.3 → real profit shrinks but the bet **pays out**
  and refills the gap. Ratio holds/climbs → the bet loses a little, but the real
  business is fat and covers it. → She bought a **floor under her ratio.**

### Company B — the compute seller (lives on a *low* ratio)

- **Real business:** rents out GPUs; revenue *is* the input price (the bottom of
  the fraction). Thrives when compute is **expensive** — i.e. when the ratio is
  **low**.
- **Nightmare:** the ratio **rising** — a chip glut makes compute dirt cheap ($2)
  while AI still sells for $10, so the ratio jumps to **10 ÷ 2 = 5.0** and rental
  income collapses.
- **Hedge:** take the **"ratio goes up"** side — the exact opposite of Company A.
- **Outcomes:** ratio jumps to ~5.0 → real revenue craters but the bet **pays
  out** and cushions it. Ratio stays low → the bet loses a bit, but compute is
  pricey so the real business is booming. → They bought a **ceiling on the ratio.**

### Why they fit together perfectly

The ratio can only rise or fall, and **the two companies fear opposite
directions.** So when Company A needs someone to take the other side of its
"ratio falls" bet, Company B is already standing there wanting exactly that side —
for its own opposite reason. They become each other's counterparty naturally: no
gambler required, no synthetic liquidity required. Whoever's real business is
bleeding that quarter gets paid by the hedge; whoever's winning shrugs off the
small losing bet. And the **creator earns fees on every tug of the rope.**

| | Real business thrives when… | Fears the ratio… | Takes the side… | Buys… |
|---|---|---|---|---|
| **AI app** (buys input, sells output) | ratio is **high** | **falling** | ratio **down** | a **floor** under margin |
| **Compute seller** (sells the input) | ratio is **low** | **rising** | ratio **up** | a **ceiling** on margin |

### When to use a ratio market (and when not to)

- ✅ Use it when the exposure is genuinely **relative** — a margin, spread, or
  basis (selling price vs. input cost; supplier A vs. supplier B; one input vs.
  another). One position hedges the margin directly.
- ❌ Don't force it when the exposure is truly **absolute** (just capping a dollar
  cost) — a single-metric market (§6) is the right tool.
- ⚠️ **Two legs = two public metrics**, so it doubles the settlement/dispute
  surface. Only worth it when the margin framing justifies it.
- ⚠️ **Basis risk:** the ratio is an **industry-wide proxy**, not a photograph of
  either company's exact books — it cushions the blow rather than matching it to
  the penny. (True of every real hedge.)

> Implementation note: ratio/indexed market math lives in
> `src/lib/ipfs/computeDerived.ts` (`deriveRatio`, `deriveIndexed`). There is a
> known **payoff-symmetry** consideration for mirror hedgers on a raw ratio — a
> deliberate design topic parked for later, intentionally left out of this section.

---

## 8. Worked case study: Blackdove — choosing the *right* metric

[Blackdove](https://blackdove.com/) is a digital-art streaming platform + hardware
company: it sells premium wall-mounted "digital canvases" (color-calibrated 4K/8K
displays) and streams curated moving artworks to them via subscription, plus runs
a high-ticket digital-art marketplace. Revenue facets: **hardware** (canvases),
**frames/install** (attach-on), **subscriptions** (the ~80–90% margin engine), an
**art marketplace** (commission on $5k–$75k editions), and **commercial LED walls**.

This case exists to teach the single most important lesson in the whole playbook:

> **A market is only as good as its metric. Pick a metric that is (a) genuinely
> volatile, (b) uncertain, and (c) published at a durable public URL. The
> highest-margin facet is often the WORST hedging candidate, precisely because
> it's high-margin *by being stable*.**

### The metric-selection journey (what to copy)

1. **Start at the highest margin → subscriptions.** Tempting, but wrong. That
   margin is fat *because* it's stable. Its main cost (bandwidth/CDN) drifts
   **down** ~10–20%/yr and never spikes — **nothing to hedge, nothing to trade.**
   A market on it would be dead on arrival.
2. **Reject low-volatility metrics.** Bandwidth failed the volatility test. If the
   number doesn't move, skip it no matter how big the margin.
3. **Move to a volatile facet → hardware.** Lower margin, but genuinely exposed:
   the **display panel** is the biggest cost in every canvas, and panel prices are
   famously cyclical.

### The market: single-metric on panel prices

**Facet protected:** hardware margin.
**Why it moves — the "crystal cycle":** large-panel prices swing with fab supply
vs. demand — gluts crash them, shortages spike them. Real history: large-panel
prices ~doubled in 2020–2021, then fell ~40–50% in 2022. **30–50% swings per cycle
are normal.**

**Instrument:** a **single-metric** market whose price *is* a published panel-price
benchmark (e.g. the 65″ open-cell LCD panel price), settling quarterly. Single
metric because Blackdove's retail canvas prices are sticky — so hedging the one
moving leg (panel cost) fully protects the margin (see §7 "count the moving legs").

**Direction:** Blackdove is a panel **buyer** → hurt when panel prices **rise** →
takes the side that **pays when the benchmark rises**.

**Worked numbers (illustrative — plug in real BOM):** a 65″ canvas retails at
$4,999; the panel costs ~$250 today.
- **Shortage, panel +60% → ~$400:** +$150 cost per 65″ unit (bigger on 85″/98″),
  squeezing a hardware quarter — but the hedge **pays out** and refills margin. 😌
- **Glut, panels flat/down:** the hedge loses a little; fat hardware margin covers
  it. ✅

**Counterparties (why it clears):** panel makers (Samsung Display, LG, BOE, AUO)
are hurt when prices **fall** → natural mirror hedgers; other panel buyers (TV
brands, signage firms) share the exposure; display-supply-chain watchers speculate.

**The settlement-source caveat (the real work item):** unlike box-office numbers,
panel prices mostly live in **paid** reports (DSCC, Omdia, TrendForce), not a free
URL. Dexetera settles off a **durable, citable, public** metric — so anchor the
market to a qualifying source (e.g. TrendForce's free monthly panel-price releases)
and write the settlement rule around that exact source. Plus normal basis risk (the
benchmark panel won't perfectly match his spec/size mix → cushions, doesn't match
to the penny).

**Pitch in two sentences:**
> "The display panel is the biggest cost in every canvas you sell, and panel prices
> swing 30–50% with the supply cycle — one shortage can gut a hardware quarter.
> Dexetera lets you lock in your panel cost by getting paid when panel prices spike,
> so your hardware margin stays predictable — and since you own the market, you earn
> fees on it too."

---

## 9. The general pattern (rule of thumb)

> **Wherever one business's cost is another business's revenue, you have a natural
> two-sided hedging market — and that's the strongest kind of market you can list.**

Hunt for "buyer class vs. seller class of the same input":

- **LLM token / API pricing** — SaaS apps built on an LLM (long) vs. model
  providers/resellers (short).
- **Data-center electricity** — AI data-center operators (long) vs. power
  producers selling into that demand (short).
- **Cloud storage / bandwidth**, **freight on a specific lane**, any commoditized
  input with a distinct buyer class and seller class.

### Checklist for a great Dexetera market

- [ ] Is there a **clean, public, objective metric URL** that resolves undisputably?
- [ ] Is it a **recurring** event stream (repeat engagement), not a one-off?
- [ ] Is there a **real business** with un-hedgeable exposure to the number?
- [ ] Bonus: is there a **mirror business** with the opposite exposure? (→ two-sided hedgers)
- [ ] Bonus: is there an **existing rabid audience** to supply speculative liquidity?
- [ ] Does the metric avoid **fuzzy/subjective/self-reported** values that invite disputes?

---

## 10. Key file references

| Topic | Path |
|---|---|
| Factory (market creation) | `Dexetrav5/src/FuturesMarketFactory.sol` |
| Bond system | `Dexetrav5/src/MarketBondManagerV2.sol` |
| Live mark price (order book) | `Dexetrav5/src/diamond/facets/OBPricingFacet.sol` |
| Fee split on trades | `Dexetrav5/src/diamond/facets/OBTradeExecutionFacet.sol` |
| Settlement lifecycle / disputes | `Dexetrav5/src/diamond/facets/MarketLifecycleFacet.sol`, `Dexetrav5/src/DisputeRelay.sol` |
| Client market creation | `src/lib/createMarketOnChain.ts` |
| Server market creation | `src/app/api/markets/create/route.ts` |
| Settlement engine (AI worker) | `src/lib/settlement-engine.ts`, `metric-ai-worker/` |
| Ratio / indexed market math | `src/lib/ipfs/computeDerived.ts` |
| Creator fee tracking | `src/app/api/webhooks/alchemy/fees/route.ts` |
| Liquidity overlay (visual-only) | `src/lib/overlay/` |

---

*Primary chain: Hyperliquid (chainId 999). Collateral: USDC, bridged from
Arbitrum via Wormhole. Backend: Supabase. Scheduling: QStash.*
