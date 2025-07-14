import { useEffect, useState } from 'react'
import { SmartContractEvent } from '@/types/events'

interface UseRecentEventsResult {
  events: SmartContractEvent[]
  isLoading: boolean
  error: string | null
}

export function useRecentEvents(limit: number = 2): UseRecentEventsResult {
  const [events, setEvents] = useState<SmartContractEvent[]>([])
  const [isLoading, setIsLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()

    async function fetchEvents() {
      try {
        setIsLoading(true)
        const res = await fetch(`/api/events?limit=${limit}`, {
          signal: controller.signal
        })
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`)
        }
        const data = await res.json()
        setEvents(data.events || [])
      } catch (err) {
        if ((err as any).name !== 'AbortError') {
          setError((err as Error).message)
        }
      } finally {
        setIsLoading(false)
      }
    }

    fetchEvents()

    return () => controller.abort()
  }, [limit])

  return { events, isLoading, error }
} 