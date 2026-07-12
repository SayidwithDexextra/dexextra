/**
 * Market manifest: the immutable, content-addressed document that describes a
 * ratio or indexed market and how its start price was derived.
 *
 * For ratio/indexed markets the manifest CID is written on-chain as the
 * market's `metricUrl` (ipfs://<CID>). Because metricUrl is bound into both
 * the marketId hash and the MetaCreateV2 EIP-712 signature, the manifest -
 * including the indexed baseline and the start-price provenance - is anchored
 * on-chain and independently verifiable, with no smart-contract changes.
 */

import { z } from 'zod';
import {
  cidFromUri,
  fetchJsonFromGateway,
  isIpfsUri,
  pinJson,
  sha256Hex,
  type PinResult,
} from './pinata';
import { DEFAULT_BASE_VALUE, FIXED_POINT_DECIMALS, type MarketType } from './computeDerived';

export const MANIFEST_SCHEMA_VERSION = '1.0';

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const LegSpecSchema = z.object({
  label: z.string().min(1).max(200),
  sources: z.array(z.string().url()).min(1).max(10),
  readMethod: z.string().max(500).optional(),
  /** Value observed for this leg at creation (human units). */
  valueAtCreation: z.number().optional(),
});

const BaselineSchema = z.object({
  /** Numerator reading at creation. */
  A0: z.number(),
  /** Denominator reading at creation. */
  B0: z.number(),
  /** Baseline ratio V0 = A0/B0 locked at creation. */
  V0: z.number(),
  asOf: z.string(),
  /** Optional evidence artifacts (ipfs:// or http URLs). */
  evidence: z.array(z.string()).optional(),
});

const StartPriceSchema = z.object({
  /** 6-decimal fixed-point value written on-chain (e.g. "100000000"). */
  value: z.string(),
  /** Human-readable value (e.g. 100 for an index, 0.05 for a raw ratio). */
  humanValue: z.number().optional(),
  derivation: z.string().max(2000),
  aiResolution: z
    .object({
      model: z.string().optional(),
      confidence: z.number().optional(),
      reasoning: z.string().optional(),
      sources: z.array(z.string()).optional(),
    })
    .optional(),
});

export const MarketManifestSchema = z.object({
  schemaVersion: z.string(),
  marketType: z.enum(['single', 'ratio', 'indexed']),
  operator: z.enum(['A', 'A/B']).default('A'),
  baseValue: z.number().default(DEFAULT_BASE_VALUE),
  scaling: z.object({ decimals: z.number() }).default({ decimals: FIXED_POINT_DECIMALS }),
  legs: z
    .object({
      numerator: LegSpecSchema,
      denominator: LegSpecSchema.optional(),
    })
    .optional(),
  baseline: BaselineSchema.optional(),
  startPrice: StartPriceSchema,
  settlementRule: z.string().max(2000),
  createdAt: z.string().optional(),
});

export type MarketManifest = z.infer<typeof MarketManifestSchema>;
export type LegSpec = z.infer<typeof LegSpecSchema>;
export type ManifestBaseline = z.infer<typeof BaselineSchema>;

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export interface BuildManifestInput {
  marketType: MarketType;
  baseValue?: number;
  legs?: {
    numerator: { label: string; sources: string[]; readMethod?: string; valueAtCreation?: number };
    denominator?: { label: string; sources: string[]; readMethod?: string; valueAtCreation?: number };
  };
  baseline?: { A0: number; B0: number; V0: number; asOf?: string; evidence?: string[] };
  startPrice: {
    value: string;
    humanValue?: number;
    derivation: string;
    aiResolution?: { model?: string; confidence?: number; reasoning?: string; sources?: string[] };
  };
  settlementRule: string;
}

