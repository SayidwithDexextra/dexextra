import { useEffect, useState, useCallback, useRef } from 'react'
import { SmartContractEvent } from '@/types/events'

interface EventSubscription {
  contractAddress?: string
  eventType?: string
  userAddress?: string
}

interface UseContractEventsResult {
  events: SmartContractEvent[]
  isConnected: boolean
  lastEvent: SmartContractEvent | null
  subscribe: (subscription: EventSubscription) => void
  unsubscribe: () => void
  clearEvents: () => void
}

export function useContractEvents(initialSubscription?: EventSubscription): UseContractEventsResult {
  const [events, setEvents] = useState<SmartContractEvent[]>([])
  const [isConnected, setIsConnected] = useState(false)
  const [lastEvent, setLastEvent] = useState<SmartContractEvent | null>(null)
  const eventSourceRef = useRef<EventSource | null>(null)
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null)
  const currentSubscriptionRef = useRef<EventSubscription | undefined>(initialSubscription)
  const isMountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!isMountedRef.current) return
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return
    }

    try {
      // Build URL with subscription parameters
      const params = new URLSearchParams()
      if (currentSubscriptionRef.current?.eventType) {
        params.append('eventType', currentSubscriptionRef.current.eventType)
      }
      if (currentSubscriptionRef.current?.contractAddress) {
        params.append('contractAddress', currentSubscriptionRef.current.contractAddress)
      }
      if (currentSubscriptionRef.current?.userAddress) {
        params.append('userAddress', currentSubscriptionRef.current.userAddress)
      }

      const sseUrl = `/api/events/stream?${params.toString()}`
       console.log('Connecting to SSE:', sseUrl)
      
      eventSourceRef.current = new EventSource(sseUrl)

      eventSourceRef.current.onopen = () => {
        if (!isMountedRef.current) return
         console.log('Connected to event stream')
        setIsConnected(true)
      }

      eventSourceRef.current.onmessage = (event) => {
        if (!isMountedRef.current) return
        
        try {
          const data = JSON.parse(event.data)
          
          if (data.type === 'event' && data.event) {
            const newEvent = data.event as SmartContractEvent
             console.log('Received event:', newEvent)
            setEvents(prev => [newEvent, ...prev.slice(0, 99)]) // Keep last 100 events
            setLastEvent(newEvent)
          } else if (data.type === 'welcome') {
             console.log('SSE Welcome:', data.message)
          } else if (data.type === 'heartbeat') {
             console.log('SSE Heartbeat:', data.timestamp)
          }
        } catch (error) {
          console.error('Error parsing SSE message:', error)
        }
      }

      eventSourceRef.current.onerror = (error) => {
        if (!isMountedRef.current) return
        console.error('SSE error:', error)
        setIsConnected(false)
        
        // Close current connection
        if (eventSourceRef.current) {
          eventSourceRef.current.close()
          eventSourceRef.current = null
        }
        
        // Attempt to reconnect after 3 seconds
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
        }
        reconnectTimeoutRef.current = setTimeout(() => {
          if (isMountedRef.current) {
            connect()
          }
        }, 3000)
      }
    } catch (error) {
      console.error('Failed to create SSE connection:', error)
    }
  }, [])

  const subscribe = useCallback((subscription: EventSubscription) => {
    if (!isMountedRef.current) return
     console.log('Subscribing to events:', subscription)
    currentSubscriptionRef.current = subscription
    
    // Close existing connection and reconnect with new subscription
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    
    setIsConnected(false)
    connect()
  }, [connect])

  const unsubscribe = useCallback(() => {
    if (!isMountedRef.current) return
     console.log('Unsubscribing from events')
    currentSubscriptionRef.current = undefined
    
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
      eventSourceRef.current = null
    }
    setIsConnected(false)
  }, [])

  const clearEvents = useCallback(() => {
    if (!isMountedRef.current) return
    setEvents([])
    setLastEvent(null)
  }, [])

  useEffect(() => {
    isMountedRef.current = true
    connect()

    return () => {
      isMountedRef.current = false
      
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      
      if (eventSourceRef.current) {
        eventSourceRef.current.close()
        eventSourceRef.current = null
      }
    }
  }, [connect])

  return {
    events,
    isConnected,
    lastEvent,
    subscribe,
    unsubscribe,
    clearEvents
  }
}

// Hook specifically for waiting for a MarketCreated event
export function useMarketCreationEvent(marketSymbol?: string) {
  const [isWaiting, setIsWaiting] = useState(false)
  const [marketCreatedEvent, setMarketCreatedEvent] = useState<SmartContractEvent | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const isMountedRef = useRef(true)
  
  const { lastEvent, isConnected, subscribe, unsubscribe } = useContractEvents()

  const startWaiting = useCallback((symbol: string, timeoutMs: number = 120000) => { // 2 minute timeout
    if (!isMountedRef.current) return
    
     console.log('Starting to wait for MarketCreated event for symbol:', symbol)
    setIsWaiting(true)
    setError(null)
    setMarketCreatedEvent(null)
    
    // Subscribe to MarketCreated events with the specific symbol
    subscribe({
      eventType: 'MarketCreated'
    })

    // Clear any existing timeout
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
    }

    // Set timeout
    timeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return
      setError('Deployment timeout: Market creation event not received within 2 minutes')
      setIsWaiting(false)
      unsubscribe()
    }, timeoutMs)
  }, [subscribe, unsubscribe])

  const stopWaiting = useCallback(() => {
    if (!isMountedRef.current) return
     console.log('Stopping wait for MarketCreated event')
    setIsWaiting(false)
    unsubscribe()
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
  }, [unsubscribe])

  // Listen for MarketCreated events
  useEffect(() => {
    if (!isMountedRef.current) return
    
    if (isWaiting && lastEvent && lastEvent.eventType === 'MarketCreated') {
      const event = lastEvent as any // MarketCreatedEvent
      
       console.log('Received MarketCreated event:', event)
      
      // Check if this is the market we're waiting for
      if (!marketSymbol || event.symbol === marketSymbol) {
         console.log('Market symbol matches, completing deployment')
        setMarketCreatedEvent(lastEvent)
        setIsWaiting(false)
        unsubscribe()
        
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
          timeoutRef.current = null
        }
      } else {
         console.log('Market symbol does not match, continuing to wait')
      }
    }
  }, [lastEvent, isWaiting, marketSymbol, unsubscribe])

  useEffect(() => {
    isMountedRef.current = true
    
    return () => {
      isMountedRef.current = false
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
        timeoutRef.current = null
      }
    }
  }, [])

  return {
    isWaiting,
    marketCreatedEvent,
    error,
    isConnected,
    startWaiting,
    stopWaiting
  }
} 