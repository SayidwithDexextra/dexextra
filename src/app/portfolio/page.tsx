import { Metadata } from 'next'
import { PortfolioOverview } from '@/components/Portfolio'

export const metadata: Metadata = {
  title: 'Portfolio | DexEtra',
  description: 'View and manage your DexEtra portfolio positions and performance',
  keywords: 'portfolio, trading, assets, performance, DexEtra',
}

export default function PortfolioPage() {
  return (
    <main>
      <PortfolioOverview />
    </main>
  )
}