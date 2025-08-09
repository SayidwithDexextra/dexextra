import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { getScalableEventMonitor } from '@/services/scalableEventMonitor'
import { env } from '@/lib/env'

/**
 * Scalable Webhook Handler
 * 
 * Processes webhooks from the signature-based monitoring system.
 * This single endpoint handles events from ALL contracts by monitoring
 * event signatures rather than specific contract addresses.
 * 
 * Scales to unlimited contract deployments without webhook limits.
 */

/**
 * Webhook signature verification
 */
function verifyAlchemySignature(
  rawBody: string,
  signature: string,
  signingKey: string
): boolean {
  try {
    const hmac = createHmac('sha256', signingKey);
    hmac.update(rawBody, 'utf8');
    const digest = hmac.digest('hex');
    
    return signature === digest;
  } catch (error) {
    console.error('❌ Signature verification failed:', error);
    return false;
  }
}

/**
 * Main scalable webhook handler
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-alchemy-signature');
    
     console.log('📨 Received Scalable Event Webhook...');

     console.log('🔑 ALCHEMY_WEBHOOK_SIGNING_KEY:', process.env.ALCHEMY_WEBHOOK_SIGNING_KEY)
     console.log('🔑 signature:', signature)
     console.log("env.NODE_ENV:", env.NODE_ENV)
    // Verify webhook signature in production
    if (env.NODE_ENV === 'production' && process.env.ALCHEMY_WEBHOOK_SIGNING_KEY && signature) {
      const isValidSignature = verifyAlchemySignature(
        rawBody,
        signature,
        process.env.ALCHEMY_WEBHOOK_SIGNING_KEY
      );
      
      if (!isValidSignature) {
        console.error('❌ Invalid webhook signature');
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
      }
       console.log('✅ Webhook signature verified');
    }

    const webhookData = JSON.parse(rawBody);
     console.log(`📡 Processing scalable webhook: ${webhookData.type}`);
     console.log(`📡 Processing scalable webhook: ${webhookData}`);

    // Get scalable event monitor instance
    const scalableMonitor = await getScalableEventMonitor();
    
    // Process the webhook event
    const result = await scalableMonitor.processWebhookEvent(webhookData);
    
    const processingTime = Date.now() - startTime;
    
     console.log(`✅ Scalable webhook processed successfully in ${processingTime}ms`);
     console.log(`📊 Results: ${result.processed} events, ${result.newContracts} new contracts`);

    return NextResponse.json({ 
      success: true, 
      processed: result.processed,
      newContracts: result.newContracts,
      processingTime: `${processingTime}ms`,
      scalable: true,
      contractsMonitored: 'Unlimited'
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    console.error('❌ Scalable webhook processing error:', error);
    
    return NextResponse.json(
      { 
        error: 'Scalable webhook processing failed',
        details: error instanceof Error ? error.message : 'Unknown error',
        processingTime: `${processingTime}ms`,
        scalable: true
      },
      { status: 500 }
    );
  }
}

/**
 * Health check endpoint for scalable monitoring
 */
export async function GET() {
  try {
    const scalableMonitor = await getScalableEventMonitor();
    const status = scalableMonitor.getStatus();
    
    return NextResponse.json({
      status: 'healthy',
      message: 'Scalable event monitoring is operational',
      timestamp: new Date().toISOString(),
      monitoring: status,
      features: [
        'Event signature monitoring',
        'Unlimited contract scaling', 
        'Automatic contract detection',
        'Real-time event processing'
      ]
    });
  } catch (error) {
    return NextResponse.json({
      status: 'unhealthy',
      message: 'Scalable event monitoring is not operational',
      error: error instanceof Error ? error.message : 'Unknown error',
      timestamp: new Date().toISOString()
    }, { status: 500 });
  }
} 