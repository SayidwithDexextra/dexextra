import { NextRequest, NextResponse } from 'next/server';
import { getDefaultBlockchainQuerier } from '@/lib/blockchainEventQuerier';
import { z } from 'zod';

// Query parameters schema
const QuerySchema = z.object({
  contractAddress: z.string().min(1, 'Contract address is required'),
  eventTypes: z.string().optional().transform(str => str ? str.split(',') : undefined),
  userAddress: z.string().optional(),
  fromBlock: z.string().transform(Number).optional(),
  toBlock: z.string().transform(Number).optional(),
  limit: z.string().transform(Number).optional(),
  maxBlockRange: z.string().transform(Number).optional(),
});

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const query = Object.fromEntries(searchParams.entries());
    
    // Validate query parameters
    const validatedQuery = QuerySchema.parse(query);
    
    console.log('🔍 Blockchain Events API: Querying events with params:', validatedQuery);
    
    // Get blockchain querier
    const querier = getDefaultBlockchainQuerier();
    
    // Test connection first
    const connectionStatus = await querier.testConnection();
    if (!connectionStatus.connected) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Blockchain connection failed',
          details: connectionStatus.error,
          connectionStatus
        },
        { status: 503 }
      );
    }
    
    // Query events
    const result = await querier.queryVAMMEvents({
      contractAddress: validatedQuery.contractAddress,
      eventTypes: validatedQuery.eventTypes,
      userAddress: validatedQuery.userAddress,
      fromBlock: validatedQuery.fromBlock,
      toBlock: validatedQuery.toBlock,
      limit: validatedQuery.limit || 50,
      maxBlockRange: validatedQuery.maxBlockRange || 10000,
    });
    
    if (result.error) {
      return NextResponse.json(
        { 
          success: false, 
          error: result.error,
          queryResult: result,
          connectionStatus
        },
        { status: 500 }
      );
    }
    
    console.log('✅ Blockchain Events API: Successfully fetched', result.events.length, 'events');
    
    return NextResponse.json({
      success: true,
      data: result.events,
      metadata: {
        count: result.events.length,
        fromBlock: result.fromBlock,
        toBlock: result.toBlock,
        queryTime: result.queryTime,
        totalLogs: result.totalLogs,
        chainId: connectionStatus.chainId,
        networkName: connectionStatus.networkName,
        blockNumber: connectionStatus.blockNumber,
        responseTime: connectionStatus.responseTime,
      },
      filter: validatedQuery,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Blockchain Events API error:', error);
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { 
          success: false, 
          error: 'Invalid query parameters',
          details: error.errors 
        },
        { status: 400 }
      );
    }
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Connection test endpoint
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action } = body;
    
    if (action === 'test-connection') {
      console.log('🔧 Testing blockchain connection...');
      
      const querier = getDefaultBlockchainQuerier();
      const connectionStatus = await querier.testConnection();
      
      return NextResponse.json({
        success: true,
        connectionStatus,
        timestamp: new Date().toISOString()
      });
    }
    
    if (action === 'query-sample') {
      const { contractAddress, limit = 5 } = body;
      
      if (!contractAddress) {
        return NextResponse.json(
          { success: false, error: 'contractAddress is required' },
          { status: 400 }
        );
      }
      
      console.log('🔍 Querying sample events for:', contractAddress);
      
      const querier = getDefaultBlockchainQuerier();
      const result = await querier.queryVAMMEvents({
        contractAddress,
        eventTypes: ['PositionOpened', 'PositionClosed', 'PositionLiquidated'],
        limit: Number(limit),
        maxBlockRange: 5000 // Smaller range for sample
      });
      
      return NextResponse.json({
        success: true,
        data: result.events,
        metadata: {
          count: result.events.length,
          queryTime: result.queryTime,
          fromBlock: result.fromBlock,
          toBlock: result.toBlock,
        },
        timestamp: new Date().toISOString()
      });
    }
    
    return NextResponse.json(
      { success: false, error: 'Invalid action' },
      { status: 400 }
    );
    
  } catch (error) {
    console.error('❌ Blockchain Events API POST error:', error);
    
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
} 