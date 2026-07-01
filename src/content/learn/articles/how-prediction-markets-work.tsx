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
          A prediction market is a marketplace where the price <em>is</em> the
          forecast. Instead of asking experts what they think will happen,
          prediction markets let people put real money behind their beliefs — and
          the resulting price is a continuously updated, crowd-sourced estimate
          of how likely an outcome is. Here's how that actually works.
        </p>

        <h2>Price as probability</h2>
        <p>
          In a yes/no market, prices sit between 0 and 1 (often shown as cents or
          a percentage). A market trading at <code>0.62</code> is the crowd
          saying "about a 62% chance." If new information makes the outcome more
          likely, buyers push the price up; if it becomes less likely, sellers
          push it down. The price moves until it reflects the balance of what
          everyone, collectively, is willing to bet.
        </p>

        <h2>Why the crowd is often right</h2>
        <p>
          Prediction markets tend to be well-calibrated because of a simple
          incentive: being wrong costs money, and being right earns it. That
          rewards people who actually have an edge and quietly penalizes noise.
          Three forces do the work:
        </p>
        <ul>
          <li>
            <strong>Skin in the game.</strong> Opinions are cheap; positions are
            not. People bet harder when they're more confident.
          </li>
          <li>
            <strong>Information aggregation.</strong> Every trader brings a sliver
            of private information; the price blends all of it.
          </li>
          <li>
            <strong>Self-correction.</strong> If the price is off, profit-seekers
            move in to capture the gap, dragging it back toward reality.
          </li>
        </ul>

        <h2>From question to payout</h2>
        <p>
          Every market follows the same arc: it's created around a clearly
          defined question, it trades while the price discovers the odds, and it
          eventually resolves against a data source.{' '}
          <Link href="/learn/how-prediction-markets-settle">
            How settlement works
          </Link>{' '}
          is worth understanding in detail, because the credibility of the final
          payout is what makes the price meaningful in the first place.
        </p>

        <h2>Metric markets: beyond yes/no</h2>
        <p>
          Classic prediction markets answer binary questions. But the same
          machinery works for <em>any measurable number</em> — a price, a
          statistic, an index reading. That's the idea behind a{' '}
          <Link href="/learn/what-is-a-permissionless-futures-market">
            permissionless futures market
          </Link>
          : a market that tracks a continuous metric and settles to its value.
          It's why Dexetera frames the category as{' '}
          <Link href="/learn/how-to-trade-any-metric">trading any metric</Link>,
          not just betting on events.
        </p>

        <h2>How to read a market</h2>
        <p>When you land on a market, look at three things:</p>
        <ul>
          <li>
            <strong>The price</strong> — the current implied odds or expected
            value.
          </li>
          <li>
            <strong>The trend</strong> — whether conviction is building or fading
            over time.
          </li>
          <li>
            <strong>The settlement terms</strong> — what it measures and when it
            resolves.
          </li>
        </ul>
        <p>
          Put those together and a market page tells you not just <em>what</em>{' '}
          the crowd expects, but how strongly. Explore{' '}
          <Link href="/explore">live markets</Link> to see it for yourself.
        </p>
      </Prose>

      <RelatedMarkets heading="Read live prediction markets" />
    </>
  );
}

const article: LearnArticle = {
  slug: 'how-prediction-markets-work',
  title: 'How Prediction Markets Work (and Why the Price Is the Forecast)',
  description:
    'Prediction markets turn real-money trading into a live probability. Learn how price equals probability, why the crowd is often right, and how to read a market.',
  excerpt:
    'In a prediction market the price is the forecast. Here is how price maps to probability, why markets are well-calibrated, and how to read one at a glance.',
  datePublished: '2026-06-25',
  category: 'Fundamentals',
  keywords: [
    'how prediction markets work',
    'what is a prediction market',
    'prediction market price probability',
    'are prediction markets accurate',
    'prediction market explained',
    'metric markets',
  ],
  readingMinutes: 6,
  faqs: [
    {
      question: 'How do prediction markets work?',
      answer:
        'Participants trade shares in an outcome with real money. The price reflects the crowd\u2019s collective estimate of how likely the outcome is, updating continuously as people buy and sell, and the market resolves against a data source at settlement.',
    },
    {
      question: 'Why is a prediction market price the same as probability?',
      answer:
        'In a yes/no market, prices sit between 0 and 1. A price of 0.62 means the market implies roughly a 62% chance of the outcome, because that is the level at which buyers and sellers balance.',
    },
    {
      question: 'Are prediction markets accurate?',
      answer:
        'They tend to be well-calibrated because traders have money at stake, which rewards informed participants, aggregates private information, and self-corrects when the price drifts from reality.',
    },
  ],
  Body,
};

export default article;
