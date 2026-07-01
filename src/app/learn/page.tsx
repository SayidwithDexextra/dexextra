import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowRight, ArrowUpRight, GraduationCap, Sparkles } from 'lucide-react';
import { getAllLearnArticles } from '@/content/learn';
import type { LearnArticle } from '@/content/learn/types';
import ArticleCard from '@/components/learn/ArticleCard';
import {
  categoryAnchor,
  getCategoryStyle,
  withAlpha,
} from '@/components/learn/learnTaxonomy';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

export const metadata: Metadata = {
  title: 'Learn — Prediction & Permissionless Futures Markets',
  description:
    'Plain-language guides to prediction markets and permissionless futures: how they work, how they settle, and how to trade any measurable metric on Dexetera.',
  alternates: { canonical: '/learn' },
  openGraph: {
    title: 'Learn — Prediction & Permissionless Futures Markets | Dexetera',
    description:
      'Plain-language guides to prediction markets and permissionless futures on Dexetera.',
    url: `${baseUrl}/learn`,
    type: 'website',
    siteName: 'Dexetera',
  },
};

function groupByCategory(articles: LearnArticle[]) {
  const order: string[] = [];
  const map = new Map<string, LearnArticle[]>();
  for (const a of articles) {
    if (!map.has(a.category)) {
      map.set(a.category, []);
      order.push(a.category);
    }
    map.get(a.category)!.push(a);
  }
  return order.map((category) => ({ category, items: map.get(category)! }));
}

