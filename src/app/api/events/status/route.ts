import { NextResponse } from 'next/server';
import { getEventListener } from '@/services/eventListener';
import { EventDatabase } from '@/lib/eventDatabase';

export async function GET() {
  try {
    console.log('📊 Checking event monitoring status...');
    
    const database = new EventDatabase();
    
    // Get contracts being monitored
    const contracts = await database.getDeployedVAMMContracts();

    console.log('🔍 Contracts being monitored:', contracts);
    
    // Get event listener status
    let eventListenerStatus = null;
    try {
      const eventListener = await getEventListener();
      eventListenerStatus = eventListener.getStatus();
    } catch (error) {
      console.error('Error getting event listener status:', error);
      eventListenerStatus = {
        isRunning: false,
        contractsMonitored: 0,
        wsConnected: false,
        clientsConnected: 0,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }

    return NextResponse.json({
      success: true,
      status: {
        eventListener: eventListenerStatus,
        contracts: {
          total: contracts.length,
          byType: contracts.reduce((acc, contract) => {
            acc[contract.type] = (acc[contract.type] || 0) + 1;
            return acc;
          }, {} as Record<string, number>),
          list: contracts.map(c => ({
            name: c.name,
            address: c.address,
            type: c.type
          }))
        },
        timestamp: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('❌ Error checking event monitoring status:', error);

    return NextResponse.json({
      success: false,
      error: 'Failed to get event monitoring status',
      details: error instanceof Error ? error.message : 'Unknown error',
    }, { status: 500 });
  }
} 