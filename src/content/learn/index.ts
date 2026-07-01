import type { LearnArticle } from './types';
import whatIsPermissionlessFutures from './articles/what-is-a-permissionless-futures-market';
import howPredictionMarketsSettle from './articles/how-prediction-markets-settle';
import howPredictionMarketsWork from './articles/how-prediction-markets-work';
import howToTradeAnyMetric from './articles/how-to-trade-any-metric';
import permissionlessVsTraditional from './articles/permissionless-vs-traditional-futures';

/**
 * Content-as-code registry for the `/learn` editorial surface.
 *
 * This is intentionally a tiny provider interface (`getAllLearnArticles` /
 * `getLearnArticle`). To add a no-deploy CMS later, swap the source here for a
 * Supabase-backed fetch — the routes, metadata, and JSON-LD never change.
 */
const ARTICLES: LearnArticle[] = [
  whatIsPermissionlessFutures,
  howPredictionMarketsSettle,
  howPredictionMarketsWork,
  howToTradeAnyMetric,
  permissionlessVsTraditional,
];

const SORTED = [...ARTICLES].sort(
  (a, b) =>
    new Date(b.datePublished).getTime() - new Date(a.datePublished).getTime()
);

export function getAllLearnArticles(): LearnArticle[] {
  return SORTED;
}

export function getLearnArticle(slug: string): LearnArticle | undefined {
  return ARTICLES.find((a) => a.slug === slug);
}

export function getLearnSlugs(): string[] {
  return ARTICLES.map((a) => a.slug);
}
