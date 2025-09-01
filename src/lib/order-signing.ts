/**
 * Order Signing Utilities for EIP-712 Signature Generation
 * 
 * This module provides utilities for signing orders with EIP-712 that match
 * the exact struct and domain parameters expected by the OrderRouter contract.
 */

import { type WalletClient, type Address, hashTypedData, recoverTypedDataAddress, parseUnits } from 'viem';
import { CHAIN_CONFIG } from '@/lib/contractConfig';

// EIP-712 Domain - MUST match OrderRouter contract exactly
export const ORDER_DOMAIN = {
  name: 'DexextraOrderRouter',  // Matches EIP712("DexextraOrderRouter", "1") in constructor
  version: '1',
  // chainId is set dynamically at call sites to ensure it matches the connected network
  verifyingContract: '' as Address // Will be set dynamically
} as const;

// EIP-712 Types - MUST match ORDER_TYPEHASH in OrderRouter contract exactly
export const ORDER_TYPES = {
  Order: [
    { name: 'orderId', type: 'uint256' },
    { name: 'trader', type: 'address' },
    { name: 'metricId', type: 'string' },
    { name: 'orderType', type: 'uint8' },
    { name: 'side', type: 'uint8' },
    { name: 'quantity', type: 'uint256' },
    { name: 'price', type: 'uint256' },
    { name: 'filledQuantity', type: 'uint256' },
    { name: 'timestamp', type: 'uint256' },
    { name: 'expiryTime', type: 'uint256' },
    { name: 'status', type: 'uint8' },
    { name: 'timeInForce', type: 'uint8' },
    { name: 'stopPrice', type: 'uint256' },
    { name: 'icebergQty', type: 'uint256' },
    { name: 'postOnly', type: 'bool' },
    { name: 'metadataHash', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
  ],
} as const;

export interface OrderData {
  metricId: string;
  orderType: 'MARKET' | 'LIMIT';
  side: 'BUY' | 'SELL';
  quantity: string; // In ether units (will be converted to wei)
  price?: string;   // In ether units (will be converted to wei)
  timeInForce?: 'GTC' | 'IOC' | 'FOK' | 'GTD';
  postOnly?: boolean;
  metadataHash?: string;
}

export interface SignedOrder {
  order: {
    orderId: bigint;
    trader: Address;
    metricId: string;
    orderType: number;
    side: number;
    quantity: bigint;
    price: bigint;
    filledQuantity: bigint;
    timestamp: bigint;
    expiryTime: bigint;
    status: number;
    timeInForce: number;
    stopPrice: bigint;
    icebergQty: bigint;
    postOnly: boolean;
    metadataHash: `0x${string}`;
  };
  signature: `0x${string}`;
  nonce: bigint;
  typedDataHash: `0x${string}`;
}

/**
 * Return a canonical on-chain order struct with deterministic serialization
 * - Enforces exact field set and ordering
 * - Normalizes price to 2 decimals and scales with 18 decimals
 * - Scales quantity with 18 decimals using decimal-accurate parseUnits
 */
export function getCanonicalOrder(input: {
  trader: Address;
  metricId: string;
  orderType: 'MARKET' | 'LIMIT' | number;
  side: 'BUY' | 'SELL' | number;
  quantity: string | number | bigint;
  price?: string | number | bigint;
  postOnly?: boolean;
  metadataHash?: `0x${string}` | string;
}): {
  orderId: bigint;
  trader: Address;
  metricId: string;
  orderType: number;
  side: number;
  quantity: bigint;
  price: bigint;
  filledQuantity: bigint;
  timestamp: bigint;
  expiryTime: bigint;
  status: number;
  timeInForce: number;
  stopPrice: bigint;
  icebergQty: bigint;
  postOnly: boolean;
  metadataHash: `0x${string}`;
} {
  const orderTypeNum = typeof input.orderType === 'number' ? input.orderType : (input.orderType === 'MARKET' ? 0 : 1);
  const sideNum = typeof input.side === 'number' ? input.side : (input.side === 'BUY' ? 0 : 1);

  // Normalize price to exactly 2 decimals to match on-chain tick (0.01)
  // Always include price for both LIMIT and MARKET orders to match on-chain validation and signature
  let priceScaled: bigint = 0n;
  if (typeof input.price === 'bigint') {
    priceScaled = input.price;
  } else if (input.price !== undefined && input.price !== null) {
    const normalizedPrice = Number(input.price);
    const priceTwoDecimals = Math.round(normalizedPrice * 100) / 100;
    priceScaled = parseUnits(priceTwoDecimals.toFixed(2), 18);
  }

  // Quantity scaling: if already bigint, treat as scaled; else parseUnits
  const quantityScaled: bigint = typeof input.quantity === 'bigint'
    ? input.quantity
    : parseUnits(String(input.quantity), 18);

  const canonical = {
    orderId: 0n,
    trader: input.trader as Address,
    metricId: String(input.metricId),
    orderType: orderTypeNum,
    side: sideNum,
    quantity: quantityScaled,
    price: priceScaled,
    filledQuantity: 0n,
    timestamp: 0n,
    expiryTime: 0n,
    status: 0,
    timeInForce: 0,
    stopPrice: 0n,
    icebergQty: 0n,
    postOnly: Boolean(input.postOnly || false),
    metadataHash: (input.metadataHash || `0x${'0'.repeat(64)}`) as `0x${string}`,
  } as const;

  return canonical;
}

/**
 * Validate an order signature by rebuilding the typed data hash from canonical order
 * Returns detailed mismatch information for easier debugging.
 */
export async function validateOrderSignature(params: {
  orderLike: any;
  signature: `0x${string}`;
  nonce: bigint;
  orderRouterAddress: Address;
  expectedTrader: Address;
}): Promise<{
  valid: boolean;
  expected: Address;
  recovered?: Address;
  mismatches?: Record<string, { expected: any; received: any }>;
}> {
  try {
    // Build canonical order from provided shape
    const order = getCanonicalOrder({
      trader: (params.orderLike.trader ?? params.expectedTrader) as Address,
      metricId: params.orderLike.metricId,
      orderType: params.orderLike.orderType,
      side: params.orderLike.side,
      quantity: params.orderLike.quantity,
      price: params.orderLike.price,
      postOnly: params.orderLike.postOnly,
      metadataHash: params.orderLike.metadataHash,
    });

    const domain = { ...ORDER_DOMAIN, chainId: CHAIN_CONFIG.chainId, verifyingContract: params.orderRouterAddress } as const;
    const message = { ...order, nonce: params.nonce };

    const recoveredAddress = await recoverTypedDataAddress({
      domain,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message,
      signature: params.signature,
    });

    const valid = recoveredAddress.toLowerCase() === params.expectedTrader.toLowerCase();

    // Detect field mismatches between provided orderLike and canonicalized order
    const keys: (keyof typeof order)[] = [
      'orderId','trader','metricId','orderType','side','quantity','price','filledQuantity','timestamp','expiryTime','status','timeInForce','stopPrice','icebergQty','postOnly','metadataHash'
    ];
    const mismatches: Record<string, { expected: any; received: any }> = {};
    for (const k of keys) {
      const expectedVal = (order as any)[k];
      const receivedVal = (params.orderLike as any)[k];
      // Compare after normalizing bigint -> string for readability
      const norm = (v: any) => typeof v === 'bigint' ? v.toString() : v;
      if (norm(expectedVal) !== norm(receivedVal)) {
        mismatches[String(k)] = { expected: norm(expectedVal), received: norm(receivedVal) };
      }
    }

    return valid
      ? { valid, expected: params.expectedTrader, recovered: recoveredAddress }
      : { valid, expected: params.expectedTrader, recovered: recoveredAddress, mismatches };
  } catch (e: any) {
    return { valid: false, expected: params.expectedTrader, mismatches: { error: { expected: 'no error', received: e?.message || String(e) } } } as any;
  }
}

/**
 * Sign an order using EIP-712 with the exact format expected by OrderRouter
 */
export async function signOrder(
  orderData: OrderData,
  walletClient: WalletClient,
  orderRouterAddress: Address,
  currentNonce: bigint
): Promise<SignedOrder> {
  if (!walletClient.account) {
    throw new Error('Wallet client must have an account');
  }

  // Set the verifying contract address
  const domain = {
    ...ORDER_DOMAIN,
    chainId: (walletClient as any)?.chain?.id ?? CHAIN_CONFIG.chainId,
    verifyingContract: orderRouterAddress
  } as const;

  // Build canonical order for deterministic signing
  const order = getCanonicalOrder({
    trader: walletClient.account.address,
    metricId: orderData.metricId,
    orderType: orderData.orderType,
    side: orderData.side,
    quantity: orderData.quantity,
    price: orderData.price,
    postOnly: orderData.postOnly,
    metadataHash: orderData.metadataHash,
  });

  // Create the message for signing (includes nonce)
  const message = {
    ...order,
    nonce: currentNonce,
  };

  console.log('🔐 Signing order with EIP-712:', { domain, types: ORDER_TYPES, message });

  // Calculate the typed data hash for debugging
  const typedDataHash = hashTypedData({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message,
  });

  console.log('📝 Typed data hash:', typedDataHash);

  // Sign the typed data
  const signature = await walletClient.signTypedData({
    account: walletClient.account!,
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message,
  });

  console.log('✅ Order signed successfully:', signature.slice(0, 20) + '...');

  // Verify signature by recovering the address
  const recoveredAddress = await recoverTypedDataAddress({
    domain,
    types: ORDER_TYPES,
    primaryType: 'Order',
    message,
    signature,
  });

  console.log('🔍 Signature verification:', {
    expected: walletClient.account.address,
    recovered: recoveredAddress,
    match: recoveredAddress.toLowerCase() === walletClient.account.address.toLowerCase()
  });

  if (recoveredAddress.toLowerCase() !== walletClient.account.address.toLowerCase()) {
    throw new Error('Signature verification failed - recovered address does not match trader');
  }

  return {
    order,
    signature,
    nonce: currentNonce,
    typedDataHash,
  };
}

/**
 * Verify an order signature matches the expected trader
 */
export async function verifyOrderSignature(
  order: any,
  signature: `0x${string}`,
  nonce: bigint,
  orderRouterAddress: Address,
  expectedTrader: Address
): Promise<boolean> {
  try {
    const domain = { ...ORDER_DOMAIN, chainId: CHAIN_CONFIG.chainId, verifyingContract: orderRouterAddress } as const;
    // Ensure canonical message
    const canonical = getCanonicalOrder({
      trader: (order.trader || expectedTrader) as Address,
      metricId: order.metricId,
      orderType: order.orderType,
      side: order.side,
      quantity: order.quantity,
      price: order.price,
      postOnly: order.postOnly,
      metadataHash: order.metadataHash,
    });
    const message = { ...canonical, nonce };

    const recoveredAddress = await recoverTypedDataAddress({
      domain,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message,
      signature,
    });

    const isValid = recoveredAddress.toLowerCase() === expectedTrader.toLowerCase();
    
    console.log('🔍 Order signature verification:', {
      expected: expectedTrader,
      recovered: recoveredAddress,
      isValid,
    });

    return isValid;
  } catch (error) {
    console.error('❌ Signature verification error:', error);
    return false;
  }
}

/**
 * Debug helper to log all signing parameters
 */
export function debugSigningParameters(
  orderData: OrderData,
  traderAddress: Address,
  orderRouterAddress: Address,
  nonce: bigint
) {
  const domain = {
    ...ORDER_DOMAIN,
    chainId: CHAIN_CONFIG.chainId,
    verifyingContract: orderRouterAddress
  } as const;

  const order = {
    orderId: 0n,
    trader: traderAddress,
    metricId: orderData.metricId,
    orderType: orderData.orderType === 'MARKET' ? 0 : 1,
    side: orderData.side === 'BUY' ? 0 : 1,
    quantity: BigInt(Math.floor(parseFloat(orderData.quantity) * 1e18)),
    price: normalizedPriceStr ? BigInt(Math.floor(parseFloat(normalizedPriceStr) * 1e18)) : 0n,
    filledQuantity: 0n,
    timestamp: 0n,
    expiryTime: 0n,
    status: 0,
    timeInForce: 0,
    stopPrice: 0n,
    icebergQty: 0n,
    postOnly: orderData.postOnly || false,
    metadataHash: (orderData.metadataHash || `0x${'0'.repeat(64)}`) as `0x${string}`,
  };

  const message = { ...order, nonce };

  console.log('🐛 DEBUG: Signing Parameters', {
    domain,
    types: ORDER_TYPES,
    message,
    typedDataHash: hashTypedData({
      domain,
      types: ORDER_TYPES,
      primaryType: 'Order',
      message,
    })
  });
}



