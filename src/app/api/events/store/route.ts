import { NextRequest, NextResponse } from 'next/server';
import { EventDatabase } from '@/lib/eventDatabase';
import { SmartContractEvent } from '@/types/events';
import { z } from 'zod';

const eventDatabase = new EventDatabase();

// Schema for storing events
const StoreEventsSchema = z.object({
  events: z.array(z.object({
    transactionHash: z.string(),
    blockNumber: z.number(),
    blockHash: z.string(),
    logIndex: z.number(),
    contractAddress: z.string(),
    eventType: z.string(),
    timestamp: z.string(),
    chainId: z.number(),
    // Additional event-specific data
    user: z.string().optional(),
    trader: z.string().optional(),
    isLong: z.boolean().optional(),
    size: z.string().optional(),
    price: z.string().optional(),
    leverage: z.string().optional(),
    fee: z.string().optional(),
    pnl: z.string().optional(),
    liquidator: z.string().optional(),
    amount: z.string().optional(),
    // Allow additional properties for flexibility
  }).passthrough()),
  source: z.string().optional().default('blockchain'),
  contractAddress: z.string().optional(),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = StoreEventsSchema.parse(body);
    
    console.log('💾 Storing events from blockchain fallback:', {
      eventCount: validatedData.events.length,
      source: validatedData.source,
      contractAddress: validatedData.contractAddress
    });

    const storedEvents = [];
    const skippedEvents = [];
    const errorEvents = [];

    // Store each event
    for (const eventData of validatedData.events) {
      try {
        // Handle timestamp conversion properly
        let timestamp: Date;
        const eventTimestamp = eventData.timestamp as any;
        
        if (eventTimestamp instanceof Date) {
          // Already a Date object
          timestamp = eventTimestamp;
        } else if (typeof eventTimestamp === 'string') {
          // String timestamp (ISO string or other format)
          timestamp = new Date(eventTimestamp);
        } else if (typeof eventTimestamp === 'number') {
          // Unix timestamp (seconds or milliseconds)
          timestamp = new Date(eventTimestamp);
        } else {
          // Fallback to current time if invalid
          console.warn('Invalid timestamp format, using current time:', eventTimestamp);
          timestamp = new Date();
        }

        // Validate the resulting Date object
        if (isNaN(timestamp.getTime())) {
          console.warn('Invalid timestamp resulted in NaN, using current time:', eventTimestamp);
          timestamp = new Date();
        }

        // Create a clean SmartContractEvent object with core properties
        const smartContractEvent: SmartContractEvent = {
          transactionHash: eventData.transactionHash,
          blockNumber: eventData.blockNumber,
          blockHash: eventData.blockHash,
          logIndex: eventData.logIndex,
          contractAddress: eventData.contractAddress,
          eventType: eventData.eventType as any,
          timestamp,
          chainId: eventData.chainId,
          // Add event-specific properties based on event type
          ...(eventData.user && { user: eventData.user }),
          ...(eventData.trader && { trader: eventData.trader }),
          ...(eventData.isLong !== undefined && { isLong: eventData.isLong }),
          ...(eventData.size && { size: eventData.size }),
          ...(eventData.price && { price: eventData.price }),
          ...(eventData.leverage && { leverage: eventData.leverage }),
          ...(eventData.fee && { fee: eventData.fee }),
          ...(eventData.pnl && { pnl: eventData.pnl }),
          ...(eventData.liquidator && { liquidator: eventData.liquidator }),
          ...(eventData.amount && { amount: eventData.amount }),
        } as SmartContractEvent;

        // Store the event in the database
        await eventDatabase.storeEvent(smartContractEvent);
        storedEvents.push(eventData.transactionHash);
        
      } catch (error) {
        console.error('Error storing individual event:', error);
        
        // Check if it's a duplicate error (expected behavior)
        if (error instanceof Error && error.message.includes('already exists')) {
          skippedEvents.push(eventData.transactionHash);
        } else {
          errorEvents.push({
            transactionHash: eventData.transactionHash,
            error: error instanceof Error ? error.message : 'Unknown error'
          });
        }
      }
    }

    const summary = {
      total: validatedData.events.length,
      stored: storedEvents.length,
      skipped: skippedEvents.length,
      errors: errorEvents.length,
    };

    console.log('📊 Event storage summary:', summary);

    return NextResponse.json({
      success: true,
      message: `Successfully processed ${validatedData.events.length} events`,
      summary,
      storedEvents,
      skippedEvents,
      errorEvents: errorEvents.length > 0 ? errorEvents : undefined,
    });

  } catch (error) {
    console.error('❌ Error in store events API:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid event data format',
          details: error.errors 
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to store events',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// GET endpoint to check if events exist in the database
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const contractAddress = searchParams.get('contractAddress');
    const transactionHashes = searchParams.get('transactionHashes')?.split(',');
    
    if (!contractAddress) {
      return NextResponse.json(
        { success: false, error: 'contractAddress is required' },
        { status: 400 }
      );
    }

    // Query existing events for the contract
    const events = await eventDatabase.queryEvents({
      contractAddress,
      limit: 100,
    });

    const existingHashes = new Set(events.map(e => e.transactionHash));
    
    return NextResponse.json({
      success: true,
      contractAddress,
      existingEventCount: events.length,
      existingHashes: Array.from(existingHashes),
      requestedHashes: transactionHashes || [],
      duplicateCount: transactionHashes ? transactionHashes.filter(h => existingHashes.has(h)).length : 0,
    });

  } catch (error) {
    console.error('❌ Error checking existing events:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to check existing events',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 