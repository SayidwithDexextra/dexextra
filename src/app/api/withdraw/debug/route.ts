import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const config = {
    SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS: process.env.SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS || 'NOT_SET',
    SPOKE_INBOX_ADDRESS_ARBITRUM: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || 'NOT_SET',
    COLLATERAL_HUB_ADDRESS: process.env.COLLATERAL_HUB_ADDRESS || 'NOT_SET',
    HUB_OUTBOX_ADDRESS: process.env.HUB_OUTBOX_ADDRESS || 'NOT_SET',
    RELAYER_PRIVATE_KEY: process.env.RELAYER_PRIVATE_KEY ? 'SET (hidden)' : 'NOT_SET',
    
    // Computed fallbacks
    usdcAddressFallback: process.env.SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
    inboxAddressFallback: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || '0x8FDFAF6146318DD893E89E5ac2e3FD73554c02b6',
    collateralHubFallback: process.env.COLLATERAL_HUB_ADDRESS || '0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5',
    hubOutboxFallback: process.env.HUB_OUTBOX_ADDRESS || '0x4c32ff22b927a134a3286d5E33212debF951AcF5',
  }
  
  return NextResponse.json(config)
}
