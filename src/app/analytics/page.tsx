'use client'

import { Metadata } from 'next'
import AnalyticsDashboard from '@/components/Analytics/AnalyticsDashboard'

export default function AnalyticsPage() {
  return (
    <main className="min-h-screen">
      <AnalyticsDashboard />
    </main>
  )
}
