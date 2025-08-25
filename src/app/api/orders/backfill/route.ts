import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { publicClient } from '@/lib/viemClient';
import { CONTRACT_ADDRESSES, ORDER_ROUTER_ABI, OrderSide, OrderStatus, OrderType, TimeInForce } from '@/lib/contractConfig';

type HexAddress = `0x${string}`;

function toUpperEnum<T extends Record<string, number>>(val: number, mapping: T, fallback: string): string {
  const key = Object.keys(mapping).find(k => (mapping as any)[k] === val);
  return key ?? fallback;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const orderIdRaw = body?.orderId;
    const metricIdParam = body?.metricId as string | undefined;

    if (orderIdRaw === undefined && !metricIdParam) {
      return NextResponse.json({ error: 'Provide orderId or metricId' }, { status: 400 });
    }

    const orderId = orderIdRaw !== undefined ? BigInt(orderIdRaw) : undefined;

    // Fetch order from chain
    let contractOrder: any;
    if (orderId !== undefined) {
      contractOrder = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getOrder',
        args: [orderId],
      });
      if (!contractOrder || contractOrder.orderId === 0n) {
        return NextResponse.json({ error: 'Order not found on-chain' }, { status: 404 });
      }
    } else {
      // If only metricId provided, attempt to find latest user order via logs and fetch it
      const latestBlock = await publicClient.getBlockNumber();
      const fromBlock = latestBlock > 1000n ? latestBlock - 1000n : 0n;
      
      const logs = await publicClient.getLogs({
        address: CONTRACT_ADDRESSES.orderRouter,
        event: {
          type: 'event',
          name: 'OrderPlaced',
          inputs: [
            { indexed: true, name: 'orderId', type: 'uint256' },
            { indexed: true, name: 'trader', type: 'address' },
            { indexed: false, name: 'metricId', type: 'string' },
            { indexed: false, name: 'orderType', type: 'uint8' },
            { indexed: false, name: 'side', type: 'uint8' },
            { indexed: false, name: 'quantity', type: 'uint256' },
            { indexed: false, name: 'price', type: 'uint256' },
          ],
        } as const,
        fromBlock,
        toBlock: 'latest',
      });

      const latest = [...logs]
        .reverse()
        .find((l: any) => l.args?.metricId === metricIdParam);

      if (!latest) {
        return NextResponse.json({ error: 'No orders found for metricId' }, { status: 404 });
      }

      const latestOrderId = BigInt(latest.args.orderId);
      contractOrder = await publicClient.readContract({
        address: CONTRACT_ADDRESSES.orderRouter,
        abi: ORDER_ROUTER_ABI,
        functionName: 'getOrder',
        args: [latestOrderId],
      });
    }

    const {
      orderId: onchainOrderId,
      trader,
      metricId,
      orderType,
      side,
      quantity,
      price,
      filledQuantity,
      timestamp,
      expiryTime,
      status,
      timeInForce,
      stopPrice,
      icebergQty,
      postOnly,
    } = contractOrder;

    // Find market by metricId
    const { data: markets, error: marketErr } = await supabaseAdmin
      .from('orderbook_markets')
      .select('id')
      .eq('metric_id', metricId)
      .limit(1);

    if (marketErr) {
      return NextResponse.json({ error: 'Failed to query market', details: marketErr.message }, { status: 500 });
    }

    if (!markets || markets.length === 0) {
      return NextResponse.json({ error: 'Market not found in Supabase for metricId', metricId }, { status: 404 });
    }

    const marketId = markets[0].id as string;

    // Check if order already exists
    const { data: existing } = await supabaseAdmin
      .from('market_orders')
      .select('id')
      .eq('order_id', Number(onchainOrderId))
      .limit(1);

    if (existing && existing.length > 0) {
      return NextResponse.json({ success: true, order: existing[0], note: 'Order already exists' });
    }

    // Convert quantities with precision handling to avoid 0 values
    const quantityEther = Math.max(Number(quantity) / 1e18, 1e-8);
    const priceEther = Math.max(Number(price) / 1e18, 1e-8);
    const filledQuantityEther = Number(filledQuantity) / 1e18;

    // Insert new order into market_orders
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('market_orders')
      .insert({
        order_id: Number(onchainOrderId),
        market_id: marketId,
        trader_wallet_address: trader as HexAddress,
        order_type: toUpperEnum(orderType, OrderType, 'LIMIT'),
        side: toUpperEnum(side, OrderSide, 'BUY'),
        quantity: quantityEther,
        price: priceEther,
        filled_quantity: filledQuantityEther,
        order_status: toUpperEnum(status, OrderStatus, 'PENDING'),
        time_in_force: toUpperEnum(timeInForce, TimeInForce, 'GTC'),
        expiry_time: expiryTime && expiryTime !== 0n ? new Date(Number(expiryTime) * 1000).toISOString() : null,
        stop_price: stopPrice && stopPrice !== 0n ? Number(stopPrice) / 1e18 : null,
        iceberg_quantity: icebergQty && icebergQty !== 0n ? Number(icebergQty) / 1e18 : null,
        post_only: Boolean(postOnly),
      })
      .select();

    if (insertErr) {
      return NextResponse.json({ error: 'Failed to insert order', details: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, order: inserted?.[0] ?? null });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error', message: (error as Error).message }, { status: 500 });
  }
}


