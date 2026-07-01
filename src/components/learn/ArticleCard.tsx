import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import type { LearnArticle } from '@/content/learn/types';
import { getCategoryStyle, withAlpha } from './learnTaxonomy';

interface ArticleCardProps {
  article: LearnArticle;
  /** Optional 1-based index, rendered as a faint monogram. */
  index?: number;
}

export default function ArticleCard({ article, index }: ArticleCardProps) {
  const { icon: Icon, accent } = getCategoryStyle(article.category);

  return (
    <Link
      href={`/learn/${article.slug}`}
      className="group relative flex h-full flex-col overflow-hidden rounded-xl border border-t-stroke-sub bg-t-card p-5 transition-all duration-200 hover:-translate-y-1 hover:border-t-stroke-hover hover:bg-t-card-hover hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.5)]"
    >
      {/* top hairline accent — reveals on hover */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px origin-left scale-x-0 opacity-0 transition-all duration-300 group-hover:scale-x-100 group-hover:opacity-100"
        style={{
          background: `linear-gradient(90deg, transparent, ${accent}, transparent)`,
        }}
      />
      {/* corner glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-16 -top-16 h-32 w-32 rounded-full opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-30"
        style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span
          aria-hidden
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border transition-transform duration-200 group-hover:scale-105"
          style={{
            backgroundColor: withAlpha(accent, '14'),
            borderColor: withAlpha(accent, '33'),
          }}
        >
          <Icon className="h-5 w-5" style={{ color: accent }} strokeWidth={1.75} />
        </span>
        {typeof index === 'number' && (
          <span className="font-mono text-[12px] tabular-nums text-t-stroke-hover transition-colors duration-200 group-hover:text-t-fg-muted">
            {String(index).padStart(2, '0')}
          </span>
        )}
      </div>

      <div className="relative mt-4 flex-1">
        <div className="mb-2 flex items-center gap-2 text-[11px] text-t-fg-muted">
          <span className="font-medium uppercase tracking-wide" style={{ color: accent }}>
            {article.category}
          </span>
          <span aria-hidden className="text-t-stroke-hover">
            ·
          </span>
          <span>{article.readingMinutes} min read</span>
        </div>

        <h3 className="text-[17px] font-semibold leading-snug tracking-tight text-t-fg transition-colors duration-200 group-hover:text-t-accent">
          {article.title}
        </h3>

        <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-t-fg-muted">
          {article.excerpt}
        </p>
      </div>

      <div className="relative mt-5 flex items-center gap-1 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 group-hover:text-t-fg">
        Read guide
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
      </div>
    </Link>
  );
}
