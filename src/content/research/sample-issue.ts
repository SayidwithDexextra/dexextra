import type { ResearchPost } from './types';

/**
 * Illustrative, hand-built sample of a "Smart Money Weekly" issue. Its only
 * purpose is to let the team preview the rendering skeleton before the
 * Polymarket ingestion + generation engine exist.
 *
 * It is flagged `isSample: true`, which means it:
 *   - renders a visible "sample / illustrative data" banner,
 *   - is excluded from the sitemap and emits no structured data,
 *   - is always `noindex` regardless of the global research index flag.
 *
 * The numbers below are placeholders, NOT real market data.
 */
const sampleIssue: ResearchPost = {
  slug: 'sample-smart-money-weekly',
  title: 'Smart Money Weekly — Sample Issue',
  description:
    'A preview of the Smart Money Weekly format. Illustrative data only — used to validate the rendering skeleton ahead of live data integration.',
  excerpt:
    'Format preview with placeholder data. Shows how each weekly segment will render once live prediction-market data is wired in.',
  datePublished: '2026-06-25',
  category: 'Smart Money Weekly',
  keywords: ['prediction market intelligence', 'smart money', 'sample'],
  readingMinutes: 4,
  issueNumber: 0,
  dataAsOf: '2026-06-25T12:00:00.000Z',
  isSample: true,
  sources: ['Illustrative placeholder data — not sourced from any live feed.'],
  segments: [
    {
      type: 'prose',
      id: 'intro',
      title: 'What you are looking at',
      paragraphs: [
        'This is a structural preview of a weekly issue. Each section below is a reusable segment that the generation engine will populate from prediction-market data cached in our datastore.',
        'Every number shown here is a placeholder. Once ingestion is live, these figures will trace back to stored values with timestamps, and this banner will disappear.',
      ],
    },
    {
      type: 'consensus_board',
      id: 'consensus',
      title: 'The Consensus Board',
      intro:
        'Markets where the most tracked sharps agree — and how far their implied price sits from the market.',
      items: [
        {
          market: { title: 'Sample Market A' },
          marketPrice: 0.18,
          smartMoneyImpliedPrice: 0.24,
          gap: 0.06,
          sharpCount: 7,
        },
        {
          market: { title: 'Sample Market B' },
          marketPrice: 0.61,
          smartMoneyImpliedPrice: 0.54,
          gap: -0.07,
          sharpCount: 5,
        },
      ],
    },
    {
      type: 'whale_watch',
      id: 'whales',
      title: 'Whale Watch',
      intro: 'The biggest aggressive (taker) positions opened this period.',
      items: [
        {
          trader: 'sample-trader-1',
          market: { title: 'Sample Market A' },
          side: 'BUY',
          outcome: 'YES',
          usdNotional: 250000,
          fillPrice: 0.61,
          timestamp: '2026-06-24T15:30:00.000Z',
        },
        {
          trader: 'sample-trader-2',
          market: { title: 'Sample Market C' },
          side: 'SELL',
          outcome: 'NO',
          usdNotional: 120000,
          fillPrice: 0.43,
          timestamp: '2026-06-24T18:05:00.000Z',
        },
      ],
    },
    {
      type: 'category_heat',
      id: 'heat',
      title: 'Category Heat',
      intro: 'Where smart money is concentrating this period.',
      items: [
        { category: 'Politics', score: 92, direction: 'up' },
        { category: 'Crypto', score: 74, direction: 'flat' },
        { category: 'Sports', score: 58, direction: 'down' },
      ],
    },
    {
      type: 'trader_of_week',
      id: 'trader',
      title: 'Trader of the Week',
      trader: {
        name: 'sample-trader-1',
        specialty: 'Politics specialist',
        winRate: 0.71,
        decided: 48,
        signatureWin:
          'Placeholder narrative: a signature resolved call that demonstrates the trader\u2019s edge in their specialty category.',
      },
    },
    {
      type: 'settled_scorecard',
      id: 'scorecard',
      title: 'Settled Scorecard',
      intro:
        'Last period\u2019s published calls, graded against resolutions. This is the core trust mechanism.',
      scorecard: {
        hitRate: 0.67,
        calls: [
          { market: { title: 'Sample Market D' }, call: 'YES @ 0.62', result: 'WIN' },
          { market: { title: 'Sample Market E' }, call: 'NO @ 0.40', result: 'LOSS' },
          { market: { title: 'Sample Market F' }, call: 'YES @ 0.55', result: 'PENDING' },
        ],
      },
    },
  ],
  faqs: [
    {
      question: 'Is this real market data?',
      answer:
        'No. This is a sample issue with placeholder numbers, used to preview the format before live prediction-market data is integrated.',
    },
  ],
};

export default sampleIssue;
