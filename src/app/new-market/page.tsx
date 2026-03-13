import React, { Suspense } from 'react';
import { CreateMarketV2Page } from '@/components/create-market-v2';

export const metadata = {
  title: 'New Market | Dexextra',
  description: 'Create a new prediction market',
};

export default function NewMarketRoute() {
  return (
    <Suspense>
      <CreateMarketV2Page />
    </Suspense>
  );
}
