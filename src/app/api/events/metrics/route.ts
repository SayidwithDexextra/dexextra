import { NextRequest, NextResponse } from 'next/server'
import { EventDatabase } from '@/lib/eventDatabase'
import { z } from 'zod'

const eventDatabase = new EventDatabase()

const MetricsQuerySchema = z.object({
  timeRange: z.enum(['1h', '24h', '7d']).optional().default('24h'),
})

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const query = Object.fromEntries(searchParams.entries())
    
    const { timeRange } = MetricsQuerySchema.parse(query)
    
    const metrics = await eventDatabase.getEventMetrics(timeRange)
    
    return NextResponse.json({
      success: true,
      data: metrics,
      timeRange
    })
  } catch (error) {
    console.error('Error fetching event metrics:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch event metrics' 
      },
      { status: 500 }
    )
  }
} 