export function buildMarketManifest(input: BuildManifestInput): MarketManifest {
  const operator = input.marketType === 'single' ? 'A' : 'A/B';
  const manifest: MarketManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    marketType: input.marketType,
    operator,
    baseValue: input.baseValue ?? DEFAULT_BASE_VALUE,
    scaling: { decimals: FIXED_POINT_DECIMALS },
    legs: input.legs,
    baseline: input.baseline
      ? { ...input.baseline, asOf: input.baseline.asOf ?? new Date().toISOString() }
      : undefined,
    startPrice: input.startPrice,
    settlementRule: input.settlementRule,
    createdAt: new Date().toISOString(),
  };
  return MarketManifestSchema.parse(manifest);
}

export function validateMarketManifest(obj: unknown): MarketManifest {
  return MarketManifestSchema.parse(obj);
}

// ---------------------------------------------------------------------------
// Canonical JSON (stable key ordering) for deterministic hashing
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

export function canonicalManifestJson(manifest: MarketManifest): string {
  return stableStringify(manifest);
}

// ---------------------------------------------------------------------------
// Pin + resolve
// ---------------------------------------------------------------------------

export interface PinnedManifest extends PinResult {
  manifest: MarketManifest;
  canonicalJson: string;
}

/**
 * Validate, canonicalize, and pin a manifest to IPFS.
 */
export async function pinMarketManifest(manifest: MarketManifest): Promise<PinnedManifest> {
  const validated = validateMarketManifest(manifest);
  const canonicalJson = canonicalManifestJson(validated);
  const pin = await pinJson(validated, { name: 'market-manifest.json', canonicalJson });
  return { ...pin, manifest: validated, canonicalJson };
}

/**
 * Fetch a manifest from IPFS by CID or ipfs:// URI, validate it, and
 * optionally verify its sha256 against an expected value we control.
 */
export async function resolveManifest(
  cidOrUri: string,
  opts: { expectedSha256?: string; timeoutMs?: number } = {},
): Promise<MarketManifest> {
  const raw = await fetchJsonFromGateway(cidOrUri, {
    expectedSha256: opts.expectedSha256,
    timeoutMs: opts.timeoutMs,
  });
  return validateMarketManifest(raw);
}

export { isIpfsUri, cidFromUri, sha256Hex };

/** Extract the CID from a metricUrl if it is an ipfs pointer, else null. */
export function cidFromMetricUrl(metricUrl: string | null | undefined): string | null {
  if (!metricUrl || !isIpfsUri(metricUrl)) return null;
  try {
    return cidFromUri(metricUrl);
  } catch {
    return null;
  }
}

export interface ManifestVerification {
  ok: boolean;
  cid: string | null;
  manifest: MarketManifest | null;
  cidMatches: boolean;
  reason?: string;
}

/**
 * Verify that an on-chain metricUrl (ipfs://<CID>) resolves to a valid manifest
 * and, when an expected CID / sha256 is provided (e.g. from the DB), that they
 * match. Because content is fetched by CID from the gateway, a successful,
 * schema-valid fetch already implies the CID addresses this exact content.
 */
export async function verifyMetricUrlManifest(
  metricUrl: string | null | undefined,
  opts: { expectedCid?: string | null; expectedSha256?: string | null; timeoutMs?: number } = {},
): Promise<ManifestVerification> {
  const cid = cidFromMetricUrl(metricUrl);
  if (!cid) {
    return { ok: false, cid: null, manifest: null, cidMatches: false, reason: 'metricUrl is not an ipfs:// pointer' };
  }
  const cidMatches = !opts.expectedCid || cidFromUri(opts.expectedCid) === cid;
  if (!cidMatches) {
    return { ok: false, cid, manifest: null, cidMatches: false, reason: 'on-chain CID does not match expected CID' };
  }
  try {
    const manifest = await resolveManifest(cid, {
      expectedSha256: opts.expectedSha256 || undefined,
      timeoutMs: opts.timeoutMs,
    });
    return { ok: true, cid, manifest, cidMatches: true };
  } catch (err: any) {
    return { ok: false, cid, manifest: null, cidMatches, reason: err?.message || 'manifest resolution failed' };
  }
}
