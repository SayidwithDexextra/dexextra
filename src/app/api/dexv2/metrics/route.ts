import { NextRequest, NextResponse } from 'next/server';
import DexV2EventDatabase from '@/lib/dexV2EventDatabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const metricId = searchParams.get('metric_id');
    const category = searchParams.get('category');

    const db = new DexV2EventDatabase();

    if (metricId) {
      // Get specific metric
      const metric = await db.getMetric(metricId);
      
      if (!metric) {
        return NextResponse.json(
          { error: 'Metric not found' },
          { status: 404 }
        );
      }

      // Get associated VAMMs for this metric
      const vamms = await db.getVAMMsByMetric(metricId);
      
      return NextResponse.json({
        success: true,
        data: {
          metric: {
            metricId: metric.metricId,
            name: metric.name,
            description: metric.description,
            category: metric.category,
            dataSource: metric.dataSource,
            updateFrequency: metric.updateFrequency,
            settlementPeriod: metric.settlementPeriod,
            requiresOracle: metric.requiresOracle,
            registeredBy: metric.registeredBy,
            registeredAt: metric.registeredAt.toISOString(),
            iconUrl: metric.iconUrl,
            websiteUrl: metric.websiteUrl,
            documentationUrl: metric.documentationUrl
          },
          vamms: vamms.map(vamm => ({
            vammAddress: vamm.vammAddress,
            category: vamm.category,
            maxLeverage: vamm.maxLeverage.toString(),
            tradingFee: vamm.tradingFee.toString(),
            fundingRate: vamm.fundingRate.toString(),
            minCollateral: vamm.minCollateral.toString(),
            isActive: vamm.isActive,
            deployer: vamm.deployer,
            deployedAt: vamm.deployedAt.toISOString(),
            deploymentTx: vamm.deploymentTx,
            deploymentBlock: vamm.deploymentBlock,
            factoryAddress: vamm.factoryAddress
          }))
        }
      });
    } else {
      // Get all active metrics
      const metrics = await db.getAllActiveMetrics();
      
      // Filter by category if provided
      const filteredMetrics = category 
        ? metrics.filter(m => m.category === parseInt(category))
        : metrics;

      return NextResponse.json({
        success: true,
        data: {
          metrics: filteredMetrics.map(metric => ({
            metricId: metric.metricId,
            name: metric.name,
            description: metric.description,
            category: metric.category,
            dataSource: metric.dataSource,
            updateFrequency: metric.updateFrequency,
            settlementPeriod: metric.settlementPeriod,
            requiresOracle: metric.requiresOracle,
            registeredBy: metric.registeredBy,
            registeredAt: metric.registeredAt.toISOString(),
            iconUrl: metric.iconUrl,
            websiteUrl: metric.websiteUrl,
            documentationUrl: metric.documentationUrl
          })),
          count: filteredMetrics.length
        }
      });
    }

  } catch (error) {
    console.error('DexV2 Metrics API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch metrics data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const {
      metricId,
      name,
      description,
      category,
      dataSource,
      updateFrequency,
      settlementPeriod,
      requiresOracle,
      registeredBy,
      iconUrl,
      websiteUrl,
      documentationUrl
    } = body;

    // Validate required fields
    if (!metricId || !name || !dataSource || !registeredBy) {
      return NextResponse.json(
        { error: 'Missing required fields: metricId, name, dataSource, registeredBy' },
        { status: 400 }
      );
    }

    // Validate Ethereum address format for registeredBy
    if (!/^0x[a-fA-F0-9]{40}$/.test(registeredBy)) {
      return NextResponse.json(
        { error: 'Invalid Ethereum address format for registeredBy' },
        { status: 400 }
      );
    }

    // Validate category (0-5)
    if (category < 0 || category > 5) {
      return NextResponse.json(
        { error: 'Category must be between 0 and 5' },
        { status: 400 }
      );
    }

    const db = new DexV2EventDatabase();

    // Check if metric already exists
    const existingMetric = await db.getMetric(metricId);
    if (existingMetric) {
      return NextResponse.json(
        { error: 'Metric with this ID already exists' },
        { status: 409 }
      );
    }

    const metric = {
      metricId,
      name,
      description: description || '',
      category: category || 0,
      dataSource,
      updateFrequency: updateFrequency || '1h',
      settlementPeriod: settlementPeriod || 3600,
      requiresOracle: requiresOracle !== false,
      registeredBy,
      registeredAt: new Date(),
      iconUrl,
      websiteUrl,
      documentationUrl
    };

    await db.storeMetricRegistration(metric);

    return NextResponse.json({
      success: true,
      message: 'Metric registered successfully',
      data: {
        metricId: metric.metricId,
        name: metric.name,
        category: metric.category,
        registeredAt: metric.registeredAt.toISOString()
      }
    });

  } catch (error) {
    console.error('DexV2 Metric Registration API error:', error);
    return NextResponse.json(
      { error: 'Failed to register metric' },
      { status: 500 }
    );
  }
} 