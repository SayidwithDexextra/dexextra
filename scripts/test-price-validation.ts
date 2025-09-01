/*
  Temporary test: validates price scaling & preflight checks.
  Auto-deletes itself on success.
*/

import fs from 'fs';
import path from 'path';
import { scalePriceAndQuantity } from '@/lib/price-utils';

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

async function run() {
  // Valid price normalizes to two decimals and aligns to tick
  const { priceScaled: p1, normalizedPrice: np1 } = scalePriceAndQuantity({ price: 25.12, quantity: 1 });
  console.log('Valid normalization:', { np1, p1: p1.toString() });
  assert(np1 === 25.12, 'Price should normalize to 25.12');

  // Invalid: zero price should throw
  let zeroErr = false;
  try {
    scalePriceAndQuantity({ price: 0, quantity: 1 });
  } catch {
    zeroErr = true;
  }
  assert(zeroErr, 'Zero price must throw');

  // Invalid: more than 2 decimals should throw to prevent silent rounding
  let misalignErr = false;
  try {
    scalePriceAndQuantity({ price: 25.129, quantity: 1 });
  } catch {
    misalignErr = true;
  }
  assert(misalignErr, 'More than 2 decimals must throw');

  console.log('✅ All price validation tests passed');

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


