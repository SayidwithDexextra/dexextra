import assert from 'assert';
import fetch from 'node-fetch';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { signOrder } from '../../src/lib/order-signing';
import { CONTRACT_ADDRESSES } from '../../src/lib/contractConfig';
import type { Address } from 'viem';

async function main() {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  const account = privateKeyToAccount(('0x' + '22'.repeat(32)) as Address);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http('https://polygon-rpc.com/') });

  const { signature, nonce } = await signOrder(
    { metricId: 'UNIT_TEST', orderType: 'MARKET', side: 'BUY', quantity: '1', price: '0' },
    walletClient,
    CONTRACT_ADDRESSES.orderRouter as Address,
    0n
  );

  const body = {
    metricId: 'UNIT_TEST',
    orderType: 'MARKET',
    side: 'BUY',
    quantity: '1',
    price: '0',
    timeInForce: 'IOC',
    walletAddress: account.address,
    timestamp: Date.now(),
    signature,
    nonce: Number(nonce),
    metadataHash: '0x' + '0'.repeat(64)
  };

  const res = await fetch(`${baseUrl}/api/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-test-mode': 'true' },
    body: JSON.stringify(body)
  });

  assert.strictEqual(res.status, 200, `expected 200, got ${res.status}`);
  const json: any = await res.json();
  assert(json.success === true, 'expected success true');
  console.log('✅ API integration test passed');
}

main().catch((err) => {
  console.error('❌ API integration test failed:', err);
  process.exit(1);
});


