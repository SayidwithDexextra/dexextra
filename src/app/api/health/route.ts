import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';

interface HealthCheckResult {
  service: string;
  status: 'healthy' | 'degraded' | 'unhealthy';
  responseTime: number;
  details?: any;
  error?: string;
  lastCheck: string;
}

interface SystemHealth {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  services: HealthCheckResult[];
  summary: {
    totalServices: number;
    healthyServices: number;
    degradedServices: number;
    unhealthyServices: number;
  };
}

/**
 * GET /api/health - Serverless system health check endpoint
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const startTime = Date.now();
  const { searchParams } = new URL(request.url);
  const detailed = searchParams.get('detailed') === 'true';
  const service = searchParams.get('service');

  try {
    // If checking specific service
    if (service) {
      let result: HealthCheckResult;
      
      switch (service.toLowerCase()) {
        case 'database':
          result = await checkDatabase();
          break;
        case 'serverless-matching':
          result = await checkServerlessMatching();
          break;
        case 'settlement-processor':
          result = await checkSettlementProcessor();
          break;
        default:
          return NextResponse.json(
            { error: `Unknown service: ${service}` },
            { status: 400 }
          );
      }
      
      return NextResponse.json(result);
    }

    // Full system health check
    const checks = await Promise.allSettled([
      checkDatabase(),
      checkServerlessMatching(),
      checkSettlementProcessor()
    ]);

    const services: HealthCheckResult[] = checks.map((check, index) => {
      if (check.status === 'fulfilled') {
        return check.value;
      } else {
        const serviceNames = ['Database', 'Serverless Matching', 'Settlement Processor'];
        return {
          service: serviceNames[index],
          status: 'unhealthy' as const,
          responseTime: 0,
          error: check.reason?.message || 'Unknown error',
          lastCheck: new Date().toISOString()
        };
      }
    });

    const summary = {
      totalServices: services.length,
      healthyServices: services.filter(s => s.status === 'healthy').length,
      degradedServices: services.filter(s => s.status === 'degraded').length,
      unhealthyServices: services.filter(s => s.status === 'unhealthy').length
    };

    // Determine overall system status
    let systemStatus: 'healthy' | 'degraded' | 'unhealthy';
    if (summary.unhealthyServices > 0) {
      systemStatus = 'unhealthy';
    } else if (summary.degradedServices > 0) {
      systemStatus = 'degraded';
    } else {
      systemStatus = 'healthy';
    }

    const health: SystemHealth = {
      status: systemStatus,
      timestamp: new Date().toISOString(),
      services: detailed ? services : services.map(s => ({
        service: s.service,
        status: s.status,
        responseTime: s.responseTime,
        lastCheck: s.lastCheck
      })),
      summary
    };

    const statusCode = systemStatus === 'healthy' ? 200 : 
                      systemStatus === 'degraded' ? 200 : 503;

    return NextResponse.json(health, { status: statusCode });

  } catch (error) {
    console.error('Health check error:', error);
    return NextResponse.json(
      {
        status: 'unhealthy',
        error: 'Health check failed',
        timestamp: new Date().toISOString(),
        responseTime: Date.now() - startTime
      },
      { status: 500 }
    );
  }
}

/**
 * Check Database (Supabase) health
 */
async function checkDatabase(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    // Simple query to test database connectivity
    const { data, error } = await supabaseAdmin
      .from('orderbook_markets')
      .select('id')
      .limit(1);

    if (error) {
      throw error;
    }

    return {
      service: 'Database',
      status: 'healthy',
      responseTime: Date.now() - startTime,
      details: {
        connection: 'successful',
        queryTime: Date.now() - startTime
      },
      lastCheck: new Date().toISOString()
    };

  } catch (error) {
    return {
      service: 'Database',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: (error as Error).message,
      lastCheck: new Date().toISOString()
    };
  }
}

/**
 * Check Serverless Matching Engine health
 */
async function checkServerlessMatching(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    // Test that we can initialize the serverless matching engine
    const { getServerlessMatchingEngine } = await import('@/lib/serverless-matching');
    const matchingEngine = getServerlessMatchingEngine();

    // Verify we have required environment variables
    const requiredVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      throw new Error(`Missing environment variables: ${missingVars.join(', ')}`);
    }

    return {
      service: 'Serverless Matching',
      status: 'healthy',
      responseTime: Date.now() - startTime,
      details: {
        initialization: 'successful',
        environment: 'configured'
      },
      lastCheck: new Date().toISOString()
    };

  } catch (error) {
    return {
      service: 'Serverless Matching',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: (error as Error).message,
      lastCheck: new Date().toISOString()
    };
  }
}

/**
 * Check Settlement Processor health
 */
async function checkSettlementProcessor(): Promise<HealthCheckResult> {
  const startTime = Date.now();
  
  try {
    // Import and check settlement processor status
    const { settlementProcessor } = await import('@/lib/settlement-processor');
    const status = settlementProcessor.getStatus();

    // Verify required environment variables
    const requiredVars = [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SETTLEMENT_PRIVATE_KEY'
    ];

    const missingVars = requiredVars.filter(varName => !process.env[varName]);
    
    if (missingVars.length > 0) {
      return {
        service: 'Settlement Processor',
        status: 'degraded',
        responseTime: Date.now() - startTime,
        error: `Missing environment variables: ${missingVars.join(', ')}`,
        details: {
          isRunning: status.isRunning,
          isProcessing: status.isProcessing,
          missingVars
        },
        lastCheck: new Date().toISOString()
      };
    }

    return {
      service: 'Settlement Processor',
      status: status.isRunning ? 'healthy' : 'degraded',
      responseTime: Date.now() - startTime,
      details: {
        isRunning: status.isRunning,
        isProcessing: status.isProcessing,
        environment: 'configured'
      },
      lastCheck: new Date().toISOString()
    };

  } catch (error) {
    return {
      service: 'Settlement Processor',
      status: 'unhealthy',
      responseTime: Date.now() - startTime,
      error: (error as Error).message,
      lastCheck: new Date().toISOString()
    };
  }
}