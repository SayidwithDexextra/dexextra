import assert from 'assert';
import { createWalletClient, http } from 'viem';
import { polygon } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { signOrder } from '../../src/lib/order-signing';
import { ORDER_ROUTER_ABI } from '../../src/lib/orderRouterAbi';
import { CONTRACT_ADDRESSES } from '../../src/lib/contractConfig';
import type { Address } from 'viem';

async function main() {
  const account = privateKeyToAccount(('0x' + '33'.repeat(32)) as Address);
  const walletClient = createWalletClient({ account, chain: polygon, transport: http('https://polygon-rpc.com/') });

  // Build a valid signed order payload (nonce 0 for stub)
  const signed = await signOrder(
    { metricId: 'UNIT_E2E', orderType: 'MARKET', side: 'BUY', quantity: '1', price: '0' },
    walletClient,
    CONTRACT_ADDRESSES.orderRouter as Address,
    0n
  );

  // Stub: do not actually submit to chain. Just ensure we can encode call
  const calldata = {
    address: CONTRACT_ADDRESSES.orderRouter as Address,
    abi: ORDER_ROUTER_ABI,
    functionName: 'placeOrderWithSig',
    args: [signed.order, signed.signature]
  } as const;

  assert(calldata.functionName === 'placeOrderWithSig');
  console.log('✅ E2E stub prepared (no revert)');
}

main().catch((err) => {
  console.error('❌ E2E stub failed:', err);
  process.exit(1);
});


