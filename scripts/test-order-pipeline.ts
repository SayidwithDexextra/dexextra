import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { signOrder, getCanonicalOrder, validateOrderSignature } from '@/lib/order-signing';
import { CONTRACT_ADDRESSES } from '@/lib/contractConfig';

async function main() {
  const TEST_PK = (process.env.TEST_PRIVATE_KEY || '0x'.padEnd(66, '1')) as `0x${string}`;
  const account = privateKeyToAccount(TEST_PK);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http(process.env.RPC_URL || 'https://polygon-rpc.com') });

  const metricId = 'TEST_SILVER_V4';
  const nonce = 1n;

  const orderData = { metricId, orderType: 'LIMIT' as const, side: 'BUY' as const, quantity: '67.79661016949153', price: '147.5', postOnly: false };
  const { order, signature } = await signOrder(orderData, walletClient as any, CONTRACT_ADDRESSES.orderRouter, nonce);

  const canonical = getCanonicalOrder({
    trader: account.address,
    metricId,
    orderType: 'LIMIT',
    side: 'BUY',
    quantity: order.quantity,
    price: order.price,
    postOnly: false,
    metadataHash: order.metadataHash,
  });

  const validation = await validateOrderSignature({
    orderLike: canonical,
    signature: signature as `0x${string}`,
    nonce,
    orderRouterAddress: CONTRACT_ADDRESSES.orderRouter,
    expectedTrader: account.address,
  });

  console.log('Validation:', validation);
  if (!validation.valid) process.exit(1);

  // Negative: modify field
  const tampered = { ...canonical, price: canonical.price + 1n };
  const v2 = await validateOrderSignature({
    orderLike: tampered,
    signature: signature as `0x${string}`,
    nonce,
    orderRouterAddress: CONTRACT_ADDRESSES.orderRouter,
    expectedTrader: account.address,
  });
  console.log('Tampered validation (should fail):', v2.valid);
  if (v2.valid) process.exit(2);
}

main().catch((e) => { console.error(e); process.exit(1); });

/*
  Temporary end-to-end-like test
  - Valid LIMIT order (nonzero price) should pass preflight and not serialize 0n price
  - Invalid price=0 should fail before chain
  Auto-deletes itself on success
*/

import fs from 'fs';
import path from 'path';
import { NextRequest } from 'next/server';
import { POST } from '@/app/api/orders/route';

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // Mock a valid request
  const validBody = {
    metricId: 'SILVER_Relayed_Meridian_2025_85969',
    orderType: 'LIMIT',
    side: 'BUY',
    quantity: '50',
    price: '25.12',
    timeInForce: 'GTC',
    signature: `0x${'0'.repeat(130)}`,
    walletAddress: '0x67578a5bffc0ff03cf7661db7ed51360884fc371',
    nonce: 0,
    timestamp: Date.now(),
    metadataHash: `0x${'0'.repeat(64)}`,
  };

  const req1 = new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify(validBody),
    headers: {
      'content-type': 'application/json',
      // enable test mode short circuit in route.ts so it doesn't hit DB/chain
      'x-test-mode': 'true',
    },
  } as any);

  const res1 = await POST(req1);
  const data1: any = await (res1 as any).json();
  console.log('Test-mode response 1:', data1);
  assert(data1 && data1.success === true, 'Valid order should pass route validation in test mode');

  // Mock an invalid zero-price LIMIT order
  const invalidBody = { ...validBody, price: '0' };
  const req2 = new NextRequest('http://localhost/api/orders', {
    method: 'POST',
    body: JSON.stringify(invalidBody),
    headers: { 'content-type': 'application/json', 'x-test-mode': 'true' },
  } as any);
  const res2 = await POST(req2);
  console.log('Test-mode response 2 status:', (res2 as any).status);
  assert((res2 as any).status === 400, 'Zero price should be rejected by the API route');

  console.log('✅ Order pipeline tests passed');

  // Self-delete file
  try {
    fs.unlinkSync(path.resolve(__filename));
    console.log('🧹 Test file removed:', __filename);
  } catch (e) {
    console.warn('Could not delete test file:', e);
  }
}

run().catch((e) => {
  console.error('❌ Test failed:', e);
  process.exit(1);
});


