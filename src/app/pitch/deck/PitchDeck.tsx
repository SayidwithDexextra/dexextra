'use client';

import Deck, { type Slide } from '../_components/Deck';

const SLIDES: Slide[] = [
  {
    kind: 'title',
    eyebrow: 'DEXETERA',
    title: 'Turn any metric into a tradable market',
    subtitle: 'If it can be measured, it can be traded.',
    body: 'The permissionless protocol for creating and trading futures markets on any measurable metric.',
  },
  {
    kind: 'content',
    eyebrow: 'PREDICTION MARKETS, V2',
    title: 'Prediction markets proved the demand. We built the next version.',
    body: 'Polymarket and friends showed the world wants to trade on real outcomes — but v1 caps out at binary yes/no events, AMM pricing, and centralized resolution. Dexetera is the upgrade.',
    bullets: [
      { title: 'v1: binary events', text: 'v2: continuous metrics — trade the actual number, not just “did it happen.”' },
      { title: 'v1: bet to a fixed payout', text: 'v2: leveraged long / short with real P&L on a live orderbook.' },
      { title: 'v1: AMM odds', text: 'v2: true price discovery from bids and asks.' },
      { title: 'v1: centralized resolution', text: 'v2: trustless, evidence-backed UMA oracle settlement.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'SOLUTION',
    title: 'The upgrade that onboards everyone V1 left out',
    body: 'Dexetera keeps what people love about prediction markets and fixes their ceilings — unlocking far more markets, far more creators, and real trading upside.',
    bullets: [
      { title: 'Onboards more markets', text: 'V1 curates a handful of events. Anyone can permissionlessly list a market on any metric in minutes — an unbounded catalog.' },
      { title: 'Onboards more traders', text: 'Familiar leveraged long / short with real, continuous P&L on an on-chain orderbook — not a one-off, fixed-payout bet.' },
      { title: 'Real price discovery', text: 'A true bid/ask orderbook replaces AMM odds, so prices reflect genuine market sentiment.' },
      { title: 'No one controls the outcome', text: 'UMA’s optimistic oracle replaces a central resolver with trustless, evidence-backed settlement.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'BUILT ON HYPERLIQUID',
    title: 'A pump.fun × Polymarket hybrid',
    body: 'Take pump.fun’s permissionless, one-click creation and Polymarket’s trade-on-outcomes demand — then run it on HyperLiquid, the chain fast and cheap enough for a real on-chain orderbook.',
    bullets: [
      { title: 'The pump.fun side', text: 'Anyone launches a market in minutes. No gatekeepers, no listing committee — an open, viral catalog of markets.' },
      { title: 'The Polymarket side', text: 'Trade on real-world outcomes and metrics — but continuous and leveraged, not a binary yes/no bet.' },
      { title: 'Why HyperLiquid', text: 'High throughput + low fees + EVM compatibility — the speed an on-chain orderbook and frequent order updates demand.' },
      { title: 'Every market is its own contract', text: 'Each is an isolated, tradeable page anyone can reach with a wallet.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'HOW IT WORKS',
    title: 'From metric to liquid market in four steps',
    steps: [
      'Define the metric and its public data source.',
      'Deploy an isolated on-chain market (its own Diamond contract).',
      'Trade long / short with USDC on the orderbook.',
      'Settle trustlessly via UMA — proposer posts value + evidence + bond; disputes escalate to UMA’s DVM vote.',
    ],
  },
  {
    kind: 'content',
    eyebrow: 'USE CASES',
    title: 'One protocol, an unbounded market surface',
    categories: [
      { category: 'Cryptocurrency', examples: 'BTC price, ETH gas, protocol TVL' },
      { category: 'Commodities', examples: 'Gold, silver, oil, agriculture' },
      { category: 'Indices', examples: 'S&P 500, NASDAQ, custom baskets' },
      { category: 'Economics', examples: 'Inflation, GDP, unemployment' },
      { category: 'Weather', examples: 'Temperature, rainfall indices' },
      { category: 'Sports & Social', examples: 'Player stats, follower counts' },
    ],
    footer: 'Only rule: the metric must be objectively measurable from a public source at settlement.',
  },
  {
    kind: 'content',
    eyebrow: 'MARKET SIZE',
    title: 'Dexetera sits between two markets already worth trillions',
    body: 'Two proven markets are booming: on-chain perpetual futures and prediction markets. Dexetera bridges them — the real on-chain orderbook of a perp DEX, pointed at the outcome- and metric-trading demand prediction markets unlocked.',
    marketSize: [
      {
        value: '$92.9T',
        label: 'Global perp-futures market',
        caption: 'Top-10 CEX + DEX perpetual-swap volume, 2025. Source: CoinGecko.',
        heightPct: 100,
      },
      {
        value: '$6.7T',
        label: 'On-chain perp DEXs',
        caption: 'DEX perpetual volume in 2025, up 346% YoY. Source: CoinGecko.',
        heightPct: 60,
      },
      {
        value: '$44.8B',
        label: 'Prediction markets',
        caption: 'Kalshi + Polymarket, June 2026 alone, +75% MoM. Source: The Block.',
        heightPct: 32,
      },
    ],
    footer: 'Dexetera’s wedge is the continuous-metric and business-hedging markets neither side can express today — a real orderbook and trustless settlement for any public number. (Bars are illustrative; the values span orders of magnitude.)',
  },
  {
    kind: 'content',
    eyebrow: 'WHY IT COMPOUNDS',
    title: 'Network effects on both sides',
    body: 'Dexetera is a two-sided marketplace, and every new market is its own acquisition surface that compounds as the catalog grows.',
    bullets: [
      { title: 'Creators are incentivized', text: 'Market creators earn a share of their market’s trading fees — a supply side that launches markets and drives volume to them.' },
      { title: 'Every market is a funnel', text: 'Each market is its own shareable page and contract — a distinct top-of-funnel multiplied across the whole catalog.' },
      { title: 'The flywheel accelerates', text: 'More markets → more discovery → more volume → more creators. It gets stronger with scale.' },
      { title: 'First-mover advantage', text: 'The first permissionless metric-futures venue pairing a real orderbook with trustless oracle settlement.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'PRODUCT',
    title: 'Professional-grade trading, permissionless plumbing',
    bullets: [
      { text: 'Long / short in USDC on a real on-chain orderbook.' },
      { text: 'Market & limit orders with a live mark price for P&L.' },
      { text: 'Oracle-verified settlement price at expiry.' },
      { text: 'TradingView charts + real-time orderbook UI, mobile-responsive.' },
      { text: 'Permissionless market creation — list any metric in minutes, no gatekeepers.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'TECHNOLOGY',
    title: 'Modular, isolated, upgradeable, trust-minimized',
    bullets: [
      { title: 'On-chain orderbook', text: 'Genuine price discovery, not an AMM.' },
      { title: 'Diamond pattern (EIP-2535)', text: 'Each market is its own contract with modular facets.' },
      { title: 'Per-market isolation', text: 'Atomic FacetRegistry upgrades across every market.' },
      { title: 'UMA Oracle V3', text: 'Settlement on HyperLiquid via Factory, CoreVault, OrderRouter.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'SETTLEMENT & SECURITY',
    title: 'Trust replaced with evidence and bonds',
    bullets: [
      { title: 'Evidence-backed', text: 'Proposers post a value with a screenshot, Wayback archive, and on-chain hash.' },
      { title: 'Anyone can dispute', text: 'Challenges escalate to UMA’s DVM vote.' },
      { title: 'Skin in the game', text: 'Bonds on both sides keep proposers and challengers honest.' },
      { title: 'Non-custodial', text: 'Funds stay in user wallets until used for trading.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'BUSINESS MODEL',
    title: 'Fees scale with markets and volume',
    bullets: [
      { title: 'Trading fees', text: 'A small % of notional, split between protocol and market creator.' },
      { title: 'Settlement fees', text: 'A nominal fee covering oracle costs.' },
      { title: 'Creator incentive', text: 'Creators earn from the volume their markets attract.' },
    ],
    footer: 'Flywheel: more creators → more markets → more volume → more fees → more creators.',
  },
  {
    kind: 'content',
    eyebrow: 'REVENUE',
    title: 'How Dexetera makes money',
    body: 'Every fill pays a small fee on notional traded. Fees are split between the protocol and the market’s creator, so our revenue scales directly with volume — with no directional risk and no inventory to manage.',
    bullets: [
      { title: 'Maker fee — ~0.03%', text: 'Charged on resting limit orders that add liquidity to the orderbook. Kept low to reward market-making.' },
      { title: 'Taker fee — ~0.07%', text: 'Charged on market / marketable orders that remove liquidity. The primary revenue driver.' },
      { title: '80% protocol · 20% creator', text: 'Every trading fee is split on-chain — the protocol keeps 80%, the market creator earns 20% of the volume they attract.' },
      { title: 'Gas + settlement fees', text: 'Takers reimburse relayer gas (capped per trade); a nominal settlement fee covers UMA oracle resolution costs.' },
    ],
    footer: 'Protocol revenue = Σ (notional traded × fee rate × 80%) across every market. Fully on-chain, transparent, and volume-linked.',
  },
  {
    kind: 'content',
    eyebrow: 'OVERVIEW',
    title: 'Dexetera in brief',
    body: 'A permissionless protocol where anyone can turn any measurable metric into a tradable futures market — and anyone can trade it.',
    bullets: [
      { title: 'What', text: 'On-chain futures markets on any measurable metric.' },
      { title: 'Who', text: 'Anyone creates a market; anyone trades it — no gatekeepers.' },
      { title: 'How', text: 'A real on-chain orderbook plus trustless UMA oracle settlement.' },
      { title: 'Why it matters', text: 'The next version of prediction markets: more markets, real upside, fully non-custodial.' },
    ],
  },
  {
    kind: 'content',
    eyebrow: 'COMPETITION',
    title: 'No one else covers this surface',
    comparison: {
      columns: ['Feature', 'Dexetera', 'Traditional', 'Prediction', 'Perp DEXs'],
      rows: [
        ['Permissionless creation', 'Yes', 'No', 'Limited', 'No'],
        ['Custom metrics', 'Any', 'Standardized', 'Events', 'Crypto'],
        ['Settlement', 'UMA Oracle', 'Centralized', 'Centralized', 'Mark price'],
        ['Trading model', 'Orderbook', 'Orderbook', 'AMM/OB', 'AMM'],
        ['Non-custodial', 'Yes', 'No', 'Varies', 'Yes'],
      ],
    },
  },
  {
    kind: 'content',
    eyebrow: 'TRACTION & ROADMAP',
    title: 'Live today, compounding from here',
    bullets: [
      { title: 'Now', text: 'Live on HyperLiquid mainnet with multiple active markets; UMA settlement + viral growth shipped.' },
      { title: 'Near term', text: 'More categories, market-making tools, analytics, programmatic SEO.' },
      { title: 'Future', text: 'Cross-chain deployment, trading API, mobile apps.' },
    ],
  },
  {
    kind: 'closing',
    eyebrow: 'DEXETERA',
    title: 'What do you want to trade?',
    body: 'Dexetera makes any measurable metric a permissionless, trustlessly-settled market.',
    footer: 'dexetera.org · dexetera.xyz · @dexeteralabs',
  },
];

export default function PitchDeck() {
  return <Deck slides={SLIDES} />;
}
