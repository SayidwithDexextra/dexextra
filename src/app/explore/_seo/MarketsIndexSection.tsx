import Link from 'next/link';
import { getMarketsIndex } from './marketsIndex';

/**
 * Server-rendered directory of every active market. Lives below the interactive
 * (client) market list so that each `/token/[symbol]` page receives a crawlable
 * internal link from the high-authority `/explore` index — the fix for orphaned
 * programmatic market pages. Plain anchors, fully present in the SSR HTML.
 */
export default async function MarketsIndexSection() {
  const markets = await getMarketsIndex();
  if (markets.length === 0) return null;

  return (
    <section
      aria-label="All markets"
      className="mt-8 border-t border-t-stroke-sub pt-6"
    >
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] font-medium uppercase tracking-wide text-t-fg-muted">
          All markets
        </h2>
        <span className="text-[11px] text-t-fg-muted tabular-nums">
          {markets.length} live
        </span>
      </div>

      <p className="mb-4 max-w-3xl text-[13px] leading-relaxed text-t-fg-muted">
        Browse every live market on Dexetera, the decentralized platform for
        trading permissionless futures on any measurable metric. Each market
        resolves against real-world data at settlement.
      </p>

      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {markets.map((market) => (
          <li key={market.slug} className="min-w-0">
            <Link
              href={`/token/${encodeURIComponent(market.slug)}`}
              className="block truncate py-1 text-[13px] text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
              title={`${market.name} (${market.symbol})`}
            >
              <span className="text-t-fg">{market.symbol}</span>
              <span className="ml-1.5 text-t-fg-muted">{market.name}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
