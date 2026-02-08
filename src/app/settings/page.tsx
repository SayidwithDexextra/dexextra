import Settings from '@/components/Settings/index'
import { Suspense } from 'react'

export default function SettingsPage() {
  return (
    <Suspense fallback={null}>
      <Settings />
    </Suspense>
  )
} 