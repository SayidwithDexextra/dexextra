import { parseUnits } from 'viem';

export const TICK_SIZE_SCALED = 10n ** 16n; // 0.01 with 18 decimals

export interface ScaleInput {
  price: number | undefined;
  quantity: number;
  requireNonZeroPrice?: boolean; // default true
}

export interface ScaleOutput {
  priceScaled: bigint;
  quantityScaled: bigint;
  normalizedPrice: number;
}

export function scalePriceAndQuantity(input: ScaleInput): ScaleOutput {
  const { price, quantity } = input;
  const requireNonZeroPrice = input.requireNonZeroPrice !== false;

  if (requireNonZeroPrice && (!(typeof price === 'number') || !(price > 0))) {
    throw new Error('Invalid price: must be a positive number');
  }

  if (!(typeof quantity === 'number') || !(quantity > 0)) {
    throw new Error('Invalid quantity: must be a positive number');
  }

  // Reject more than 2 decimal places to prevent silent rounding
  if (typeof price === 'number') {
    const decimals = (price.toString().split('.')[1] || '').length;
    if (decimals > 2) {
      throw new Error('Invalid price: more than 2 decimal places');
    }
  }

  // Normalize to two decimals (safe now, as we restrict decimals <= 2)
  const normalizedPrice = price ? Math.round(price * 100) / 100 : 0;
  const priceScaled = parseUnits(normalizedPrice.toFixed(2), 18);
  const quantityScaled = parseUnits(quantity.toString(), 18);

  if (requireNonZeroPrice) {
    if (priceScaled <= 0n) {
      throw new Error('Invalid price: zero after scaling');
    }
    if (priceScaled % TICK_SIZE_SCALED !== 0n) {
      throw new Error('Invalid price: not aligned to tick size (0.01)');
    }
  }

  return { priceScaled, quantityScaled, normalizedPrice };
}


