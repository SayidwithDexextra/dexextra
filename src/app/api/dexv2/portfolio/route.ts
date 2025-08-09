import { NextRequest, NextResponse } from 'next/server';
import DexV2EventDatabase from '@/lib/dexV2EventDatabase';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const userAddress = searchParams.get('address');

    if (!userAddress) {
      return NextResponse.json(
        { error: 'User address is required' },
        { status: 400 }
      );
    }

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return NextResponse.json(
        { error: 'Invalid Ethereum address format' },
        { status: 400 }
      );
    }

    const db = new DexV2EventDatabase();

    // Get comprehensive portfolio data
    const [portfolio, positions, limitOrders] = await Promise.all([
      db.getUserPortfolio(userAddress),
      db.getUserPositions(userAddress, true), // active only
      db.getUserLimitOrders(userAddress, 0) // active orders only
    ]);

    return NextResponse.json({
      success: true,
      data: {
        portfolio: portfolio || {
          userAddress,
          totalCollateral: "0",
          totalReservedMargin: "0", 
          totalUnrealizedPnl: "0",
          availableCollateral: "0",
          totalPositions: 0,
          activePositions: 0,
          profitablePositions: 0,
          totalVolume: "0",
          totalFeesPaid: "0",
          realizedPnl: "0",
          winRate: 0,
          activeMarkets: 0,
          limitOrdersCount: 0,
          healthFactor: 0,
          marginRatio: 0,
          liquidationThreshold: "0",
          lastActivity: new Date()
        },
        activePositions: positions.map(pos => ({
          positionId: pos.positionId.toString(),
          metricId: pos.metricId,
          vammAddress: pos.vammAddress,
          size: pos.size.toString(),
          isLong: pos.isLong,
          entryPrice: pos.entryPrice.toString(),
          leverage: pos.leverage.toString(),
          collateralAmount: pos.collateralAmount.toString(),
          positionType: pos.positionType,
          targetValue: pos.targetValue?.toString() || "0",
          currentPrice: pos.currentPrice?.toString(),
          unrealizedPnl: pos.unrealizedPnl.toString(),
          fundingPaid: pos.fundingPaid.toString(),
          feesPaid: pos.feesPaid.toString(),
          openedAt: pos.openedAt.toISOString()
        })),
        activeLimitOrders: limitOrders.map(order => ({
          orderId: order.orderId.toString(),
          metricId: order.metricId,
          vammAddress: order.vammAddress,
          collateralAmount: order.collateralAmount.toString(),
          isLong: order.isLong,
          leverage: order.leverage.toString(),
          targetValue: order.targetValue.toString(),
          positionType: order.positionType,
          triggerPrice: order.triggerPrice.toString(),
          orderType: order.orderType,
          expiry: order.expiry.toISOString(),
          maxSlippage: order.maxSlippage.toString(),
          keeperFee: order.keeperFee.toString(),
          status: order.status,
          createdAt: order.createdAt.toISOString()
        }))
      }
    });

  } catch (error) {
    console.error('DexV2 Portfolio API error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch portfolio data' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { userAddress, portfolioData } = body;

    if (!userAddress || !portfolioData) {
      return NextResponse.json(
        { error: 'User address and portfolio data are required' },
        { status: 400 }
      );
    }

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(userAddress)) {
      return NextResponse.json(
        { error: 'Invalid Ethereum address format' },
        { status: 400 }
      );
    }

    const db = new DexV2EventDatabase();

    // Convert string values to BigInt for database storage
    const portfolio = {
      userAddress,
      totalCollateral: BigInt(portfolioData.totalCollateral || 0),
      totalReservedMargin: BigInt(portfolioData.totalReservedMargin || 0),
      totalUnrealizedPnl: BigInt(portfolioData.totalUnrealizedPnl || 0),
      availableCollateral: BigInt(portfolioData.availableCollateral || 0),
      totalPositions: portfolioData.totalPositions || 0,
      activePositions: portfolioData.activePositions || 0,
      profitablePositions: portfolioData.profitablePositions || 0,
      totalVolume: BigInt(portfolioData.totalVolume || 0),
      totalFeesPaid: BigInt(portfolioData.totalFeesPaid || 0),
      realizedPnl: BigInt(portfolioData.realizedPnl || 0),
      winRate: portfolioData.winRate || 0,
      activeMarkets: portfolioData.activeMarkets || 0,
      limitOrdersCount: portfolioData.limitOrdersCount || 0,
      healthFactor: portfolioData.healthFactor || 0,
      marginRatio: portfolioData.marginRatio || 0,
      liquidationThreshold: BigInt(portfolioData.liquidationThreshold || 0),
      lastActivity: new Date()
    };

    await db.updateUserPortfolio(portfolio);

    return NextResponse.json({
      success: true,
      message: 'Portfolio updated successfully'
    });

  } catch (error) {
    console.error('DexV2 Portfolio Update API error:', error);
    return NextResponse.json(
      { error: 'Failed to update portfolio data' },
      { status: 500 }
    );
  }
} 