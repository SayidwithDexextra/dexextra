import type { ResearchPost } from '@/content/research/types';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

/**
 * Article + Dataset + BreadcrumbList (+ optional FAQPage) JSON-LD for a research
 * post. Dataset is included because these posts are fundamentally structured
 * data — it maximizes rich-result and AI-answer eligibility.
 *
 * Skipped entirely for sample/non-indexable posts so placeholder content never
 * emits structured data.
 */
export default function ResearchJsonLd({ post }: { post: ResearchPost }) {
  if (post.isSample) return null;

  const url = `${baseUrl}/research/${post.slug}`;
  const image = `${baseUrl}/Dexicon/LOGO-Dexetera-square-gradient.svg`;

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: post.title,
    description: post.description,
    datePublished: post.datePublished,
    dateModified: post.dateModified || post.datePublished,
    articleSection: post.category,
    keywords: post.keywords.join(', '),
    image,
    inLanguage: 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Dexetera', url: baseUrl },
    publisher: {
      '@type': 'Organization',
      name: 'Dexetera',
      url: baseUrl,
      logo: { '@type': 'ImageObject', url: image },
    },
  };

  const datasetLd = {
    '@context': 'https://schema.org',
    '@type': 'Dataset',
    name: post.title,
    description: post.description,
    url,
    datePublished: post.datePublished,
    dateModified: post.dateModified || post.datePublished,
    creator: { '@type': 'Organization', name: 'Dexetera', url: baseUrl },
    isAccessibleForFree: true,
    ...(post.sources && post.sources.length > 0
      ? { citation: post.sources.join('; ') }
      : {}),
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Dexetera', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Research', item: `${baseUrl}/research` },
      { '@type': 'ListItem', position: 3, name: post.title, item: url },
    ],
  };

  const faqLd =
    post.faqs && post.faqs.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: post.faqs.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer },
          })),
        }
      : null;

  const blocks = [articleLd, datasetLd, breadcrumbs, ...(faqLd ? [faqLd] : [])];

  return (
    <>
      {blocks.map((block, i) => (
        <script
          key={i}
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(block) }}
        />
      ))}
    </>
  );
}
