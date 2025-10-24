import { Metadata } from 'next'
import { PortfolioOverview } from '@/components/Portfolio'

export const metadata: Metadata = {
  title: 'Portfolio | DexEtera',
  description: 'View and manage your DexEtera portfolio positions and performance',
  keywords: 'portfolio, trading, assets, performance, DexEtera',
}

export default function PortfolioPage() {
  return (
    <main>
      <PortfolioOverview />
    </main>
  )
}