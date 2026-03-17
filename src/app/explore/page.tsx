import { Suspense } from 'react';
import { Metadata } from 'next';
import { MarketList } from '@/components/MarketList';

export const metadata: Metadata = {
  title: 'Explore Markets | Dexetera',
  description: 'Discover trending markets and top performers on Dexetera',
};

export default function ExplorePage() {
  return (
    <div className="py-4 px-2 sm:px-4 dex-page-enter-up">
      <Suspense>
        <MarketList />
      </Suspense>
    </div>
  );
}
