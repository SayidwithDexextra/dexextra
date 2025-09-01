import { NextRequest, NextResponse } from 'next/server';
import { env } from '@/lib/env';
import OrderBookWebhookProcessor from '@/services/orderBookWebhookProcessor';
import crypto from 'crypto';

/**
 * Verify Alchemy webhook signature
 */
function verifyAlchemySignature(
  rawBody: string,
  signature: string,
  signingKey: string
): boolean {
  try {
    const hmac = crypto.createHmac('sha256', signingKey);
    hmac.update(rawBody, 'utf8');
    const expectedSignature = hmac.digest('hex');
    return signature === expectedSignature;
  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
}

/**
 * OrderBook Webhook Handler
 * Processes Alchemy webhooks specifically for order book contract events
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  
  try {
    // Get raw body for signature verification
    const rawBody = await request.text();
    const signature = request.headers.get('x-alchemy-signature');
    
    console.log('📨 Received OrderBook Webhook...');
    console.log(`🔍 Webhook size: ${rawBody.length} bytes`);

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
    } else {
      console.log('🔓 Signature verification skipped (development mode)');
    }

    const webhookData = JSON.parse(rawBody);
    console.log(`📡 Processing webhook type: ${webhookData.type}`);

    // Initialize order book processor
    const processor = new OrderBookWebhookProcessor();
    
    // Process the webhook event
    const result = await processor.processWebhookEvent(webhookData);
    
    const processingTime = Date.now() - startTime;
    
    console.log(`✅ OrderBook webhook processed in ${processingTime}ms`);
    console.log(`📊 Results: ${result.processed} orders saved, ${result.errors.length} errors`);

    // Log any errors
    if (result.errors.length > 0) {
      console.error('⚠️ Processing errors:', result.errors);
    }

    // Log processed orders
    if (result.orders.length > 0) {
      console.log('📋 Processed orders:', result.orders.map(o => ({
        orderId: o.orderId,
        eventType: o.eventType,
        metricId: o.metricId,
        trader: o.trader.slice(0, 8) + '...',
        side: o.side === 0 ? 'BUY' : 'SELL',
        quantity: o.quantity,
        price: o.price
      })));
    }

    return NextResponse.json({ 
      success: true, 
      processed: result.processed,
      ordersFound: result.orders.length,
      errors: result.errors.length,
      processingTime: `${processingTime}ms`,
      webhook: 'orderbook',
      orders: result.orders.map(o => ({
        orderId: o.orderId,
        eventType: o.eventType,
        txHash: o.txHash,
        blockNumber: o.blockNumber
      }))
    });

  } catch (error) {
    const processingTime = Date.now() - startTime;
    const errorMessage = (error as Error).message;
    
    console.error('❌ OrderBook webhook processing failed:', errorMessage);
    console.error('📊 Processing time before failure:', `${processingTime}ms`);

    return NextResponse.json({ 
      success: false, 
      error: 'Webhook processing failed',
      details: errorMessage,
      processingTime: `${processingTime}ms`,
      webhook: 'orderbook'
    }, { status: 500 });
  }
}

/**
 * GET endpoint for webhook status and testing
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const test = url.searchParams.get('test') === 'true';

    if (test) {
      // Test the processor with a mock event
      const processor = new OrderBookWebhookProcessor();
      
      const mockEvent = {
        type: 'GRAPHQL',
        event: {
          data: {
            block: {
              logs: []
            }
          }
        }
      };

      const result = await processor.processWebhookEvent(mockEvent);

      return NextResponse.json({
        status: 'OrderBook webhook endpoint operational',
        test: true,
        processorTest: {
          success: true,
          processed: result.processed,
          errors: result.errors.length
        },
        endpoint: '/api/webhooks/orderbook',
        methods: ['POST', 'GET'],
        timestamp: new Date().toISOString()
      });
    }

    return NextResponse.json({
      status: 'OrderBook webhook endpoint operational',
      endpoint: '/api/webhooks/orderbook',
      methods: ['POST', 'GET'],
      supportedEvents: [
        'OrderPlaced',
        'OrderCancelled', 
        'OrderExecuted',
        'OrderAdded',
        'OrderMatched'
      ],
      contracts: [
        'OrderRouter: 0xfB46c35282634b578BfAd7a40A28F089B5f8430A',
        'OrderBook: 0x07d317C87E6d8AF322463aCF024f1e28D38F6117'
      ],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ OrderBook webhook GET failed:', error);
    return NextResponse.json({ 
      error: 'Failed to get webhook status',
      details: (error as Error).message
    }, { status: 500 });
  }
}
