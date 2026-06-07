import type { MarketSeoData } from './marketSeoData';
import { SEO_BASE_URL } from './marketSeoData';

/**
 * Emits JSON-LD structured data for a market into the server-rendered HTML.
 * Helps search engines understand the page as a financial product and builds
 * a breadcrumb trail (Home → Markets → Symbol). Invisible to users.
 */
export default function MarketJsonLd({ data }: { data: MarketSeoData }) {
  const description =
    data.description?.trim() ||
    `${data.name} (${data.symbol}) is a permissionless futures market on Dexetera, settling ${data.settlementDateFormatted}.`;

  const financialProduct: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'FinancialProduct',
    name: data.name,
    alternateName: data.symbol,
    description,
    category: 'Futures',
    url: data.pageUrl,
    image: data.ogImageUrl,
    provider: {
      '@type': 'Organization',
      name: 'Dexetera',
      url: SEO_BASE_URL,
    },
  };

  const breadcrumbs = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      {
        '@type': 'ListItem',
        position: 1,
        name: 'Dexetera',
        item: SEO_BASE_URL,
      },
      {
        '@type': 'ListItem',
        position: 2,
        name: 'Markets',
        item: `${SEO_BASE_URL}/markets`,
      },
      {
        '@type': 'ListItem',
        position: 3,
        name: data.name,
        item: data.pageUrl,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(financialProduct) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }}
      />
    </>
  );
}
