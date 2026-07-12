import { NextRequest, NextResponse } from 'next/server';
import {
  buildMarketManifest,
  pinMarketManifest,
  type BuildManifestInput,
} from '@/lib/ipfs/marketManifest';

export const runtime = 'nodejs';

/**
 * Build + pin a market manifest to IPFS (Pinata).
 *
 * Pins server-side because PINATA_JWT must never be exposed to the client.
 * The client calls this BEFORE signing the MetaCreateV2 message so it can set
 * metricUrl = ipfs://<cid> (which binds the manifest into the marketId hash
 * and the EIP-712 signature).
 *
 * POST /api/markets/manifest
 * Body: BuildManifestInput (marketType, legs, baseline, startPrice, settlementRule, baseValue?)
 * Returns: { cid, uri, sha256, size }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as BuildManifestInput;

    if (!body?.marketType) {
      return NextResponse.json({ error: 'marketType is required' }, { status: 400 });
    }
    if (!body?.startPrice?.value) {
      return NextResponse.json({ error: 'startPrice.value is required' }, { status: 400 });
    }
    if ((body.marketType === 'ratio' || body.marketType === 'indexed') && !body.legs?.denominator) {
      return NextResponse.json(
        { error: 'ratio/indexed markets require both numerator and denominator legs' },
        { status: 400 },
      );
    }
    if (body.marketType === 'indexed' && !body.baseline) {
      return NextResponse.json(
        { error: 'indexed markets require a baseline' },
        { status: 400 },
      );
    }

    const manifest = buildMarketManifest(body);
    const pinned = await pinMarketManifest(manifest);

    return NextResponse.json({
      cid: pinned.cid,
      uri: pinned.uri,
      sha256: pinned.sha256,
      size: pinned.size,
    });
  } catch (error: any) {
    console.error('[markets/manifest] pin failed:', error?.message || error);
    return NextResponse.json(
      { error: error?.message || 'Failed to build/pin manifest' },
      { status: 500 },
    );
  }
}
