import { NextResponse } from 'next/server'
import { loadAllSessionRelayerAddresses } from '@/lib/relayerKeys'
import { computeRelayerSetRoot } from '@/lib/relayerMerkle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Returns the relayer set used for SessionPermitV2:
 * - addresses (public)
 * - relayerSetRoot (bytes32)
 *
 * The client uses this to sign a single session permit that authorizes any relayer in the set.
 *
 * IMPORTANT: This MUST cover every pool the trade router can route to
 * (small + big + legacy). If a pool is missing here, any trade routed to
 * that pool will revert with "session: bad relayer" because the relayer's
 * address won't be in the session's `relayerSetRoot` Merkle tree.
 */
export async function GET() {
  try {
    const addrs = loadAllSessionRelayerAddresses()
    const root = computeRelayerSetRoot(addrs)
    return NextResponse.json({ relayerAddresses: addrs, relayerSetRoot: root })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}





