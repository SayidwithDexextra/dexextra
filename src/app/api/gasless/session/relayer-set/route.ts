import { NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { loadRelayerPoolFromEnv } from '@/lib/relayerKeys'
import { computeRelayerSetRoot } from '@/lib/relayerMerkle'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Returns the relayer set used for SessionPermitV2:
 * - addresses (public)
 * - relayerSetRoot (bytes32)
 *
 * The client uses this to sign a single session permit that authorizes any relayer in the set.
 */
export async function GET() {
  try {
    // Use the global keyset (no slots) so sessions authorize the full relayer fleet.
    const keys = loadRelayerPoolFromEnv({
      pool: 'global',
      globalJsonEnv: 'RELAYER_PRIVATE_KEYS_JSON',
      allowFallbackSingleKey: true,
    })
    const addrs = keys.map((k) => ethers.getAddress(k.address))
    const root = computeRelayerSetRoot(addrs)
    return NextResponse.json({ relayerAddresses: addrs, relayerSetRoot: root })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}





