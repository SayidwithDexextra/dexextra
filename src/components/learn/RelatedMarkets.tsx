import Link from 'next/link';
import { getMarketsIndex } from '@/app/explore/_seo/marketsIndex';

interface RelatedMarketsProps {
  heading?: string;
  limit?: number;
  /** If provided and enough markets match, restrict to this category. */
  category?: string;
}

/**
 * Server-rendered block of links to live markets, embedded inside articles so
 * every editorial page interlinks to ≥1 active `/token/[symbol]` page (funnels
 * readers into the product and distributes crawl equity). Data is fetched from
 * Supabase via the shared cached index — always fresh, never hardcoded.
 */
export default async function RelatedMarkets({
  heading = 'Markets you can trade right now',
  limit = 6,
  category,
}: RelatedMarketsProps) {
  const all = await getMarketsIndex();

  let markets = all;
  if (category) {
    const target = category.toLowerCase();
    const filtered = all.filter((m) =>
      m.category.some((c) => c.toLowerCase() === target)
    );
    if (filtered.length >= 3) markets = filtered;
  }
  markets = markets.slice(0, limit);

  if (markets.length === 0) return null;

  return (
    <aside
      aria-label={heading}
      className="not-prose my-8 rounded-lg border border-t-stroke-sub bg-t-card p-5"
    >
      <h2 className="mb-1 text-sm font-semibold text-t-fg">{heading}</h2>
      <p className="mb-4 text-[13px] text-t-fg-muted">
        Live permissionless markets on Dexetera. Trade any metric, or{' '}
        <Link href="/markets/create" className="text-t-accent hover:text-t-accent-hover">
          create your own
        </Link>
        .
      </p>
      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {markets.map((market) => (
          <li key={market.slug}>
            <Link
              href={`/token/${encodeURIComponent(market.slug)}`}
              className="flex items-center justify-between gap-3 rounded-md border border-t-stroke-sub bg-t-page px-3 py-2.5 transition-colors duration-200 hover:border-t-stroke-hover"
            >
              <span className="min-w-0 truncate text-[13px] text-t-fg-muted">
                <span className="font-medium text-t-fg">{market.symbol}</span>
                <span className="ml-1.5">{market.name}</span>
              </span>
              <span className="shrink-0 text-[12px] text-t-accent">Trade →</span>
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-4 border-t border-t-stroke-sub pt-3">
        <Link
          href="/explore"
          className="text-[13px] text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
        >
          Explore all markets →
        </Link>
      </div>
    </aside>
  );
}
