import { NextRequest, NextResponse } from 'next/server';
import { getServerlessMatchingEngine } from '@/lib/serverless-matching';

/**
 * POST /api/admin/matching/retroactive - Trigger retroactive matching for on-chain orders
 */
export async function POST(request: NextRequest) {
  try {
    const { metricId } = await request.json();

    if (!metricId) {
      return NextResponse.json(
        { error: 'metricId is required' },
        { status: 400 }
      );
    }

    console.log(`🔄 Triggering retroactive matching for metric: ${metricId}`);

    const matchingEngine = getServerlessMatchingEngine();
    const result = await matchingEngine.processRetroactiveMatching(metricId);

    if (result.success) {
      console.log(`✅ Retroactive matching completed: ${result.matches.length} matches`);
      
      return NextResponse.json({
        success: true,
        message: `Retroactive matching completed for ${metricId}`,
        matches: result.matches.length,
        matchDetails: result.matches.map(match => ({
          buyOrderId: match.buyOrderId,
          sellOrderId: match.sellOrderId,
          quantity: match.quantity,
          price: match.price,
          buyTrader: match.buyTraderAddress,
          sellTrader: match.sellTraderAddress
        }))
      });
    } else {
      return NextResponse.json(
        { 
          error: 'Retroactive matching failed',
          details: result.error
        },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('❌ Retroactive matching API error:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/admin/matching/retroactive - Get retroactive matching status
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricId = searchParams.get('metricId');

    if (!metricId) {
      return NextResponse.json(
        { error: 'metricId parameter is required' },
        { status: 400 }
      );
    }

    // Get current matching opportunities
    const matchingEngine = getServerlessMatchingEngine();
    const result = await matchingEngine.processRetroactiveMatching(metricId);

    return NextResponse.json({
      success: true,
      metricId,
      potentialMatches: result.matches.length,
      lastChecked: new Date().toISOString(),
      details: result.matches.map(match => ({
        buyOrderId: match.buyOrderId,
        sellOrderId: match.sellOrderId,
        quantity: match.quantity,
        price: match.price
      }))
    });

  } catch (error) {
    console.error('❌ Retroactive matching status error:', error);
    return NextResponse.json(
      { 
        error: 'Failed to check retroactive matching status',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}
