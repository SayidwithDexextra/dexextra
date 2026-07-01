import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react';
import { getAllLearnArticles, getLearnArticle } from '@/content/learn';
import ArticleJsonLd from '@/components/learn/ArticleJsonLd';
import ArticleCard from '@/components/learn/ArticleCard';
import ReadingProgress from '@/components/learn/ReadingProgress';
import ShareRow from '@/components/learn/ShareRow';
import { getCategoryStyle, withAlpha } from '@/components/learn/learnTaxonomy';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllLearnArticles().map((article) => ({ slug: article.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const article = getLearnArticle(slug);
  if (!article) {
    return { title: 'Article not found', robots: { index: false, follow: false } };
  }

  const url = `${baseUrl}/learn/${article.slug}`;
  const ogImage = `${baseUrl}/Dexicon/LOGO-Dexetera-square-gradient.svg`;

  return {
    title: article.title,
    description: article.description,
    keywords: article.keywords,
    alternates: { canonical: `/learn/${article.slug}` },
    openGraph: {
      title: article.title,
      description: article.description,
      url,
      type: 'article',
      siteName: 'Dexetera',
      publishedTime: article.datePublished,
      modifiedTime: article.dateModified || article.datePublished,
      images: [{ url: ogImage, alt: article.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: article.title,
      description: article.description,
      images: [ogImage],
      creator: '@dexeteralabs',
      site: '@dexeteralabs',
    },
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export default async function LearnArticlePage({ params }: PageProps) {
  const { slug } = await params;
  const article = getLearnArticle(slug);
  if (!article) notFound();

  const { Body } = article;
  const style = getCategoryStyle(article.category);
  const Icon = style.icon;
  const url = `${baseUrl}/learn/${article.slug}`;
  const related = getAllLearnArticles()
    .filter((a) => a.slug !== article.slug)
    .slice(0, 3);

  return (
    <div className="dex-page-enter-up">
      <ReadingProgress />
      <ArticleJsonLd article={article} />

      {/* ───────────────────────── Header ───────────────────────── */}
      <header className="relative overflow-hidden border-b border-t-stroke-sub bg-t-page">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-55%] h-[380px] w-[780px] max-w-[140%] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
            style={{
              background: `radial-gradient(circle, ${withAlpha(
                style.accent,
                'CC'
              )}, transparent 70%)`,
            }}
          />
        </div>

        <div className="relative mx-auto max-w-3xl px-4 pb-10 pt-8">
          <nav
            aria-label="Breadcrumb"
            className="mb-7 flex items-center gap-1.5 text-[12px] text-t-fg-muted"
          >
            <Link href="/" className="transition-colors hover:text-t-fg">
              Home
            </Link>
            <span aria-hidden>/</span>
            <Link href="/learn" className="transition-colors hover:text-t-fg">
              Learn
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate text-t-fg-muted">{article.category}</span>
          </nav>

          <div className="mb-5 flex items-center gap-3">
            <span
              aria-hidden
              className="flex h-11 w-11 items-center justify-center rounded-xl border"
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
            <div className="flex items-center gap-2">
              <span
                className="rounded-full border px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide"
                style={{
                  color: style.accent,
                  borderColor: withAlpha(style.accent, '40'),
                  backgroundColor: withAlpha(style.accent, '12'),
                }}
              >
                {article.category}
              </span>
              <span className="text-[11px] text-t-fg-muted">
                {article.readingMinutes} min read
              </span>
            </div>
          </div>

          <h1 className="text-3xl font-semibold leading-[1.12] tracking-tight text-t-fg sm:text-[2.6rem]">
            {article.title}
          </h1>

          <p className="mt-4 text-[17px] leading-8 text-t-fg-sub">
            {article.description}
          </p>

          <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-t-stroke-sub pt-5">
            <div className="flex items-center gap-3">
              <div
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full border border-t-stroke-sub bg-t-card text-[12px] font-semibold text-t-fg"
              >
                DX
              </div>
              <div className="text-[12px] leading-tight">
                <div className="font-medium text-t-fg">Dexetera</div>
                <div className="text-t-fg-muted">
                  Published {formatDate(article.datePublished)}
                </div>
              </div>
            </div>
            <ShareRow url={url} title={article.title} />
          </div>
        </div>
      </header>

      {/* ───────────────────────── Body ───────────────────────── */}
      <article className="mx-auto max-w-3xl px-4 py-10">
        <Body />

        {article.faqs && article.faqs.length > 0 && (
          <section
            aria-label="Frequently asked questions"
            className="mt-14 border-t border-t-stroke-sub pt-8"
          >
            <h2 className="mb-4 text-xl font-semibold tracking-tight text-t-fg">
              Frequently asked questions
            </h2>
            <div className="space-y-2.5">
              {article.faqs.map((faq) => (
                <details
                  key={faq.question}
                  className="group rounded-lg border border-t-stroke-sub bg-t-card transition-colors duration-200 hover:border-t-stroke-hover open:border-t-stroke-hover"
                >
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 p-4 text-[15px] font-semibold text-t-fg [&::-webkit-details-marker]:hidden">
                    {faq.question}
                    <ChevronDown className="h-4 w-4 shrink-0 text-t-fg-muted transition-transform duration-200 group-open:rotate-180" />
                  </summary>
                  <div className="px-4 pb-4 text-[14px] leading-7 text-t-fg-muted">
                    {faq.answer}
                  </div>
                </details>
              ))}
            </div>
          </section>
        )}

        <div className="mt-12 flex flex-wrap items-center justify-between gap-4 border-t border-t-stroke-sub pt-6">
          <Link
            href="/learn"
            className="group inline-flex items-center gap-1.5 text-[13px] text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
          >
            <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
            All guides
          </Link>
          <ShareRow url={url} title={article.title} />
        </div>
      </article>

      {/* ───────────────────────── Keep learning ───────────────────────── */}
      {related.length > 0 && (
        <section className="border-t border-t-stroke-sub bg-t-page">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <div className="mb-5 flex items-end justify-between gap-4">
              <h2 className="text-lg font-semibold tracking-tight text-t-fg">
                Keep learning
              </h2>
              <Link
                href="/learn"
                className="group inline-flex items-center gap-1 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
              >
                All guides
                <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
              </Link>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((a) => (
                <ArticleCard key={a.slug} article={a} />
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
