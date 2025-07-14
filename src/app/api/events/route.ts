import { NextRequest, NextResponse } from 'next/server'
import { EventDatabase } from '@/lib/eventDatabase'
import { EventFilter } from '@/types/events'
import { z } from 'zod'

const eventDatabase = new EventDatabase()

// Query parameters schema
const QuerySchema = z.object({
  contractAddress: z.string().optional(),
  eventType: z.string().optional(),
  eventTypes: z.string().optional().transform(str => str ? str.split(',') : undefined),
  userAddress: z.string().optional(),
  fromBlock: z.string().transform(Number).optional(),
  toBlock: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  offset: z.string().transform(Number).optional(),
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = Object.fromEntries(searchParams.entries())
    
    // Validate query parameters
    const validatedQuery = QuerySchema.parse(query)
    
    // Convert to EventFilter
    const filter: EventFilter = {
      contractAddress: validatedQuery.contractAddress,
      eventType: validatedQuery.eventType,
      eventTypes: validatedQuery.eventTypes,
      userAddress: validatedQuery.userAddress,
      fromBlock: validatedQuery.fromBlock,
      toBlock: validatedQuery.toBlock,
      limit: validatedQuery.limit || 50, // Default limit
      offset: validatedQuery.offset || 0,
    }

    // Query events
    const events = await eventDatabase.queryEvents(filter)

    return NextResponse.json({
      success: true,
      events: events, // Changed from 'data' to 'events' to match hook expectations
      count: events.length,
      filter
    })
  } catch (error) {
    console.error('Error fetching events:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid query parameters',
          details: error.errors 
        },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch events' 
      },
      { status: 500 }
    )
  }
} 