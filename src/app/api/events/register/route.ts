import { NextRequest, NextResponse } from 'next/server';
import { EventDatabase } from '@/lib/eventDatabase';
import { getEventListener } from '@/services/eventListener';
import { z } from 'zod';

const contractSchema = z.object({
  name: z.string(),
  address: z.string(),
  type: z.enum(['vAMM', 'Vault', 'Factory', 'Oracle', 'Token']),
  symbol: z.string().optional(),
});

const registerRequestSchema = z.object({
  contracts: z.array(contractSchema),
});

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const validatedData = registerRequestSchema.parse(body);

    console.log('📝 Registering contracts for event monitoring:', validatedData.contracts);

    const database = new EventDatabase();
    
    // Register each contract in the database
    for (const contract of validatedData.contracts) {
      try {
        await database.addContract({
          name: contract.name,
          address: contract.address.toLowerCase(),
          type: contract.type,
          network: 'base', // Assuming Base network
          isActive: true,
          description: `${contract.type} contract for ${contract.symbol || 'unknown'} market`,
        });
        
        console.log(`✅ Registered ${contract.type} contract: ${contract.address}`);
      } catch (error) {
        console.log(`ℹ️ Contract ${contract.address} might already be registered:`, error);
        // Continue with other contracts even if one fails
      }
    }

    // Get the event listener and restart it to pick up new contracts
    try {
      const eventListener = await getEventListener();
      
      // If the listener is running, restart it to pick up new contracts
      if (eventListener.getStatus().isRunning) {
        console.log('🔄 Restarting event listener to include new contracts...');
        await eventListener.stop();
        await eventListener.start();
        console.log('✅ Event listener restarted with new contracts');
      }
    } catch (error) {
      console.error('⚠️ Failed to restart event listener:', error);
      // Don't fail the request if listener restart fails
    }

    return NextResponse.json({
      success: true,
      message: `Successfully registered ${validatedData.contracts.length} contracts for event monitoring`,
      contracts: validatedData.contracts.map(c => ({
        name: c.name,
        address: c.address,
        type: c.type
      })),
    });

  } catch (error) {
    console.error('❌ Error registering contracts:', error);

    if (error instanceof z.ZodError) {
      return NextResponse.json({
        success: false,
        error: 'Invalid request data',
        details: error.errors,
      }, { status: 400 });
    }

    return NextResponse.json({
      success: false,
      error: 'Failed to register contracts for event monitoring',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
} 