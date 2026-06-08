'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';

const LOGO_SRC = '/Dexicon/LOGO-Dexetera-square-black-white.svg';

type Slide = {
  kind: 'title' | 'content' | 'closing';
  eyebrow?: string;
  title: string;
  subtitle?: string;
  body?: string;
  bullets?: { title?: string; text: string }[];
  steps?: string[];
  categories?: { category: string; examples: string }[];
  comparison?: { columns: string[]; rows: string[][] };
  footer?: string;
};

const ACCENT = '#00D4FF';

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
  const [index, setIndex] = useState(0);
  const [mounted, setMounted] = useState(false);
  const total = SLIDES.length;
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);

  useEffect(() => setMounted(true), []);

  const go = useCallback(
    (dir: number) => {
      setIndex((i) => Math.min(total - 1, Math.max(0, i + dir)));
    },
    [total],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') go(1);
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') go(-1);
      else if (e.key === 'Home') setIndex(0);
      else if (e.key === 'End') setIndex(total - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, total]);

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    // Only treat as a swipe if mostly horizontal (so vertical scroll still works).
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      go(dx < 0 ? 1 : -1);
    }
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const slide = SLIDES[index];

  if (!mounted) return null;

  return createPortal(
    <>
      {/* Mobile: deck is desktop-only */}
      <div
        className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0A0A0A] px-8 text-center text-white sm:hidden"
        style={{ height: '100dvh' }}
      >
        <div className="mb-6 inline-flex items-center justify-center rounded-2xl border border-[#222222] bg-[#0F0F0F] p-3 shadow-[0_0_40px_rgba(0,212,255,0.15)]">
          <Image src={LOGO_SRC} alt="Dexetera" width={48} height={48} className="h-12 w-12" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">Best viewed on desktop</h1>
        <p className="mt-2 max-w-xs text-sm text-[#9CA3AF]">
          Open this pitch deck on a larger screen for the full experience.
        </p>
      </div>

      {/* Desktop / tablet: the deck */}
      <div
        className="fixed inset-0 z-[200] hidden flex-col overflow-hidden bg-[#0A0A0A] text-white select-none sm:flex"
        style={{ height: '100dvh', touchAction: 'pan-y' }}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
      >
      {/* Ambient gradient orbs */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-40 top-0 h-[28rem] w-[28rem] rounded-full bg-[#00D4FF]/10 blur-[140px]" />
        <div className="absolute -right-32 bottom-0 h-[24rem] w-[24rem] rounded-full bg-[#00D4FF]/5 blur-[140px]" />
      </div>

      {/* Top progress bar */}
      <div className="relative z-10 h-0.5 w-full bg-[#1A1A1A]">
        <div
          className="h-full bg-[#00D4FF] transition-all duration-300"
          style={{ width: `${((index + 1) / total) * 100}%`, boxShadow: `0 0 10px ${ACCENT}` }}
        />
      </div>

      {/* Slide content (scrollable per slide for small screens) */}
      <div className="scrollbar-none relative z-10 min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-5 py-12 sm:px-10 sm:py-16">
          <div className="my-auto w-full">
            <SlideView slide={slide} />
          </div>
        </div>
      </div>

      {/* Bottom nav bar */}
      <div
        className="relative z-10 flex items-center justify-between gap-3 border-t border-[#1A1A1A] bg-[#0A0A0A]/80 px-4 py-3 backdrop-blur-md sm:px-8"
        style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
      >
        <Image
          src={LOGO_SRC}
          alt="Dexetera"
          width={24}
          height={24}
          className="hidden h-6 w-6 opacity-70 sm:block"
        />
        <button
          onClick={() => go(-1)}
          disabled={index === 0}
          aria-label="Previous slide"
          className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-[#222222] bg-[#0F0F0F] px-4 text-sm font-medium text-[#9CA3AF] transition active:scale-95 disabled:opacity-30 sm:hover:border-[#00D4FF] sm:hover:text-white"
        >
          ←<span className="ml-1 hidden sm:inline">Prev</span>
        </button>

        {/* Progress dots */}
        <div className="flex flex-1 items-center justify-center gap-1.5 overflow-x-auto px-2">
          {SLIDES.map((_, i) => (
            <button
              key={i}
              aria-label={`Go to slide ${i + 1}`}
              onClick={() => setIndex(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === index ? 'w-5 bg-[#00D4FF]' : 'w-1.5 bg-[#333333] sm:hover:bg-[#555555]'
              }`}
            />
          ))}
        </div>

        <div className="hidden w-14 text-right text-xs tabular-nums text-[#606060] sm:block">
          {index + 1} / {total}
        </div>

        <button
          onClick={() => go(1)}
          disabled={index === total - 1}
          aria-label="Next slide"
          className="flex h-11 min-w-11 items-center justify-center rounded-lg border border-[#222222] bg-[#0F0F0F] px-4 text-sm font-medium text-[#9CA3AF] transition active:scale-95 disabled:opacity-30 sm:hover:border-[#00D4FF] sm:hover:text-white"
        >
          <span className="mr-1 hidden sm:inline">Next</span>→
        </button>
      </div>
      </div>
    </>,
    document.body,
  );
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-4 flex items-center gap-2">
      <span className="h-1.5 w-1.5 rounded-full bg-[#00D4FF] shadow-[0_0_10px_#00D4FF]" />
      <span className="text-xs font-semibold tracking-[0.2em] text-[#00D4FF]">{children}</span>
    </div>
  );
}

function SlideView({ slide }: { slide: Slide }) {
  if (slide.kind === 'title') {
    return (
      <div>
        <div className="mb-6 inline-flex items-center justify-center rounded-2xl border border-[#222222] bg-[#0F0F0F] p-3 shadow-[0_0_40px_rgba(0,212,255,0.15)]">
          <Image src={LOGO_SRC} alt="Dexetera" width={56} height={56} priority className="h-12 w-12 sm:h-14 sm:w-14" />
        </div>
        {slide.eyebrow && <Eyebrow>{slide.eyebrow}</Eyebrow>}
        <h1 className="text-4xl font-bold leading-tight tracking-tight sm:text-6xl md:text-7xl">
          {slide.title}
        </h1>
        {slide.subtitle && (
          <p className="mt-5 text-xl font-medium text-[#00D4FF] sm:text-2xl">{slide.subtitle}</p>
        )}
        {slide.body && (
          <p className="mt-4 max-w-2xl text-base text-[#9CA3AF] sm:text-lg">{slide.body}</p>
        )}
      </div>
    );
  }

  if (slide.kind === 'closing') {
    return (
      <div>
        <div className="mb-6 inline-flex items-center justify-center rounded-2xl border border-[#222222] bg-[#0F0F0F] p-3 shadow-[0_0_40px_rgba(0,212,255,0.15)]">
          <Image src={LOGO_SRC} alt="Dexetera" width={48} height={48} className="h-11 w-11 sm:h-12 sm:w-12" />
        </div>
        {slide.eyebrow && <Eyebrow>{slide.eyebrow}</Eyebrow>}
        <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-5xl md:text-6xl">
          {slide.title}
        </h1>
        {slide.body && (
          <p className="mt-5 max-w-2xl text-lg text-[#9CA3AF] sm:text-xl">{slide.body}</p>
        )}
        {slide.footer && (
          <p className="mt-8 text-sm font-medium tracking-wide text-[#00D4FF] sm:text-base">
            {slide.footer}
          </p>
        )}
      </div>
    );
  }

  return (
    <div>
      {slide.eyebrow && <Eyebrow>{slide.eyebrow}</Eyebrow>}
      <h2 className="text-2xl font-bold leading-tight tracking-tight sm:text-4xl">{slide.title}</h2>
      {slide.body && (
        <p className="mt-4 max-w-2xl text-base text-[#9CA3AF] sm:text-lg">{slide.body}</p>
      )}

      {slide.bullets && (
        <ul className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
          {slide.bullets.map((b, i) => (
            <li
              key={i}
              className="rounded-xl border border-[#1A1A1A] bg-[#0F0F0F]/60 p-4 sm:p-5"
            >
              {b.title && <div className="text-sm font-semibold text-white sm:text-base">{b.title}</div>}
              <div className={`text-sm text-[#9CA3AF] ${b.title ? 'mt-1' : ''}`}>{b.text}</div>
            </li>
          ))}
        </ul>
      )}

      {slide.steps && (
        <ol className="mt-6 space-y-3">
          {slide.steps.map((s, i) => (
            <li key={i} className="flex gap-3 rounded-xl border border-[#1A1A1A] bg-[#0F0F0F]/60 p-4">
              <span className="flex h-7 w-7 flex-none items-center justify-center rounded-full bg-[#00D4FF]/15 text-sm font-bold text-[#00D4FF]">
                {i + 1}
              </span>
              <span className="text-sm text-[#9CA3AF] sm:text-base">{s}</span>
            </li>
          ))}
        </ol>
      )}

      {slide.categories && (
        <div className="mt-5 grid grid-cols-2 gap-2.5 sm:mt-6 sm:gap-3">
          {slide.categories.map((c, i) => (
            <div key={i} className="rounded-xl border border-[#1A1A1A] bg-[#0F0F0F]/60 p-3 sm:p-4">
              <div className="text-sm font-semibold text-white sm:text-base">{c.category}</div>
              <div className="mt-1 text-xs text-[#808080] sm:text-sm">{c.examples}</div>
            </div>
          ))}
        </div>
      )}

      {/* Mobile: stacked per-feature cards (no horizontal scroll) */}
      {slide.comparison && (
        <div className="mt-5 space-y-2.5 sm:hidden">
          {slide.comparison.rows.map((row, ri) => (
            <div key={ri} className="rounded-xl border border-[#1A1A1A] bg-[#0F0F0F]/60 p-3">
              <div className="text-sm font-semibold text-white">{row[0]}</div>
              <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                {slide.comparison!.columns.slice(1).map((col, ci) => {
                  const isDexetera = ci === 0;
                  return (
                    <div key={ci} className="flex flex-col">
                      <span
                        className={`text-[10px] uppercase tracking-wide ${
                          isDexetera ? 'text-[#00D4FF]' : 'text-[#606060]'
                        }`}
                      >
                        {col}
                      </span>
                      <span
                        className={`text-sm ${
                          isDexetera ? 'font-semibold text-[#4ade80]' : 'text-[#9CA3AF]'
                        }`}
                      >
                        {row[ci + 1]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Desktop / tablet: full comparison table */}
      {slide.comparison && (
        <div className="mt-6 hidden overflow-x-auto sm:block">
          <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
            <thead>
              <tr>
                {slide.comparison.columns.map((c, i) => (
                  <th
                    key={i}
                    className={`border-b border-[#222222] px-3 py-2.5 font-semibold ${
                      i === 1 ? 'text-[#00D4FF]' : 'text-[#9CA3AF]'
                    }`}
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {slide.comparison.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className={`border-b border-[#161616] px-3 py-2.5 ${
                        ci === 0
                          ? 'font-medium text-white'
                          : ci === 1
                            ? 'font-semibold text-[#4ade80]'
                            : 'text-[#808080]'
                      }`}
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {slide.footer && (
        <p className="mt-6 border-l-2 border-[#00D4FF] pl-3 text-sm text-[#9CA3AF] sm:text-base">
          {slide.footer}
        </p>
      )}
    </div>
  );
}
