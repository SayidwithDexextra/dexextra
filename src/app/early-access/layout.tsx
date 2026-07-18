import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Dexetera — Early Access Rewards',
  description:
    'What you unlock by getting in early: founding rate, free marketing, a discounted token drop, Smart Money Prediction Market access, and a 1:1 deposit match.',
  robots: { index: false, follow: false },
}

export default function EarlyAccessLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
