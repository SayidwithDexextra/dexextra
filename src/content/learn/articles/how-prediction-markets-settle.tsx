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
          Settlement is the moment a market stops being a forecast and becomes a
          fact. It's the single most important mechanic in any{' '}
          <Link href="/learn/how-prediction-markets-work">
            prediction or metric market
          </Link>
          : it decides who was right, who was wrong, and how much everyone gets
          paid. This guide walks through how settlement works, step by step.
        </p>

        <h2>The lifecycle of a market</h2>
        <p>Every market moves through the same phases:</p>
        <ol>
          <li>
            <strong>Creation.</strong> A market is defined: the question, the
            underlying metric, the data source, and the settlement date.
          </li>
          <li>
            <strong>Trading.</strong> Participants buy and sell, and the price
            continuously reflects the crowd's real-money estimate of the
            outcome.
          </li>
          <li>
            <strong>Settlement window.</strong> At the settlement date, trading
            for resolution purposes is finalized and the market reads its
            outcome from the data source.
          </li>
          <li>
            <strong>Resolution &amp; payout.</strong> The market resolves to the
            measured value and positions are settled automatically.
          </li>
        </ol>

        <h2>Where the settlement value comes from</h2>
        <p>
          A market is only as trustworthy as its data source. Good markets name
          the source up front and leave no ambiguity about how the final number
          is read. Sources generally fall into two buckets:
        </p>
        <ul>
          <li>
            <strong>Objective data feeds:</strong> a price, an official
            statistic, or an index pulled from a defined provider at a defined
            time. These resolve mechanically.
          </li>
          <li>
            <strong>Reported outcomes:</strong> real-world events where a result
            is published (and, in robust systems, can be challenged or verified
            before it's finalized).
          </li>
        </ul>

        <h2>Binary vs. scalar settlement</h2>
        <p>There are two common shapes for how a market pays out:</p>
        <ul>
          <li>
            <strong>Binary (yes/no):</strong> the outcome is one of two states.
            The winning side is paid and the losing side is not — the price
            behaves like an implied probability between 0 and 1.
          </li>
          <li>
            <strong>Scalar (a number):</strong> the market settles to a value on
            a range (for example, a metric's reading at a date). Payout scales
            with how close the settlement value is to your position — this is how
            a futures-style{' '}
            <Link href="/learn/what-is-a-permissionless-futures-market">
              permissionless futures market
            </Link>{' '}
            on a continuous metric resolves.
          </li>
        </ul>

        <h2>Why settlement design protects you</h2>
        <p>
          Clear settlement rules are what stop a market from being a coin flip.
          Before you trade, you should always be able to answer three questions:
        </p>
        <ul>
          <li>What exact metric does this market measure?</li>
          <li>Which data source determines the final value, and when is it read?</li>
          <li>How does payout map to that value (binary or scalar)?</li>
        </ul>
        <p>
          If a market answers all three cleanly, the price you see is a
          meaningful signal. On Dexetera, every market page shows its settlement
          date and the metric it tracks so you can judge this before putting
          capital at risk. Browse{' '}
          <Link href="/explore">live markets</Link> to see settlement details in
          context.
        </p>
      </Prose>

      <RelatedMarkets heading="See settlement dates on live markets" />
    </>
  );
}

const article: LearnArticle = {
  slug: 'how-prediction-markets-settle',
  title: 'How Do Prediction & Metric Markets Settle?',
  description:
    'Settlement turns a market from a forecast into a fact. Learn the market lifecycle, where settlement values come from, and binary vs. scalar payouts.',
  excerpt:
    'Settlement decides who was right and how everyone gets paid. Here is the full lifecycle — data sources, settlement windows, and binary vs. scalar payouts.',
  datePublished: '2026-06-25',
  category: 'Fundamentals',
  keywords: [
    'how do prediction markets settle',
    'prediction market settlement',
    'market settlement',
    'binary vs scalar settlement',
    'how futures settle',
    'metric market resolution',
  ],
  readingMinutes: 6,
  faqs: [
    {
      question: 'How do prediction markets settle?',
      answer:
        'At the settlement date the market reads its outcome from a predefined data source and resolves to that value, then pays out positions automatically. Markets can settle as binary (yes/no) or scalar (a number on a range).',
    },
    {
      question: 'What is the difference between binary and scalar settlement?',
      answer:
        'Binary markets resolve to one of two states and pay the winning side only. Scalar markets resolve to a number on a range, and payouts scale with how close the settlement value is to your position.',
    },
    {
      question: 'What determines the final settlement value?',
      answer:
        'A predefined data source named when the market is created — either an objective data feed (price, statistic, index) read at a set time, or a reported real-world outcome that can be verified before it is finalized.',
    },
  ],
  Body,
};

export default article;
