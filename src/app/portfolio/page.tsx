import { Metadata } from 'next'
import { PortfolioDashboard } from '@/components/PortfolioV2'

export const metadata: Metadata = {
  title: 'Portfolio | DexEtera',
  description: 'View and manage your DexEtera portfolio positions and performance',
  keywords: 'portfolio, trading, assets, performance, DexEtera',
}

export default function PortfolioPage() {
  return (
    <main>
      <PortfolioDashboard />
    </main>
  )
}