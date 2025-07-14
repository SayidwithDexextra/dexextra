import { NextRequest } from 'next/server'
import { getEventListener } from '@/services/eventListener'
import { SmartContractEvent } from '@/types/events'

// Keep track of active connections
const connections = new Set<ReadableStreamDefaultController>()

// Event emitter for SSE
class SSEEventEmitter {
  private listeners: ((data: any) => void)[] = []

  on(callback: (data: any) => void) {
    this.listeners.push(callback)
  }

  emit(data: any) {
    this.listeners.forEach(callback => callback(data))
  }

  removeListener(callback: (data: any) => void) {
    const index = this.listeners.indexOf(callback)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }
}

const sseEventEmitter = new SSEEventEmitter()

// Initialize event listener integration
let eventListenerStarted = false

async function initializeEventListener() {
  if (eventListenerStarted) return

  try {
    console.log('🚀 Initializing blockchain event listener for SSE...')
    const eventListener = await getEventListener()
    
    // Start the event listener if not already running
    if (!eventListener.getStatus().isRunning) {
      await eventListener.start()
    }

    // Override the broadcastEvent method to also emit to SSE
    const originalBroadcastEvent = (eventListener as any).broadcastEvent.bind(eventListener)
    ;(eventListener as any).broadcastEvent = async function(event: SmartContractEvent) {
      // Call original WebSocket broadcast
      await originalBroadcastEvent(event)
      
      // Also emit to SSE clients
      console.log('📡 Broadcasting event to SSE clients:', event.eventType, event.contractAddress)
      sseEventEmitter.emit({
        type: 'event',
        event: event
      })
    }

    eventListenerStarted = true
    console.log('✅ Blockchain event listener integrated with SSE')
  } catch (error) {
    console.error('❌ Failed to initialize event listener:', error)
  }
}

// Mock function to simulate market creation events
function simulateMarketCreation(symbol: string) {
  setTimeout(() => {
    const mockEvent = {
      eventType: 'MarketCreated',
      marketId: `market_${Date.now()}`,
      symbol: symbol,
      vamm: '0x1234567890123456789012345678901234567890',
      vault: '0x9876543210987654321098765432109876543210',
      oracle: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
      collateralToken: '0x5678905678905678905678905678905678905678',
      transactionHash: `0x${Math.random().toString(16).substring(2, 18)}${'0'.repeat(48)}`,
      blockNumber: Math.floor(Math.random() * 1000000) + 18000000,
      timestamp: new Date().toISOString(),
      contractAddress: '0x1234567890123456789012345678901234567890',
      chainId: 1,
      logIndex: 0,
      blockHash: `0x${Math.random().toString(16).substring(2)}${'0'.repeat(40)}`
    }

    console.log('Emitting mock MarketCreated event:', mockEvent)
    eventEmitter.emit({
      type: 'event',
      event: mockEvent
    })
  }, 3000) // 3 second delay to simulate deployment
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const eventType = searchParams.get('eventType')
  const contractAddress = searchParams.get('contractAddress')
  const userAddress = searchParams.get('userAddress')

  console.log('SSE connection request:', { eventType, contractAddress, userAddress })

  // Initialize blockchain event listener
  await initializeEventListener()

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      connections.add(controller)

      // Send initial connection message
      const welcomeMessage = `data: ${JSON.stringify({
        type: 'welcome',
        message: 'Connected to blockchain event stream',
        eventType,
        contractAddress,
        userAddress,
        timestamp: new Date().toISOString()
      })}\n\n`
      
      controller.enqueue(new TextEncoder().encode(welcomeMessage))

      // Set up event listener
      const eventHandler = (data: any) => {
        try {
          const event = data.event as SmartContractEvent
          
          // Filter events based on criteria
          if (eventType && event?.eventType !== eventType) {
            return
          }
          
          if (contractAddress && event?.contractAddress?.toLowerCase() !== contractAddress.toLowerCase()) {
            return
          }

          // Filter by user address for position events
          if (userAddress) {
            const eventUserAddress = (event as any)?.user || (event as any)?.trader || null
            if (eventUserAddress && eventUserAddress.toLowerCase() !== userAddress.toLowerCase()) {
              return
            }
          }

          console.log('📤 Sending event to SSE client:', event.eventType, event.contractAddress)
          const message = `data: ${JSON.stringify(data)}\n\n`
          controller.enqueue(new TextEncoder().encode(message))
        } catch (error) {
          console.error('Error sending SSE message:', error)
        }
      }

      sseEventEmitter.on(eventHandler)

      // Note: Contract deployment simulation is now triggered manually via /api/events/trigger
      // This allows for more controlled testing and real-world deployment flows

      // Cleanup on connection close
      request.signal.addEventListener('abort', () => {
        connections.delete(controller)
        sseEventEmitter.removeListener(eventHandler)
        try {
          controller.close()
        } catch (error) {
          // Connection already closed
        }
      })

      // Send periodic heartbeat
      const heartbeat = setInterval(() => {
        try {
          const heartbeatMessage = `data: ${JSON.stringify({
            type: 'heartbeat',
            timestamp: new Date().toISOString()
          })}\n\n`
          controller.enqueue(new TextEncoder().encode(heartbeatMessage))
        } catch (error) {
          clearInterval(heartbeat)
        }
      }, 30000) // 30 seconds

      // Cleanup heartbeat on close
      request.signal.addEventListener('abort', () => {
        clearInterval(heartbeat)
      })
    },

    cancel() {
      // Clean up when stream is cancelled
    }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    }
  })
}

// Export function to emit events (for use by other parts of the app)
export function emitEvent(eventData: any) {
  sseEventEmitter.emit({
    type: 'event',
    event: eventData
  })
}

// Export the event emitter directly for advanced use cases
export { sseEventEmitter as eventEmitter } 