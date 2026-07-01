import type { LearnArticle } from '@/content/learn/types';

const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://dexetera.org';

/**
 * Emits Article + BreadcrumbList (+ optional FAQPage) JSON-LD for a learn post.
 * Improves rich-result eligibility and gives AI answer engines (AI Overviews,
 * LLMs) structured, citable facts. Invisible to users.
 */
export default function ArticleJsonLd({ article }: { article: LearnArticle }) {
  const url = `${baseUrl}/learn/${article.slug}`;
  const ogImage = `${baseUrl}/Dexicon/LOGO-Dexetera-square-gradient.svg`;

  const articleLd = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.description,
    datePublished: article.datePublished,
    dateModified: article.dateModified || article.datePublished,
    articleSection: article.category,
    keywords: article.keywords.join(', '),
    image: ogImage,
    inLanguage: 'en',
    mainEntityOfPage: { '@type': 'WebPage', '@id': url },
    author: { '@type': 'Organization', name: 'Dexetera', url: baseUrl },
    publisher: {
      '@type': 'Organization',
      name: 'Dexetera',
      url: baseUrl,
      logo: { '@type': 'ImageObject', url: ogImage },
    },
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Dexetera', item: baseUrl },
      { '@type': 'ListItem', position: 2, name: 'Learn', item: `${baseUrl}/learn` },
      { '@type': 'ListItem', position: 3, name: article.title, item: url },
    ],
  };

  const faqLd =
    article.faqs && article.faqs.length > 0
      ? {
          '@context': 'https://schema.org',
          '@type': 'FAQPage',
          mainEntity: article.faqs.map((f) => ({
            '@type': 'Question',
            name: f.question,
            acceptedAnswer: { '@type': 'Answer', text: f.answer },
          })),
        }
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(articleLd) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
      {faqLd && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(faqLd) }}
        />
      )}
    </>
  );
}
