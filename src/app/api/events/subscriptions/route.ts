import { NextRequest, NextResponse } from 'next/server'
import { EventDatabase } from '@/lib/eventDatabase'
import { z } from 'zod'

const eventDatabase = new EventDatabase()

const SubscriptionSchema = z.object({
  contractAddress: z.string().min(1),
  eventName: z.string().min(1),
  userAddress: z.string().optional(),
  webhookUrl: z.string().url().optional(),
})

export async function GET() {
  try {
    const subscriptions = await eventDatabase.getActiveSubscriptions()
    
    return NextResponse.json({
      success: true,
      data: subscriptions
    })
  } catch (error) {
    console.error('Error fetching subscriptions:', error)
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to fetch subscriptions' 
      },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validatedData = SubscriptionSchema.parse(body)
    
    const subscription = await eventDatabase.storeSubscription({
      contractAddress: validatedData.contractAddress,
      eventName: validatedData.eventName,
      userAddress: validatedData.userAddress,
      isActive: true,
      webhookUrl: validatedData.webhookUrl,
    })
    
    return NextResponse.json({
      success: true,
      data: subscription
    }, { status: 201 })
  } catch (error) {
    console.error('Error creating subscription:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid subscription data',
          details: error.errors 
        },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Failed to create subscription' 
      },
      { status: 500 }
    )
  }
} 