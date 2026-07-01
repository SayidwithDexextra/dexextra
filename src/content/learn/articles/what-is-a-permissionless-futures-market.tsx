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
          A <strong>permissionless futures market</strong> is a market where
          anyone can create, trade, and settle a futures contract on a
          measurable outcome — without asking a bank, broker, or exchange for
          approval. On a platform like{' '}
          <Link href="/explore">Dexetera</Link>, you don't apply for listing or
          wait for a committee. If an outcome can be measured, a market can exist
          for it, and the rules that govern it are enforced by code rather than a
          gatekeeper.
        </p>

        <h2>"Permissionless" — what it actually means</h2>
        <p>
          In traditional finance, launching a futures contract is a privilege.
          An exchange decides which contracts exist, who may list them, and who
          is allowed to trade. "Permissionless" inverts that:
        </p>
        <ul>
          <li>
            <strong>Open creation:</strong> any user can spin up a new market on
            a metric they care about, the same way anyone can publish a webpage.
          </li>
          <li>
            <strong>Open access:</strong> trading isn't gated by geography,
            institution, or accreditation — you connect a wallet and trade.
          </li>
          <li>
            <strong>Rules as code:</strong> margin, settlement, and payouts are
            executed by smart contracts, so the same rules apply to everyone
            automatically.
          </li>
        </ul>

        <h2>"Futures" — what you're actually trading</h2>
        <p>
          A futures contract is an agreement whose value tracks an underlying
          measure over time and resolves at a set settlement date. You take a
          position on where that measure will be, and your profit or loss is the
          difference between your entry and the value at settlement. The
          underlying can be a price, a statistic, an index — anything with a
          credible data source. That flexibility is the whole point of{' '}
          <Link href="/learn/how-to-trade-any-metric">trading "any metric"</Link>
          .
        </p>

        <h2>How a permissionless market stays trustworthy</h2>
        <p>
          Removing the gatekeeper doesn't mean removing the rules. Trust comes
          from three places instead:
        </p>
        <ul>
          <li>
            <strong>A defined data source.</strong> Every market specifies
            exactly what it measures and where that number comes from.
          </li>
          <li>
            <strong>Deterministic settlement.</strong> When the settlement date
            arrives, the market resolves against that data source and pays out
            automatically. (We cover this in depth in{' '}
            <Link href="/learn/how-prediction-markets-settle">
              how prediction &amp; metric markets settle
            </Link>
            .)
          </li>
          <li>
            <strong>Transparent pricing.</strong> The live market price is the
            crowd's real-money forecast of the outcome, updated continuously as
            people trade.
          </li>
        </ul>

        <h2>Why it matters</h2>
        <p>
          Permissionless markets unlock outcomes that traditional exchanges
          would never list because they're too niche, too fast-moving, or too
          new. A community can stand up a market the moment a question becomes
          interesting — and let real capital, not opinion, price it. That makes
          the resulting price a genuinely useful signal, and it's why the model
          pairs naturally with{' '}
          <Link href="/learn/how-prediction-markets-work">
            how prediction markets work
          </Link>
          .
        </p>
      </Prose>

      <RelatedMarkets />
    </>
  );
}

const article: LearnArticle = {
  slug: 'what-is-a-permissionless-futures-market',
  title: 'What Is a Permissionless Futures Market?',
  description:
    'A permissionless futures market lets anyone create, trade, and settle futures on any measurable outcome — no gatekeeper. Here is how it works and why it matters.',
  excerpt:
    'Anyone can create and trade a futures contract on any measurable outcome — no broker, no listing committee. Here is what "permissionless" really means.',
  datePublished: '2026-06-25',
  category: 'Fundamentals',
  keywords: [
    'permissionless futures market',
    'what is a permissionless futures market',
    'permissionless futures',
    'decentralized futures',
    'trade any metric',
    'on-chain futures',
    'prediction market',
  ],
  readingMinutes: 5,
  faqs: [
    {
      question: 'What is a permissionless futures market?',
      answer:
        'A permissionless futures market is a futures contract on a measurable outcome that anyone can create, trade, and settle without approval from a broker or exchange. Margin, settlement, and payouts are enforced by smart contracts.',
    },
    {
      question: 'How is it different from a normal futures contract?',
      answer:
        'Traditional futures are listed and gated by an exchange that decides which contracts exist and who can trade. Permissionless futures let any user create a market and any user trade it, with rules executed automatically by code.',
    },
    {
      question: 'What can a permissionless futures market track?',
      answer:
        'Any outcome with a credible, measurable data source — prices, statistics, indices, or other real-world metrics — provided the market defines what it measures and how it settles.',
    },
  ],
  Body,
};

export default article;
