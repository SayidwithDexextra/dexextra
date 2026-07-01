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
          Traditional futures and{' '}
          <Link href="/learn/what-is-a-permissionless-futures-market">
            permissionless futures
          </Link>{' '}
          share the same DNA — both are contracts whose value tracks an
          underlying measure and resolves at a settlement date. What changes is{' '}
          <em>who controls the market</em>. That single difference cascades into
          almost everything else.
        </p>

        <h2>Who decides which markets exist</h2>
        <p>
          On a traditional exchange, a central body decides which contracts are
          listed. New contracts are slow, scarce, and skewed toward
          high-volume institutional demand. On a permissionless platform, any
          user can create a market — so coverage extends to niche, novel, and
          fast-moving metrics that no exchange would bother listing.
        </p>

        <h2>Who is allowed to trade</h2>
        <p>
          Traditional futures often require a broker, an approved account, and
          can be gated by geography or accreditation. Permissionless markets
          replace the application process with a wallet connection: access is
          open, and the rules are identical for every participant.
        </p>

        <h2>How the rules are enforced</h2>
        <ul>
          <li>
            <strong>Traditional:</strong> a clearinghouse and intermediaries
            manage margin, settlement, and counterparty risk. You trust the
            institutions.
          </li>
          <li>
            <strong>Permissionless:</strong> smart contracts enforce margin and
            settlement automatically and transparently. You trust the code and
            the named data source — see{' '}
            <Link href="/learn/how-prediction-markets-settle">
              how settlement works
            </Link>
            .
          </li>
        </ul>

        <h2>Side by side</h2>
        <ul>
          <li>
            <strong>Market creation:</strong> gatekept and slow vs. open to
            anyone.
          </li>
          <li>
            <strong>Access:</strong> broker/accreditation vs. connect a wallet.
          </li>
          <li>
            <strong>Coverage:</strong> mostly mainstream assets vs. virtually any
            measurable metric.
          </li>
          <li>
            <strong>Enforcement:</strong> intermediaries &amp; clearinghouses vs.
            smart contracts.
          </li>
          <li>
            <strong>Transparency:</strong> opaque order flow vs. an open,
            on-chain price.
          </li>
        </ul>

        <h2>What stays the same</h2>
        <p>
          The trading instincts carry over. You're still taking a view on where
          a measure will be at settlement, the price still reflects collective
          expectations, and risk management still matters. If you understand{' '}
          <Link href="/learn/how-prediction-markets-work">
            how prediction markets work
          </Link>
          , you already understand the engine — permissionless markets just
          remove the gatekeeper around it.
        </p>

        <h2>Which should you use?</h2>
        <p>
          They serve different needs. Traditional futures suit standardized,
          institution-scale hedging on mainstream assets. Permissionless futures
          shine when you want to trade something specific, new, or niche — and
          want to do it without waiting for permission. Ready to try the open
          model? Start on the{' '}
          <Link href="/explore">explore page</Link> or follow our{' '}
          <Link href="/learn/how-to-trade-any-metric">
            beginner's guide to trading any metric
          </Link>
          .
        </p>
      </Prose>

      <RelatedMarkets heading="Trade the open model" />
    </>
  );
}

const article: LearnArticle = {
  slug: 'permissionless-vs-traditional-futures',
  title: 'Permissionless vs. Traditional Futures: What\u2019s the Difference?',
  description:
    'Permissionless and traditional futures share the same DNA but differ on who controls the market. Compare creation, access, enforcement, and transparency.',
  excerpt:
    'Same instrument, different control. A clear comparison of permissionless vs. traditional futures across creation, access, rule enforcement, and transparency.',
  datePublished: '2026-06-25',
  category: 'Fundamentals',
  keywords: [
    'permissionless vs traditional futures',
    'decentralized futures vs traditional',
    'what is the difference permissionless futures',
    'on-chain futures vs cex futures',
    'permissionless futures explained',
  ],
  readingMinutes: 5,
  faqs: [
    {
      question: 'What is the difference between permissionless and traditional futures?',
      answer:
        'Both track an underlying measure and resolve at settlement, but traditional futures are listed and gated by a central exchange and enforced by intermediaries, while permissionless futures can be created and traded by anyone and are enforced by smart contracts.',
    },
    {
      question: 'Are permissionless futures safe?',
      answer:
        'Trust shifts from institutions to transparent code and a clearly named data source. Safety depends on the quality of the contracts and the settlement source, both of which a good market discloses up front.',
    },
    {
      question: 'When should I use permissionless futures?',
      answer:
        'When you want to trade something specific, novel, or niche without waiting for an exchange to list it, and you value open access and a transparent on-chain price.',
    },
  ],
  Body,
};

export default article;
