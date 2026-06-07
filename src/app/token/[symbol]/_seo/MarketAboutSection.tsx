import Link from 'next/link';
import type { MarketSeoData } from './marketSeoData';

/**
 * Server-rendered, human-readable "About" section for a market. This is the
 * primary crawlable body content for `/token/[symbol]` — the interactive
 * trading UI above it is client-rendered and largely invisible to crawlers.
 * Styled to match the Sophisticated Minimal design system.
 */
export default function MarketAboutSection({ data }: { data: MarketSeoData }) {
  if (!data.found) return null;

  const summary =
    data.description?.trim() ||
    `${data.name} is a permissionless futures market that resolves against its real-world metric at settlement.`;

  const facts: Array<{ label: string; value: string }> = [
    { label: 'Mark price', value: data.priceFormatted },
    { label: 'Settlement', value: data.settlementDateFormatted },
  ];
  if (data.totalVolumeFormatted) {
    facts.push({ label: 'Total volume', value: data.totalVolumeFormatted });
  }

  return (
    <section aria-label={`About ${data.name}`} className="hidden md:block bg-t-page">
      <div className="w-full max-w-[1920px] mx-auto px-1 pb-8">
        <div className="mt-1 rounded-md border border-t-stroke-sub bg-t-card p-5 transition-colors duration-200 hover:border-t-stroke">
          <div className="mb-3">
            <h2 className="text-[11px] font-medium uppercase tracking-wide text-t-fg-muted">
              About {data.symbol}
            </h2>
          </div>

          <h3 className="text-base font-semibold text-t-fg mb-2">
            {data.name}
            <span className="ml-2 text-xs font-normal text-t-fg-muted">{data.symbol}</span>
          </h3>

          <p className="max-w-3xl text-[13px] leading-relaxed text-t-fg-muted">
            {data.name} ({data.symbol}) is a permissionless futures market on{' '}
            <span className="text-t-fg">Dexetera</span>, the decentralized platform for
            trading any measurable metric. {summary} The market currently trades at a mark
            price of <span className="text-t-fg">{data.priceFormatted}</span> and is
            scheduled to settle on{' '}
            <span className="text-t-fg">{data.settlementDateFormatted}</span>, when it
            resolves against its underlying real-world data. Anyone can trade {data.symbol}{' '}
            or create new markets on Dexetera.
          </p>

          <dl className="mt-4 flex flex-wrap overflow-hidden rounded-md border border-t-stroke-sub">
            {facts.map((fact) => (
              <div
                key={fact.label}
                className="flex flex-1 min-w-[120px] flex-col gap-1 bg-t-card p-3 border-l border-t-stroke-sub first:border-l-0"
              >
                <dt className="text-[10px] uppercase tracking-wide text-t-fg-muted">
                  {fact.label}
                </dt>
                <dd className="text-[13px] text-t-fg tabular-nums">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {data.category.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span className="text-[12px] text-t-fg-muted">Categories:</span>
              {data.category.map((cat) => (
                <Link
                  key={cat}
                  href={`/explore?category=${encodeURIComponent(cat)}`}
                  className="inline-flex items-center rounded-full border border-t-stroke px-2.5 py-0.5 text-[11px] text-t-fg-muted transition-colors duration-200 hover:border-t-stroke-hover hover:text-t-fg"
                >
                  {cat}
                </Link>
              ))}
            </div>
          )}

          <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-t-stroke-sub pt-4">
            <Link
              href="/markets"
              className="text-[12px] text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
            >
              Explore all markets →
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
