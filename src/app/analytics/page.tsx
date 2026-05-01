import { Suspense } from 'react'
import AnalyticsDashboard from '@/components/Analytics/AnalyticsDashboard'

export default function AnalyticsPage() {
  return (
    <main className="min-h-screen">
      <Suspense fallback={null}>
        <AnalyticsDashboard />
      </Suspense>
    </main>
  )
}
