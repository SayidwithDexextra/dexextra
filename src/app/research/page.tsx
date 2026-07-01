import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowUpRight, LineChart, Sparkles } from 'lucide-react';
import {
  getAllResearchPosts,
  RESEARCH_CONFIG,
} from '@/content/research';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

export const metadata: Metadata = {
  title: 'Research — Prediction-Market Intelligence',
  description:
    'Original prediction-market intelligence: smart-money consensus, whale flow, and a publicly graded settled scorecard.',
  alternates: { canonical: '/research' },
  // Stay out of the index until real, data-grounded posts are flowing.
  robots: RESEARCH_CONFIG.indexable
    ? undefined
    : { index: false, follow: false },
};

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export default function ResearchIndexPage() {
  const posts = getAllResearchPosts();

  return (
    <div className="dex-page-enter-up">
      {/* ───────────────────────── Hero ───────────────────────── */}
      <section className="relative overflow-hidden border-b border-t-stroke-sub bg-t-page">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-[-30%] h-[420px] w-[860px] max-w-[140%] -translate-x-1/2 rounded-full opacity-[0.12] blur-3xl"
            style={{
              background:
                'radial-gradient(circle, var(--t-accent), transparent 70%)',
            }}
          />
        </div>

        <div className="relative mx-auto max-w-5xl px-4 py-16 sm:py-20">
          <div className="inline-flex items-center gap-2 rounded-full border border-t-stroke-sub bg-t-card px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-t-fg-muted">
            <Sparkles className="h-3.5 w-3.5 text-t-accent" />
            Dexetera Research
          </div>

          <h1 className="mt-5 max-w-3xl text-4xl font-semibold leading-[1.08] tracking-tight text-t-fg sm:text-5xl">
            Prediction-market intelligence.
          </h1>

          <p className="mt-5 max-w-2xl text-[16px] leading-7 text-t-fg-muted">
            Original signals from prediction-market data — smart-money
            consensus, whale flow, and a publicly graded scorecard of past
            calls. Built to be cited.
          </p>
        </div>
      </section>

      {/* ───────────────────────── Posts ───────────────────────── */}
      <section className="mx-auto max-w-5xl px-4 py-12">
        {posts.length === 0 ? (
          <div className="rounded-xl border border-t-stroke-sub bg-t-card p-10 text-center">
            <LineChart className="mx-auto h-8 w-8 text-t-fg-muted opacity-50" />
            <h2 className="mt-4 text-lg font-semibold text-t-fg">
              Reports are on the way
            </h2>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-7 text-t-fg-muted">
              Weekly prediction-market intelligence will publish here once the
              data pipeline is live.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {posts.map((post) => (
              <li key={post.slug}>
                <Link
                  href={`/research/${post.slug}`}
                  className="group relative flex h-full flex-col justify-between overflow-hidden rounded-xl border border-t-stroke-sub bg-t-card p-5 transition-all duration-200 hover:-translate-y-0.5 hover:border-t-stroke-hover hover:bg-t-card-hover"
                >
                  <div>
                    <div className="mb-3 flex items-center gap-2">
                      <span className="rounded-full border border-t-stroke-sub px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-t-fg-muted">
                        {post.category}
                      </span>
                      {post.isSample && (
                        <span className="rounded-full border border-t-warning/40 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-t-warning">
                          Sample
                        </span>
                      )}
                      <span className="ml-auto text-[11px] text-t-fg-muted">
                        {formatDate(post.datePublished)}
                      </span>
                    </div>
                    <h2 className="text-[17px] font-semibold leading-snug tracking-tight text-t-fg transition-colors duration-200 group-hover:text-t-accent">
                      {post.title}
                    </h2>
                    <p className="mt-2 line-clamp-3 text-[13.5px] leading-relaxed text-t-fg-muted">
                      {post.excerpt}
                    </p>
                  </div>
                  <div className="mt-5 flex items-center gap-1 text-[12px] font-medium text-t-fg-muted transition-colors duration-200 group-hover:text-t-fg">
                    Read report
                    <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
