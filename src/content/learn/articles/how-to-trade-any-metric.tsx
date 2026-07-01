/* eslint-disable react/no-unescaped-entities */
import Link from 'next/link';
import Prose from '@/components/learn/Prose';
import RelatedMarkets from '@/components/learn/RelatedMarkets';
import type { LearnArticle } from '../types';

function Body() {
  return (
    <>
      <Prose>
        <p>
          "Trade any metric" is the core idea behind Dexetera: if an outcome can
          be measured, you can take a position on it. This is a practical,
          beginner-friendly walkthrough of how to go from landing on a market to
          holding a position — and how to think about risk along the way.
        </p>

        <h2>Step 1 — Find a market</h2>
        <p>
          Start on the <Link href="/explore">explore page</Link>, which lists
          every live market. Each one tracks a specific metric and shows its
          current price and settlement date. You can also browse straight from
          the <Link href="/markets">markets directory</Link>. If nothing fits
          what you want to trade, you can{' '}
          <Link href="/markets/create">create your own market</Link> — that's the
          "permissionless" part in action.
        </p>

        <h2>Step 2 — Read the market before you trade</h2>
        <p>
          A few seconds of reading saves a lot of regret. On any market page,
          check:
        </p>
        <ul>
          <li>
            <strong>What it measures</strong> — the exact underlying metric and
            data source.
          </li>
          <li>
            <strong>The price</strong> — the crowd's current estimate (and, for
            yes/no markets, the implied probability).
          </li>
          <li>
            <strong>The settlement date</strong> — when it resolves. See{' '}
            <Link href="/learn/how-prediction-markets-settle">
              how settlement works
            </Link>{' '}
            if you're unsure what that means.
          </li>
        </ul>

        <h2>Step 3 — Connect a wallet</h2>
        <p>
          Trading is permissionless, so there's no account application — you
          connect a wallet to trade. This is what lets the same settlement and
          payout rules apply to everyone automatically, without a broker in the
          middle.
        </p>

        <h2>Step 4 — Take a position</h2>
        <p>
          Decide which direction you believe the metric will go and size your
          position. Two principles matter most for beginners:
        </p>
        <ul>
          <li>
            <strong>Have a thesis.</strong> You're trading against a crowd
            that's pricing in real information. Know <em>why</em> you think the
            price is wrong.
          </li>
          <li>
            <strong>Size for survival.</strong> Only risk what you're prepared to
            lose on any single market, and remember the outcome isn't known until
            settlement.
          </li>
        </ul>

        <h2>Step 5 — Manage and settle</h2>
        <p>
          After you're in, the price will keep moving as new information arrives.
          You can hold to settlement and let the market resolve against its data
          source, or exit earlier if your thesis plays out (or breaks). Either
          way, your final result is determined by the settlement rules described
          on the market page.
        </p>

        <h2>A quick mental model</h2>
        <p>
          Every trade is a disagreement with the current price. If you understand{' '}
          <Link href="/learn/how-prediction-markets-work">
            how prediction markets work
          </Link>{' '}
          and{' '}
          <Link href="/learn/what-is-a-permissionless-futures-market">
            what a permissionless futures market is
          </Link>
          , you already have the foundation — the rest is finding metrics where
          you think the crowd is mispricing the future.
        </p>
      </Prose>

      <RelatedMarkets heading="Start with these live markets" />
    </>
  );
}

const article: LearnArticle = {
  slug: 'how-to-trade-any-metric',
  title: 'How to Trade Any Metric on Dexetera: A Beginner\u2019s Guide',
  description:
    'A step-by-step beginner guide to trading any measurable metric on Dexetera — finding a market, reading it, connecting a wallet, taking a position, and settling.',
  excerpt:
    'From finding a market to settling a position: a practical, beginner-friendly walkthrough of trading any measurable metric on Dexetera.',
  datePublished: '2026-06-25',
  category: 'Guides',
  keywords: [
    'how to trade any metric',
    'how to trade prediction markets',
    'trade metric futures',
    'beginner prediction market guide',
    'how to trade on Dexetera',
    'permissionless futures guide',
  ],
  readingMinutes: 6,
  faqs: [
    {
      question: 'How do I start trading on Dexetera?',
      answer:
        'Find a market on the explore page, read what it measures and when it settles, connect a wallet, then take a position sized to your risk tolerance. You can hold to settlement or exit earlier.',
    },
    {
      question: 'Do I need an account to trade permissionless markets?',
      answer:
        'No. Trading is permissionless, so instead of applying for an account you connect a wallet. The same settlement and payout rules apply to everyone automatically.',
    },
    {
      question: 'Can I create my own market?',
      answer:
        'Yes. If no existing market fits the metric you want to trade, you can create your own — that is the defining feature of a permissionless platform.',
    },
  ],
  Body,
};

export default article;
