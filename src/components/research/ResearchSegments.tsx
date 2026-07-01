import Link from 'next/link';
import type {
  ResearchSegment,
  MarketRef,
  ScorecardCall,
} from '@/content/research/types';
import {
  formatUsd,
  formatCents,
  formatProbability,
  formatGapPoints,
  formatDateTime,
} from '@/content/research/format';

function MarketCell({ market }: { market: MarketRef }) {
  if (!market.url) return <span className="text-t-fg">{market.title}</span>;
  const isInternal = market.url.startsWith('/');
  if (isInternal) {
    return (
      <Link href={market.url} className="text-t-accent hover:text-t-accent-hover">
        {market.title}
      </Link>
    );
  }
  return (
    <a
      href={market.url}
      rel="nofollow noopener"
      target="_blank"
      className="text-t-accent hover:text-t-accent-hover"
    >
      {market.title}
    </a>
  );
}

function SegmentShell({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} aria-label={title} className="scroll-mt-24">
      <h2 className="mb-1 text-xl font-semibold tracking-tight text-t-fg">
        {title}
      </h2>
      {intro && (
        <p className="mb-4 text-[14px] leading-7 text-t-fg-muted">{intro}</p>
      )}
      {children}
    </section>
  );
}

function Table({
  headers,
  rows,
}: {
  headers: string[];
  rows: React.ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-t-stroke-sub">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-t-stroke-sub bg-t-card">
            {headers.map((h) => (
              <th
                key={h}
                className="px-3 py-2.5 text-left text-[11px] font-medium uppercase tracking-wide text-t-fg-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-t-stroke-sub last:border-0 hover:bg-t-card"
            >
              {row.map((cell, j) => (
                <td key={j} className="px-3 py-2.5 align-top text-t-fg-muted">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RESULT_STYLES: Record<ScorecardCall['result'], string> = {
  WIN: 'text-t-positive',
  LOSS: 'text-t-negative',
  PENDING: 'text-t-fg-muted',
};

function SingleSegment({ segment }: { segment: ResearchSegment }) {
  switch (segment.type) {
    case 'prose':
      return (
        <section id={segment.id} className="scroll-mt-24">
          {segment.title && (
            <h2 className="mb-1 text-xl font-semibold tracking-tight text-t-fg">
              {segment.title}
            </h2>
          )}
          <div className="space-y-4 text-[15px] leading-7 text-t-fg-muted">
            {segment.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        </section>
      );

    case 'whale_watch':
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <Table
            headers={['Trader', 'Market', 'Side', 'Size', 'Price', 'When']}
            rows={segment.items.map((it) => [
              <span className="text-t-fg" key="t">
                {it.trader}
              </span>,
              <MarketCell market={it.market} key="m" />,
              <span key="s">
                {it.side} {it.outcome}
              </span>,
              <span className="tabular-nums text-t-fg" key="u">
                {formatUsd(it.usdNotional)}
              </span>,
              <span className="tabular-nums" key="p">
                {formatCents(it.fillPrice)}
              </span>,
              <span key="w">{formatDateTime(it.timestamp)}</span>,
            ])}
          />
        </SegmentShell>
      );

    case 'consensus_board':
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <Table
            headers={['Market', 'Market price', 'Smart money', 'Gap', 'Sharps']}
            rows={segment.items.map((it) => [
              <MarketCell market={it.market} key="m" />,
              <span className="tabular-nums" key="mp">
                {formatCents(it.marketPrice)}
              </span>,
              <span className="tabular-nums text-t-fg" key="sm">
                {formatCents(it.smartMoneyImpliedPrice)}
              </span>,
              <span
                className={`tabular-nums ${
                  it.gap > 0 ? 'text-t-positive' : it.gap < 0 ? 'text-t-negative' : ''
                }`}
                key="g"
              >
                {formatGapPoints(it.gap)}
              </span>,
              <span className="tabular-nums" key="c">
                {it.sharpCount}
              </span>,
            ])}
          />
        </SegmentShell>
      );

    case 'reversals':
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <Table
            headers={['Trader', 'Market', 'Flip', 'Note']}
            rows={segment.items.map((it) => [
              <span className="text-t-fg" key="t">
                {it.trader}
              </span>,
              <MarketCell market={it.market} key="m" />,
              <span key="f">
                {it.from} → {it.to}
              </span>,
              <span key="n">{it.note ?? '—'}</span>,
            ])}
          />
        </SegmentShell>
      );

    case 'contrarian_corner':
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <Table
            headers={['Market', 'Public favorite', 'Sharp side', 'Note']}
            rows={segment.items.map((it) => [
              <MarketCell market={it.market} key="m" />,
              <span key="pf">{it.publicFavorite}</span>,
              <span className="text-t-fg" key="ss">
                {it.sharpSide}
              </span>,
              <span key="n">{it.note ?? '—'}</span>,
            ])}
          />
        </SegmentShell>
      );

    case 'trader_of_week': {
      const t = segment.trader;
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <div className="rounded-lg border border-t-stroke-sub bg-t-card p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-lg font-semibold text-t-fg">
                {t.traderUrl ? (
                  <a
                    href={t.traderUrl}
                    rel="nofollow noopener"
                    target="_blank"
                    className="text-t-fg hover:text-t-accent"
                  >
                    {t.name}
                  </a>
                ) : (
                  t.name
                )}
              </h3>
              <span className="text-[13px] text-t-fg-muted">{t.specialty}</span>
            </div>
            <dl className="mt-4 flex flex-wrap gap-x-8 gap-y-2 text-[13px]">
              <div>
                <dt className="text-[10px] uppercase tracking-wide text-t-fg-muted">
                  Win rate
                </dt>
                <dd className="tabular-nums text-t-fg">
                  {formatProbability(t.winRate)}
                </dd>
              </div>
              {typeof t.decided === 'number' && (
                <div>
                  <dt className="text-[10px] uppercase tracking-wide text-t-fg-muted">
                    Decided
                  </dt>
                  <dd className="tabular-nums text-t-fg">{t.decided}</dd>
                </div>
              )}
            </dl>
            {t.signatureWin && (
              <p className="mt-3 text-[13px] leading-6 text-t-fg-muted">
                {t.signatureWin}
              </p>
            )}
          </div>
        </SegmentShell>
      );
    }

    case 'category_heat':
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          <ul className="space-y-2">
            {segment.items.map((it) => (
              <li
                key={it.category}
                className="flex items-center justify-between gap-3 rounded-md border border-t-stroke-sub bg-t-card px-3 py-2 text-[13px]"
              >
                <span className="text-t-fg">{it.category}</span>
                <span className="tabular-nums text-t-fg-muted">
                  {it.direction === 'up'
                    ? '▲ '
                    : it.direction === 'down'
                    ? '▼ '
                    : ''}
                  {it.score}
                </span>
              </li>
            ))}
          </ul>
        </SegmentShell>
      );

    case 'settled_scorecard': {
      const sc = segment.scorecard;
      return (
        <SegmentShell id={segment.id} title={segment.title} intro={segment.intro}>
          {(typeof sc.hitRate === 'number' || sc.priorIssue) && (
            <p className="mb-4 text-[13px] text-t-fg-muted">
              {typeof sc.hitRate === 'number' && (
                <>
                  Hit rate:{' '}
                  <span className="font-semibold text-t-fg">
                    {formatProbability(sc.hitRate)}
                  </span>
                  .{' '}
                </>
              )}
              {sc.priorIssue && (
                <>
                  Grading{' '}
                  <Link
                    href={`/research/${sc.priorIssue.slug}`}
                    className="text-t-accent hover:text-t-accent-hover"
                  >
                    {sc.priorIssue.title}
                  </Link>
                  .
                </>
              )}
            </p>
          )}
          <Table
            headers={['Market', 'Call', 'Result']}
            rows={sc.calls.map((c) => [
              <MarketCell market={c.market} key="m" />,
              <span className="tabular-nums" key="call">
                {c.call}
              </span>,
              <span className={`font-medium ${RESULT_STYLES[c.result]}`} key="r">
                {c.result}
              </span>,
            ])}
          />
        </SegmentShell>
      );
    }

    default:
      return null;
  }
}

export default function ResearchSegments({
  segments,
}: {
  segments: ResearchSegment[];
}) {
  return (
    <div className="space-y-10">
      {segments.map((segment) => (
        <SingleSegment key={segment.id} segment={segment} />
      ))}
    </div>
  );
}
