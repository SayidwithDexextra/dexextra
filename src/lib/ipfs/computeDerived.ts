/**
 * Derived-value math for ratio and indexed (base-100) markets.
 *
 * This is the single source of truth for turning two resolved leg values
 * (A = numerator, B = denominator) into the number that markets actually
 * trade and settle on. It is intentionally dependency-free so it can be
 * imported by the Next app, the settlement engine, and the metric-ai-worker
 * without pulling in heavy modules.
 *
 *   - single:  value = A                     (denominator ignored)
 *   - ratio:   value = A / B                 (raw absolute ratio)
 *   - indexed: value = baseValue * (A/B) / V0
 *              where V0 = A0 / B0 is the baseline ratio locked at creation
 *              and baseValue is normally 100.
 *
 * All on-chain prices are 6-decimal fixed point (1e6 == 1.0), matching
 * CoreVault mark price and proposeSettlementPrice.
 */

export type MarketType = 'single' | 'ratio' | 'indexed';

export const FIXED_POINT_DECIMALS = 6;
export const DEFAULT_BASE_VALUE = 100;

export interface DerivedInput {
  marketType: MarketType;
  /** Numerator (leg A) value in human units. */
  a: number;
  /** Denominator (leg B) value in human units. Required for ratio/indexed. */
  b?: number;
  /** Base value for indexed markets (defaults to 100). */
  baseValue?: number;
  /** Baseline ratio V0 = A0/B0 locked at creation. Required for indexed. */
  baselineV0?: number;
}

export interface DerivedResult {
  /** Human-readable derived value (e.g. 0.05 for a raw ratio, 120 for an index). */
  value: number;
  /** 6-decimal fixed-point string suitable for parseUnits/BigInt. */
  fixedPoint6: string;
  /** The formula that produced the value, for provenance/manifest. */
  formula: string;
}

function assertFinitePositive(name: string, v: number | undefined): asserts v is number {
  if (v === undefined || !Number.isFinite(v)) {
    throw new Error(`computeDerived: ${name} must be a finite number (got ${v})`);
  }
}

/**
 * Round a human value to 6-decimal fixed point and return it as an integer
 * string (no decimal point). e.g. 0.05 -> "50000", 120 -> "120000000".
 */
export function toFixedPoint6(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`toFixedPoint6: value must be finite (got ${value})`);
  }
  if (value < 0) {
    throw new Error(`toFixedPoint6: value must be non-negative (got ${value})`);
  }
  const scaled = Math.round(value * 10 ** FIXED_POINT_DECIMALS);
  return String(scaled);
}

/** Raw ratio A / B. */
export function deriveRatio(a: number, b: number): number {
  assertFinitePositive('a', a);
  assertFinitePositive('b', b);
  if (b === 0) throw new Error('computeDerived: denominator (B) is zero');
  return a / b;
}

/** Indexed value: baseValue * (A/B) / V0. */
export function deriveIndexed(
  a: number,
  b: number,
  baselineV0: number,
  baseValue: number = DEFAULT_BASE_VALUE,
): number {
  assertFinitePositive('a', a);
  assertFinitePositive('b', b);
  assertFinitePositive('baselineV0', baselineV0);
  if (b === 0) throw new Error('computeDerived: denominator (B) is zero');
  if (baselineV0 === 0) throw new Error('computeDerived: baseline ratio V0 is zero');
  return (baseValue * (a / b)) / baselineV0;
}

/**
 * Compute the tradable/settlement value for a market from its leg readings.
 */
export function computeDerivedValue(input: DerivedInput): DerivedResult {
  const { marketType, a, b, baseValue = DEFAULT_BASE_VALUE, baselineV0 } = input;

  if (marketType === 'single') {
    assertFinitePositive('a', a);
    return { value: a, fixedPoint6: toFixedPoint6(a), formula: 'A' };
  }

  if (marketType === 'ratio') {
    const value = deriveRatio(a, b as number);
    return { value, fixedPoint6: toFixedPoint6(value), formula: 'A/B' };
  }

  if (marketType === 'indexed') {
    const value = deriveIndexed(a, b as number, baselineV0 as number, baseValue);
    return {
      value,
      fixedPoint6: toFixedPoint6(value),
      formula: `${baseValue} * (A/B) / V0`,
    };
  }

  throw new Error(`computeDerived: unknown marketType "${marketType}"`);
}

/**
 * Baseline ratio V0 from the two baseline leg readings A0, B0.
 */
export function computeBaselineV0(a0: number, b0: number): number {
  assertFinitePositive('A0', a0);
  assertFinitePositive('B0', b0);
  if (b0 === 0) throw new Error('computeBaselineV0: B0 is zero');
  return a0 / b0;
}
