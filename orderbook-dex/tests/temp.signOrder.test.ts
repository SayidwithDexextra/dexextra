import assert from 'assert';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import type { Address } from 'viem';

import { signOrder } from '../../src/lib/order-signing';
import { CONTRACT_ADDRESSES } from '../../src/lib/contractConfig';

async function main() {
  const account = privateKeyToAccount(('0x' + '11'.repeat(32)) as Address);
  const walletClient = createWalletClient({
    account,
    chain: polygon,
    transport: http('https://polygon-rpc.com/')
  });

  const { order, signature, nonce } = await signOrder(
    {
      metricId: 'UNIT_TEST_METRIC',
      orderType: 'MARKET',
      side: 'BUY',
      quantity: '1',
      price: '0'
    },
    walletClient,
    CONTRACT_ADDRESSES.orderRouter as Address,
    0n
  );

  assert(signature.startsWith('0x') && signature.length === 132, 'signature format invalid');
  assert(order.trader.toLowerCase() === account.address.toLowerCase(), 'trader address mismatch');
  assert(typeof nonce === 'bigint', 'nonce must be bigint');
  console.log('✅ signOrder unit test passed');
}

main().catch((err) => {
  console.error('❌ signOrder unit test failed:', err);
  process.exit(1);
});


