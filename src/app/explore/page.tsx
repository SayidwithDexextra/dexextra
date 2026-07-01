import { Suspense } from 'react';
import { Metadata } from 'next';
import { MarketList } from '@/components/MarketList';
import MarketsIndexSection from './_seo/MarketsIndexSection';

export const metadata: Metadata = {
  title: 'Explore Markets',
  description:
    'Discover and trade trending permissionless futures markets on Dexetera — live odds, prices, and settlement details for every metric.',
  alternates: { canonical: '/explore' },
};

// Revalidate the server-rendered shell (incl. the crawlable market index) hourly
// so newly listed markets get internally linked without a rebuild.
export const revalidate = 3600;

export default function ExplorePage() {
  return (
    <div className="py-4 px-2 sm:px-4 dex-page-enter-up">
      <Suspense>
        <MarketList />
      </Suspense>
      <Suspense>
        <MarketsIndexSection />
      </Suspense>
    </div>
  );
}
