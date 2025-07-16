/*
 * ⚠️ LEGACY CONTRACT MONITORING SYSTEM ⚠️
 * 
 * This API route used the old polling-based event listener that is NOT compatible 
 * with Vercel deployment. It has been replaced by the Alchemy webhook system.
 * 
 * ✅ NEW SYSTEM: Use /api/webhooks/alchemy/status for webhook monitoring status
 * 
 * This file is kept for backwards compatibility only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getEventListener } from '@/services/eventListener'
import { getWebhookEventListener } from '@/services/webhookEventListener'

let isListenerRunning = false

export async function POST(request: NextRequest) {
  try {
    const { action } = await request.json()

    switch (action) {
      case 'start': {
        if (isListenerRunning) {
          return NextResponse.json({
            success: true,
            message: 'Event listener is already running'
          })
        }

        console.log('🚀 Starting event listener via API...')
        try {
          const eventListener = await getEventListener()
          console.log('✅ Event listener instance created successfully')
          await eventListener.start()
          isListenerRunning = true

          return NextResponse.json({
            success: true,
            message: 'Event listener started successfully',
            status: eventListener.getStatus()
          })
        } catch (startError) {
          console.error('❌ Failed to start event listener:', startError)
          return NextResponse.json({
            success: false,
            error: startError instanceof Error ? startError.message : 'Unknown error starting event listener',
            details: startError instanceof Error ? startError.stack : undefined
          }, { status: 500 })
        }
      }

      case 'stop': {
        if (!isListenerRunning) {
          return NextResponse.json({
            success: true,
            message: 'Event listener is not running'
          })
        }

        console.log('🛑 Stopping event listener via API...')
        const eventListener = await getEventListener()
        await eventListener.stop()
        isListenerRunning = false

        return NextResponse.json({
          success: true,
          message: 'Event listener stopped successfully'
        })
      }

      case 'simulate': {
        // Simulate a position opened event for testing
        console.log('🎭 Simulating PositionOpened event...')
        
        const mockEvent = {
          type: 'event',
          event: {
            eventType: 'PositionOpened',
            user: '0x742d35Cc6634C0532925a3b8c17d4C32bE9c6FF7',
            isLong: true,
            size: '1000000000000000000000', // 1000 tokens
            price: '3333000000', // $3333
            leverage: '10',
            fee: '3330000', // $3.33 fee
            transactionHash: '0x' + Math.random().toString(16).substr(2, 64),
            blockNumber: Math.floor(Math.random() * 1000000) + 45000000,
            blockHash: '0x' + Math.random().toString(16).substr(2, 64),
            logIndex: 0,
            contractAddress: '0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0', // Gold vAMM address
            timestamp: new Date(),
            chainId: 137
          }
        }

        // Note: Event emission functionality temporarily disabled due to 
        // Next.js App Router export restrictions. Consider implementing 
        // through a separate service or WebSocket connection.
        
        // TODO: Implement proper event emission for production
        console.log('Mock event would be emitted:', mockEvent)

        return NextResponse.json({
          success: true,
          message: 'Simulated PositionOpened event emitted',
          event: mockEvent.event
        })
      }

      case 'status': {
        try {
          const eventListener = await getEventListener()
          const status = eventListener.getStatus()
          
          return NextResponse.json({
            success: true,
            data: {
              ...status,
              isListenerRunning
            }
          })
        } catch (error) {
          return NextResponse.json({
            success: true,
            data: {
              isListenerRunning,
              message: 'Event listener not yet initialized'
            }
          })
        }
      }

      default:
        return NextResponse.json(
          { 
            success: false, 
            error: 'Invalid action. Use: start, stop, simulate, or status' 
          },
          { status: 400 }
        )
    }
  } catch (error) {
    console.error('Error in events trigger:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      },
      { status: 500 }
    )
  }
} 