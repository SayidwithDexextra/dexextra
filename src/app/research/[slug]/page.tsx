import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import {
  getAllResearchPosts,
  getResearchPost,
  isResearchPostIndexable,
} from '@/content/research';
import { formatDate, formatDateTime } from '@/content/research/format';
import ResearchSegments from '@/components/research/ResearchSegments';
import ResearchJsonLd from '@/components/research/ResearchJsonLd';
import SampleBanner from '@/components/research/SampleBanner';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export function generateStaticParams() {
  return getAllResearchPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getResearchPost(slug);
  if (!post) {
    return { title: 'Report not found', robots: { index: false, follow: false } };
  }

  const url = `${baseUrl}/research/${post.slug}`;
  const ogImage = `${baseUrl}/Dexicon/LOGO-Dexetera-square-gradient.svg`;
  const indexable = isResearchPostIndexable(post);

  return {
    title: post.title,
    description: post.description,
    keywords: post.keywords,
    alternates: { canonical: `/research/${post.slug}` },
    robots: indexable ? undefined : { index: false, follow: false },
    openGraph: {
      title: post.title,
      description: post.description,
      url,
      type: 'article',
      siteName: 'Dexetera',
      publishedTime: post.datePublished,
      modifiedTime: post.dateModified || post.datePublished,
      images: [{ url: ogImage, alt: post.title }],
    },
    twitter: {
      card: 'summary_large_image',
      title: post.title,
      description: post.description,
      images: [ogImage],
      creator: '@dexeteralabs',
      site: '@dexeteralabs',
    },
  };
}

export default async function ResearchPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getResearchPost(slug);
  if (!post) notFound();

  return (
    <div className="dex-page-enter-up">
      <ResearchJsonLd post={post} />

      {/* ───────────────────────── Header ───────────────────────── */}
      <header className="relative overflow-hidden border-b border-t-stroke-sub bg-t-page">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-50%] h-[360px] w-[760px] max-w-[140%] -translate-x-1/2 rounded-full opacity-[0.10] blur-3xl"
            style={{
              background:
                'radial-gradient(circle, var(--t-accent), transparent 70%)',
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
            <Link href="/research" className="transition-colors hover:text-t-fg">
              Research
            </Link>
            <span aria-hidden>/</span>
            <span className="truncate text-t-fg-muted">{post.category}</span>
          </nav>

          <div className="mb-4 flex items-center gap-2">
            <span className="rounded-full border border-t-stroke-sub bg-t-card px-2.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-t-fg-muted">
              {post.category}
            </span>
            {typeof post.issueNumber === 'number' && post.issueNumber > 0 && (
              <span className="text-[11px] text-t-fg-muted">
                Issue #{post.issueNumber}
              </span>
            )}
          </div>

          <h1 className="text-3xl font-semibold leading-[1.12] tracking-tight text-t-fg sm:text-[2.4rem]">
            {post.title}
          </h1>

          <p className="mt-4 text-[16px] leading-7 text-t-fg-muted">
            {post.description}
          </p>

          <p className="mt-5 border-t border-t-stroke-sub pt-4 text-[12px] text-t-fg-muted">
            Published {formatDate(post.datePublished)} · Data as of{' '}
            {formatDateTime(post.dataAsOf)}
          </p>
        </div>
      </header>

      {/* ───────────────────────── Body ───────────────────────── */}
      <article className="mx-auto max-w-3xl px-4 py-10">
        {post.isSample && (
          <div className="mb-10">
            <SampleBanner />
          </div>
        )}

        <ResearchSegments segments={post.segments} />

        {post.faqs && post.faqs.length > 0 && (
          <section
            aria-label="Frequently asked questions"
            className="mt-12 border-t border-t-stroke-sub pt-8"
          >
            <h2 className="mb-4 text-xl font-semibold tracking-tight text-t-fg">
              Frequently asked questions
            </h2>
            <dl className="space-y-3">
              {post.faqs.map((faq) => (
                <div
                  key={faq.question}
                  className="rounded-lg border border-t-stroke-sub bg-t-card p-4"
                >
                  <dt className="text-[15px] font-semibold text-t-fg">
                    {faq.question}
                  </dt>
                  <dd className="mt-1.5 text-[14px] leading-7 text-t-fg-muted">
                    {faq.answer}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        )}

        {post.sources && post.sources.length > 0 && (
          <section className="mt-10 border-t border-t-stroke-sub pt-6">
            <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-t-fg-muted">
              Methodology &amp; sources
            </h2>
            <ul className="space-y-1 text-[12px] leading-6 text-t-fg-muted">
              {post.sources.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        )}

        <div className="mt-12 flex items-center justify-between gap-4 border-t border-t-stroke-sub pt-6">
          <Link
            href="/research"
            className="group inline-flex items-center gap-1.5 text-[13px] text-t-fg-muted transition-colors duration-200 hover:text-t-fg"
          >
            <ArrowLeft className="h-4 w-4 transition-transform duration-200 group-hover:-translate-x-0.5" />
            All reports
          </Link>
          <Link
            href="/explore"
            className="group inline-flex items-center gap-1.5 text-[13px] font-semibold text-t-fg transition-colors duration-200 hover:text-t-accent"
          >
            Explore markets
            <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
        </div>
      </article>
    </div>
  );
}