export default function LearnIndexPage() {
  const articles = getAllLearnArticles();
  const featured =
    articles.find(
      (a) => a.slug === 'what-is-a-permissionless-futures-market'
    ) || articles[0];
  const grouped = groupByCategory(articles);
  const topicCount = grouped.length;
  const featuredStyle = getCategoryStyle(featured.category);
  const FeaturedIcon = featuredStyle.icon;

  const collectionLd = {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: 'Dexetera Learn',
    description:
      'Guides to prediction markets and permissionless futures markets.',
    url: `${baseUrl}/learn`,
    hasPart: articles.map((a) => ({
      '@type': 'Article',
      headline: a.title,
      url: `${baseUrl}/learn/${a.slug}`,
      datePublished: a.datePublished,
    })),
  };

  return (
    <div className="dex-page-enter-up">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(collectionLd) }}
      />

      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative overflow-hidden border-b border-t-stroke-sub bg-t-page">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-30%] h-[460px] w-[900px] max-w-[140%] -translate-x-1/2 rounded-full opacity-[0.14] blur-3xl"
            style={{
              background:
                'radial-gradient(circle, var(--t-accent), transparent 70%)',
            }}
          />
          <div
            className="absolute inset-0 opacity-[0.04]"
            style={{
              backgroundImage:
                'linear-gradient(var(--t-fg) 1px, transparent 1px), linear-gradient(90deg, var(--t-fg) 1px, transparent 1px)',
              backgroundSize: '46px 46px',
              maskImage:
                'radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)',
              WebkitMaskImage:
                'radial-gradient(ellipse 80% 60% at 50% 0%, #000 40%, transparent 100%)',
            }}
          />
        </div>

        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-24">
          <div className="inline-flex items-center gap-2 rounded-full border border-t-stroke-sub bg-t-card/80 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-t-fg-muted backdrop-blur">
            <Sparkles className="h-3.5 w-3.5 text-t-accent" />
            Dexetera Learn
          </div>

          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.07] tracking-tight text-t-fg sm:text-[3.25rem]">
            Understand the markets
            <br className="hidden sm:block" /> before you{' '}
            <span className="bg-[linear-gradient(100deg,#00D4FF,#A78BFA)] bg-clip-text text-transparent">
              trade them.
            </span>
          </h1>

          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-t-fg-muted">
            Clear, no-jargon guides to prediction markets and permissionless
            futures — how they work, how they settle, and how to trade any
            measurable metric on Dexetera.
          </p>

          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link
              href={`/learn/${featured.slug}`}
              className="group inline-flex items-center gap-2 rounded-lg bg-t-fg px-4 py-2.5 text-[13px] font-semibold text-t-page transition-opacity duration-200 hover:opacity-90"
            >
              Start with the basics
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
            </Link>
            <Link
              href="/explore"
              className="group inline-flex items-center gap-2 rounded-lg border border-t-stroke bg-t-card px-4 py-2.5 text-[13px] font-semibold text-t-fg transition-colors duration-200 hover:border-t-stroke-hover hover:bg-t-card-hover"
            >
              Explore live markets
              <ArrowUpRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
            </Link>
          </div>

          {/* Topic pills */}
          <div className="mt-8 flex flex-wrap items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-t-fg-muted">
              Browse:
            </span>
            {grouped.map(({ category }) => {
              const style = getCategoryStyle(category);
              const Icon = style.icon;
              return (
                <a
                  key={category}
                  href={`#${categoryAnchor(category)}`}
                  className="group inline-flex items-center gap-1.5 rounded-full border border-t-stroke-sub bg-t-card px-3 py-1 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 hover:border-t-stroke-hover hover:text-t-fg"
                >
                  <Icon
                    className="h-3.5 w-3.5"
                    style={{ color: style.accent }}
                    strokeWidth={2}
                  />
                  {category}
                </a>
              );
            })}
          </div>

          <dl className="mt-10 flex flex-wrap gap-x-10 gap-y-3">
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-t-fg-muted">
                Guides
              </dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums text-t-fg">
                {String(articles.length).padStart(2, '0')}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-t-fg-muted">
                Topics
              </dt>
              <dd className="mt-0.5 font-mono text-lg tabular-nums text-t-fg">
                {String(topicCount).padStart(2, '0')}
              </dd>
            </div>
            <div>
              <dt className="text-[11px] uppercase tracking-wide text-t-fg-muted">
                Cost
              </dt>
              <dd className="mt-0.5 text-lg font-semibold text-t-fg">Free</dd>
            </div>
          </dl>
        </div>
      </section>

      {/* ─────────────────────── Featured guide ─────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        <div className="mb-4 flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-t-fg-muted">
          <GraduationCap className="h-4 w-4 text-t-accent" />
          Start here
        </div>

        <Link
          href={`/learn/${featured.slug}`}
          className="group relative grid overflow-hidden rounded-2xl border border-t-stroke-sub bg-t-card transition-all duration-200 hover:border-t-stroke-hover hover:shadow-[0_24px_70px_-30px_rgba(0,0,0,0.6)] md:grid-cols-[1.4fr_1fr]"
        >
          <div className="relative z-10 p-7 sm:p-9">
            <div className="mb-4 flex items-center gap-2">
              <span
                className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{
                  color: featuredStyle.accent,
                  borderColor: withAlpha(featuredStyle.accent, '40'),
                  backgroundColor: withAlpha(featuredStyle.accent, '14'),
                }}
              >
                {featured.category}
              </span>
              <span className="text-[11px] text-t-fg-muted">
                {featured.readingMinutes} min read
              </span>
            </div>
            <h2 className="max-w-xl text-2xl font-semibold leading-tight tracking-tight text-t-fg transition-colors duration-200 group-hover:text-t-accent sm:text-3xl">
              {featured.title}
            </h2>
            <p className="mt-3 max-w-xl text-[14.5px] leading-7 text-t-fg-muted">
              {featured.excerpt}
            </p>
            <div className="mt-6 inline-flex items-center gap-2 text-[13px] font-semibold text-t-fg">
              Read the guide
              <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-1" />
            </div>
          </div>

          {/* Decorative visual panel */}
          <div
            aria-hidden
            className="relative hidden items-center justify-center overflow-hidden border-l border-t-stroke-sub md:flex"
          >
            <div
              className="absolute inset-0"
              style={{
                background: `radial-gradient(circle at 70% 35%, ${withAlpha(
                  featuredStyle.accent,
                  '24'
                )}, transparent 60%)`,
              }}
            />
            {/* concentric rings */}
            <div
              className="absolute h-72 w-72 rounded-full border"
              style={{ borderColor: withAlpha(featuredStyle.accent, '14') }}
            />
            <div
              className="absolute h-52 w-52 rounded-full border"
              style={{ borderColor: withAlpha(featuredStyle.accent, '1F') }}
            />
            <div
              className="absolute h-32 w-32 rounded-full border"
              style={{ borderColor: withAlpha(featuredStyle.accent, '2E') }}
            />
            <span
              className="relative flex h-16 w-16 items-center justify-center rounded-2xl border backdrop-blur transition-transform duration-300 group-hover:scale-110"
              style={{
                backgroundColor: withAlpha(featuredStyle.accent, '1A'),
                borderColor: withAlpha(featuredStyle.accent, '3A'),
              }}
            >
              <FeaturedIcon
                className="h-8 w-8"
                style={{ color: featuredStyle.accent }}
                strokeWidth={1.5}
              />
            </span>
          </div>
        </Link>
      </section>

      {/* ─────────────────────── Browse by topic ─────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-16">
        {grouped.map(({ category, items }) => {
          const style = getCategoryStyle(category);
          const Icon = style.icon;
          return (
            <div
              key={category}
              id={categoryAnchor(category)}
              className="mb-14 scroll-mt-20 last:mb-0"
            >
              <div className="mb-5 flex items-end justify-between gap-4 border-b border-t-stroke-sub pb-3">
                <div className="flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-10 w-10 items-center justify-center rounded-lg border"
                    style={{
                      backgroundColor: withAlpha(style.accent, '14'),
                      borderColor: withAlpha(style.accent, '33'),
                    }}
                  >
                    <Icon
                      className="h-5 w-5"
                      style={{ color: style.accent }}
                      strokeWidth={1.75}
                    />
                  </span>
                  <div>
                    <h2 className="text-lg font-semibold tracking-tight text-t-fg">
                      {category}
                    </h2>
                    {style.blurb && (
                      <p className="mt-0.5 text-[13px] text-t-fg-muted">
                        {style.blurb}
                      </p>
                    )}
                  </div>
                </div>
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-t-fg-muted">
                  {items.length} {items.length === 1 ? 'guide' : 'guides'}
                </span>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((article, i) => (
                  <ArticleCard
                    key={article.slug}
                    article={article}
                    index={i + 1}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* ─────────────────────── CTA band ─────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 pb-20">
        <div className="relative overflow-hidden rounded-2xl border border-t-stroke-sub bg-t-card p-8 sm:p-10">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full opacity-[0.14] blur-3xl"
            style={{
              background:
                'radial-gradient(circle, var(--t-accent), transparent 70%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -bottom-24 -left-16 h-56 w-56 rounded-full opacity-[0.10] blur-3xl"
            style={{
              background: 'radial-gradient(circle, #A78BFA, transparent 70%)',
            }}
          />
          <div className="relative flex flex-col items-start justify-between gap-6 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-xl font-semibold tracking-tight text-t-fg sm:text-2xl">
                Ready to put it into practice?
              </h2>
              <p className="mt-2 max-w-md text-[14px] leading-7 text-t-fg-muted">
                Browse live permissionless markets, or create your own on any
                metric you can measure.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/explore"
                className="group inline-flex items-center gap-2 rounded-lg bg-t-fg px-4 py-2.5 text-[13px] font-semibold text-t-page transition-opacity duration-200 hover:opacity-90"
              >
                Explore markets
                <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
              <Link
                href="/markets/create"
                className="inline-flex items-center gap-2 rounded-lg border border-t-stroke bg-t-page px-4 py-2.5 text-[13px] font-semibold text-t-fg transition-colors duration-200 hover:border-t-stroke-hover"
              >
                Create a market
              </Link>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
