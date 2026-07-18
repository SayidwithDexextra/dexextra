'use client';

import Deck, { type Slide } from '../_components/Deck';

const SLIDES: Slide[] = [
  {
    kind: 'title',
    eyebrow: 'DEXETERA · HEDGING',
    title: 'From protocol to P&L',
    subtitle: 'How real businesses hedge real risk.',
    body: 'Beyond speculation, Dexetera lets any business turn an un-hedgeable exposure into a market it controls — and earn fees on it. Three worked examples, step by step.',
  },
  {
    kind: 'content',
    eyebrow: 'MARKET TYPES',
    title: 'Two kinds of Dexetera market',
    body: 'Before the examples: every market tracks either one number, or the relationship between two.',
    bullets: [
      { title: 'Single-metric', text: 'Follows one public number — GPU $/hr, a panel-price benchmark, NFT volume. Simple to build and settle; ideal when your risk is one moving price.' },
      { title: 'Dual-metric (ratio)', text: 'Follows the relationship between two numbers — like selling price ÷ input cost. Trades the margin itself; ideal when both numbers move and you care about the gap.' },
    ],
    footer: 'Rule of thumb: count the moving legs. One leg → single-metric. Two independently-moving legs → ratio. (Every example here is single-metric except InferCo’s margin market, which is a ratio.)',
  },
  {
    kind: 'content',
    eyebrow: 'THE PATTERN',
    title: 'Four ways a business puts Dexetera to work',
    body: 'Every example follows the same shape: an un-hedgeable exposure, a market built on a public metric, and a predictable outcome no matter which way the number moves.',
    bullets: [
      { title: 'Mirror markets', text: 'Two businesses with opposite exposures become each other’s counterparty.' },
      { title: 'Cost hedges', text: 'Lock in a volatile input price you otherwise can’t control.' },
      { title: 'Revenue hedges', text: 'Smooth a feast-or-famine revenue line tied to a public metric.' },
      { title: 'Margin (ratio) hedges', text: 'Trade the gap between two numbers — protect the whole margin, not one price.' },
    ],
    footer: 'And in every case: because you create the market, you earn a share of every trade on it.',
  },

  {
    kind: 'content',
    eyebrow: 'A QUICK NOTE',
    title: 'The numbers ahead are rough estimates',
    body: 'The figures in these examples are simplified, illustrative placeholders chosen to make the mechanics easy to grasp — not Dexetera quotes, real company financials, or precise market prices.',
    bullets: [
      { title: 'Illustrative only', text: 'Round numbers picked for clarity; real positions scale up and won’t be this tidy.' },
      { title: 'Directionally true', text: 'The mechanics — how a hedge offsets a move — are accurate; the exact dollars are not.' },
    ],
  },

  // ── Solution · GPU mirror market in one slide ──────────────
  {
    kind: 'content',
    eyebrow: 'THE SOLUTION · GPU $/HR',
    title: 'One market, two businesses, both protected',
    body: 'A single Dexetera market on GPU $/hr lets a compute buyer and a compute seller hedge opposite fears against each other — no speculator required.',
    bullets: [
      {
        title: 'The market',
        text: 'One public number — GPU $/hr, starting at $2 — becomes a tradable market anyone can spin up in minutes.',
      },
      {
        title: 'Opposite exposures',
        text: 'InferCo buys compute and fears prices UP → goes long. RigCloud sells compute and fears prices DOWN → goes short.',
      },
      {
        title: 'Either direction → flat',
        text: 'GPU $2 → $3: InferCo pays +$1k but its long earns +$1k; RigCloud earns +$1k but its short loses $1k. Both net flat — and mirror-image if it falls to $1.',
      },
      {
        title: 'Self-sustaining & paid',
        text: 'The buyer’s hedge is the seller’s hedge flipped, so they clear against each other — and whoever created the market earns fees on every trade.',
      },
    ],
    footer: 'The strongest structure there is: real hedgers on BOTH sides. Neither is gambling — both lock in a predictable quarter.',
  },

  // ── Example 01 · Mirror market ─────────────────────────────
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 01 · MEET THE PLAYERS',
    title: 'Two AI companies, one number: GPU $/hr',
    body: 'Both companies build their month around the same price — GPU time at $2/hr — but from opposite ends.',
    bullets: [
      { title: 'InferCo — buys compute', text: 'Uses 1,000 GPU-hours a month → pays $2,000. Compute is its biggest cost.' },
      { title: 'RigCloud — sells compute', text: 'Rents out 1,000 GPU-hours a month → earns $2,000. Compute is its whole revenue.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 01 · THE FEAR',
    title: 'Opposite fears → opposite trades',
    body: 'The same price swing that hurts one helps the other. That makes them natural counterparties on a single market tracking GPU $/hr.',
    bullets: [
      { title: 'InferCo fears prices UP', text: 'Higher rates eat its margin. It goes long — a position that pays if prices rise.' },
      { title: 'RigCloud fears prices DOWN', text: 'Lower rates shrink its revenue. It goes short — a position that pays if prices fall.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 01 · IF PRICES RISE',
    title: 'GPU jumps $2 → $3/hr',
    body: 'InferCo’s costs rise and RigCloud’s revenue rises — but the hedge cancels the swing for both.',
    bullets: [
      { title: 'InferCo', text: 'Pays $1,000 more for compute — but its long earns +$1,000. Net: flat.' },
      { title: 'RigCloud', text: 'Earns $1,000 more in revenue — but its short loses $1,000. Net: flat, revenue locked in.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 01 · IF PRICES FALL',
    title: 'GPU drops $2 → $1/hr',
    body: 'Now it’s the mirror image — and both still land flat.',
    bullets: [
      { title: 'RigCloud', text: 'Loses $1,000 of revenue — but its short earns +$1,000. Net: flat.' },
      { title: 'InferCo', text: 'Saves $1,000 on compute — but its long loses $1,000. Net: flat.' },
    ],
    footer: 'Two real businesses, opposite fears, one self-sustaining market — the buyer’s hedge is the seller’s hedge, flipped.',
  },

  // ── Example 02 · Cost hedge (Blackdove panels) ─────────────
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 02 · THE COST',
    title: 'Blackdove’s biggest hardware cost: the panel',
    body: 'Blackdove sells its 55" Digital Canvas for about $2,900. The Samsung-made display panel inside is the single biggest component — roughly $800 a unit.',
    bullets: [
      { title: 'Sells for', text: '~$2,900 per 55" canvas — a sticky, catalog price.' },
      { title: 'Panel costs', text: '~$800 — the dominant input, ahead of frame, electronics and assembly.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 02 · THE RISK',
    title: 'Panel prices swing 30–50% on the “crystal cycle”',
    body: 'Large-area panel prices are famously cyclical — gluts crash them, shortages spike them — and Blackdove can’t control the timing.',
    bullets: [
      { title: 'A shortage hits', text: 'The panel jumps from ~$800 to ~$1,100 — up ~$300 a unit.' },
      { title: 'Margin craters', text: 'That $300 comes straight off every canvas — real money across thousands of units.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 02 · THE HEDGE',
    title: 'Track the one cost that moves',
    body: 'Blackdove creates a single-metric market on a public large-panel-price benchmark and goes long — sized to one panel per canvas.',
    bullets: [
      { title: 'The metric', text: 'A published large-area panel-price index, settled quarterly.' },
      { title: 'The position', text: 'Long the panel price — it pays out exactly when panels get more expensive.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 02 · THE OUTCOME',
    title: 'The hardware margin stays predictable',
    body: 'Whether panels spike or fall, the hedge keeps the per-unit cost — and margin — steady.',
    bullets: [
      { title: 'Panels spike to ~$1,100', text: 'Cost rises ~$300 a unit — but the hedge pays ~+$300. Margin holds.' },
      { title: 'Panels fall to ~$500', text: 'Units get ~$300 cheaper to build; the hedge gives that back. Net: flat, and planned.' },
    ],
    footer: 'Lock in panel cost without renegotiating a supplier contract — and earn fees as the market’s creator.',
  },

  // ── Example 03 · Revenue hedge (Blackdove NFT) ─────────────
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 03 · THE REVENUE',
    title: 'The marketplace earns ~$80k a quarter',
    body: 'Blackdove takes a ~30–50% commission on the limited-edition artworks it sells ($5k–$75k each) — roughly $80k in a normal quarter. Almost pure margin.',
    bullets: [
      { title: 'The upside', text: 'Commission on $5k–$75k editions — nearly all margin when sales happen.' },
      { title: 'The catch', text: 'That revenue rides the NFT / digital-art market — feast one quarter, famine the next.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 03 · THE RISK',
    title: 'A crash can wipe the quarter',
    body: 'When the digital-art market turns cold, buyers vanish and the commission line collapses.',
    bullets: [
      { title: 'Normal quarter', text: '~$80k in commissions.' },
      { title: 'Crash quarter', text: 'Falls to ~$20k — a $60k hole in high-margin revenue, overnight.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 03 · THE HEDGE',
    title: 'Insure the number, on-chain',
    body: 'Blackdove takes a position that pays when NFT market activity falls — using a public, on-chain volume metric.',
    bullets: [
      { title: 'The metric', text: 'On-chain NFT trading volume — public, real-time, clean to settle.' },
      { title: 'The position', text: 'Pays out when the market cools — exactly when commissions dry up.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 03 · THE OUTCOME',
    title: 'Feast-or-famine becomes steady',
    body: 'The hedge fills the hole in bad quarters and only lightly trims the great ones.',
    bullets: [
      { title: 'Market crashes', text: 'Commissions drop to ~$20k — but the hedge pays ~+$60k. Back near $80k.' },
      { title: 'Market booms', text: 'Commissions jump to ~$160k; the hedge costs ~$20k. Still ~$140k.' },
    ],
    footer: 'Smooth the most volatile revenue line — downside covered, upside barely trimmed.',
  },

  // ── Example 04 · Dual-metric ratio (AI margin) ─────────────
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 04 · DUAL-METRIC (RATIO)',
    title: 'InferCo hedges its margin, not just a price',
    body: 'Example 01 hedged the GPU price alone. But InferCo’s real worry is the gap between what it charges and what compute costs — a job for a dual-metric (ratio) market.',
    bullets: [
      { title: 'Sells AI output', text: 'Charges $10 per million tokens.' },
      { title: 'Buys GPU compute', text: 'Costs $4 per million tokens → it keeps $6. The ratio: 10 ÷ 4 = 2.5×.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 04 · THE SQUEEZE',
    title: 'The danger is the gap closing',
    body: 'It’s not just rising GPU costs — it’s costs rising while competition caps what InferCo can charge. Two legs move at once.',
    bullets: [
      { title: 'Cost rises', text: 'GPU compute climbs from $4 to $6 per million tokens.' },
      { title: 'Price slips', text: 'Rivals push its selling price down to $8. Margin collapses from $6 to $2 — ratio 2.5 → 1.3.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 04 · THE HEDGE',
    title: 'Trade the ratio itself',
    body: 'InferCo creates a dual-metric market on selling price ÷ GPU cost, and goes short the ratio — a position that pays when its margin compresses.',
    bullets: [
      { title: 'The metric', text: 'Two public numbers — AI output price and GPU cost — combined into one ratio.' },
      { title: 'The position', text: 'Short the ratio — it pays out exactly when the gap (the margin) narrows.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 04 · THE OUTCOME',
    title: 'The margin holds, from either direction',
    body: 'Because a ratio captures both legs, InferCo is covered whether the squeeze comes from higher costs, lower prices, or both.',
    bullets: [
      { title: 'Margin squeezed (2.5 → 1.3)', text: 'Real margin drops ~$4 — but the short pays ~+$4. Back near $6.' },
      { title: 'Margin stays healthy', text: 'The hedge costs a little — but the fat 2.5× margin easily covers it.' },
    ],
    footer: 'A single-metric market caps one price; a ratio market protects the whole margin — the gap that is the business.',
  },

  // ── Example 05 · Construction (fixed-price cost inflation) ──
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 05 · FIXED-PRICE RISK',
    title: 'A contractor locks in a price, but not its costs',
    body: 'BuildCorp wins a fixed-price contract: $100M to deliver a project over two years, with ~$8M of expected profit. That profit is whatever survives two years of building costs it can’t reprice.',
    bullets: [
      { title: 'Price is locked', text: 'The $100M contract price can’t change, even if costs rise.' },
      { title: 'Costs are not', text: 'Labor and materials can inflate for two years — straight out of the margin.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 05 · THE GAP',
    title: 'Commodity futures only cover part of the risk',
    body: 'BuildCorp can hedge steel, copper, and diesel on traditional exchanges — but those are a fraction of the bill. The biggest driver of overruns has no futures market.',
    bullets: [
      { title: 'Hedgeable today', text: 'Exchange-traded raw materials: steel, copper, fuel.' },
      { title: 'Un-hedgeable today', text: 'Skilled-labor wages and blended regional construction-cost inflation — often most of the budget.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 05 · THE HEDGE',
    title: 'Hedge the whole cost of building',
    body: 'BuildCorp creates a single-metric market on a public construction-cost index and goes long — so if building gets more expensive, the position pays.',
    bullets: [
      { title: 'The metric', text: 'A public construction-cost index (e.g. a government construction PPI or building-cost index).' },
      { title: 'The position', text: 'Long the index — it pays out exactly when labor and materials inflate.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 05 · WHO TRADES IT',
    title: 'Two incentivized sides, plus a crowd',
    body: 'The contractor isn’t alone — the same index one business fears rising, another fears falling. That makes the market two-sided and liquid before a single speculator arrives.',
    bullets: [
      { title: 'Long side (creator)', text: 'Fixed-price contractors & developers — hurt when building costs RISE.' },
      { title: 'Short side (creator)', text: 'Material suppliers, subcontractors & construction-staffing firms — hurt when costs FALL and demand dries up.' },
      { title: 'Speculators', text: 'Real-estate investors and macro / rate traders with a view on the building cycle add depth on both sides.' },
      { title: 'Creator upside', text: 'Whoever launches the market earns a share of fees on every trade.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'EXAMPLE 05 · THE OUTCOME',
    title: 'Both sides sleep well',
    body: 'Whichever way the cost index moves, the hedge offsets the pain for the side it hurt — and both are protected.',
    bullets: [
      { title: 'Costs jump 10% (~$9M)', text: 'The contractor’s $8M profit would vanish — but its long pays ~+$9M. Suppliers boom; their short offsets. Both flat.' },
      { title: 'Costs fall', text: 'Suppliers’ revenue drops — but their short pays out. The contractor builds cheap; its long costs a little. Both flat.' },
    ],
    footer: 'Traditional futures hedge a few raw materials; Dexetera hedges the whole cost of building — with a natural counterparty on the other side.',
  },

  // ── Why now · prediction-market demand ─────────────────────
  {
    kind: 'content',
    eyebrow: 'WHY NOW · DEMAND',
    title: 'The appetite for outcome markets is already here',
    body: 'People have proven they’ll trade any public number in size. Combined volume on Kalshi and Polymarket went from under $5B a month in Sept 2025 to ~$45B in June 2026 — and topped $50B once Robinhood’s Rothera joined. That’s already more than triple the ~$14B monthly handle of every legal US sportsbook combined.',
    bullets: [
      { title: '~9× in 9 months', text: 'Combined monthly volume: <$5B (Sept 2025) → ~$45B (June 2026), per Pew’s analysis of The Block data.' },
      { title: '$22B valuation', text: 'Kalshi’s May 2026 Series F; Polymarket ~$8B alongside ICE’s $2B commitment. Institutions are building dedicated desks.' },
      { title: '78.5% of installs', text: 'Kalshi + Polymarket now take four of every five betting-app installs — up from ~6% a year earlier.' },
      { title: '$1T+ by 2030', text: 'Industry estimates for total prediction-market volume — if the space diversifies beyond sports.' },
    ],
    footer: 'But ~90% of that volume is sports, politics and crypto — pure speculation. The same mechanism, pointed at real business risk, is the far larger and almost-untapped market Dexetera builds for.',
  },

  // ── The opportunity · market ideas at a glance ─────────────
  {
    kind: 'content',
    eyebrow: 'THE OPPORTUNITY',
    title: 'A market for almost any exposure',
    body: 'A good market needs four things: a volatile metric, traders who disagree, two industries on opposite sides, and a public number to settle on. Eleven that qualify — single-metric, plus “(ratio)” markets that trade the gap between two numbers.',
    comparison: {
      columns: ['Market', 'Long side ▲', 'Short side ▼', 'Public metric'],
      rows: [
        ['Ocean freight', 'Importers & retailers', 'Container lines (Maersk, MSC)', 'Freightos FBX / Drewry WCI'],
        ['DRAM / NAND memory', 'Device & server OEMs', 'Memory makers (Micron, SK Hynix)', 'TrendForce spot index'],
        ['Battery-grade lithium', 'EV & battery makers', 'Lithium miners (Albemarle, SQM)', 'Fastmarkets / Benchmark'],
        ['Regional power', 'Data centers & smelters', 'Generators & utilities', 'ERCOT / PJM day-ahead'],
        ['GPU compute $/hr', 'AI labs & startups', 'GPU clouds & ex-miners', 'Spot-rental indices'],
        ['Wholesale eggs', 'Bakeries, QSR & grocers', 'Egg producers (Cal-Maine)', 'USDA shell-egg report'],
        ['Spark spread (ratio)', 'Gas-fired generators', 'Industrial buyers & gas producers', 'Power ÷ gas (ISO + Henry Hub)'],
        ['Mining margin (ratio)', 'Bitcoin miners (Marathon, Riot)', 'Power sellers & hosts', 'BTC ÷ power (Luxor Hashprice)'],
        ['Crop margin (ratio)', 'Farmers & agribusiness', 'Fertilizer producers (Nutrien)', 'Crop ÷ fertilizer index'],
        ['Steelmaker spread (ratio)', 'Steel mills (Nucor)', 'Ore & coal miners (BHP, Vale)', 'HRC ÷ (ore + coal), Platts'],
        ['AI inference margin (ratio)', 'AI app builders', 'Compute providers', 'Token price ÷ GPU cost'],
      ],
    },
    footer: 'If a business can point at a public number, it can hedge the risk behind it — and the market’s creator earns a fee on every trade.',
  },

  {
    kind: 'closing',
    eyebrow: 'DEXETERA · HEDGING',
    title: 'Any exposure. A market you control.',
    body: 'If a business can point at a public number, it can hedge the risk behind it — and earn fees while doing so.',
    footer: 'dexetera.org · dexetera.xyz · @dexeteralabs',
  },
];

export default function HedgingDeck() {
  return <Deck slides={SLIDES} />;
}
