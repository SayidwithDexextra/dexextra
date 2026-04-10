import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase-admin'
import { UserProfileService } from '@/lib/userProfileService'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const wallet = searchParams.get('wallet')

    if (!wallet || !/^0x[a-fA-F0-9]{40}$/.test(wallet)) {
      return NextResponse.json(
        { success: false, error: 'Invalid wallet address' },
        { status: 400 }
      )
    }

    const normalizedWallet = wallet.toLowerCase()

    const profile = await UserProfileService.getPublicProfile(normalizedWallet)
    
    if (profile?.analytics_privacy?.hide_from_public) {
      return NextResponse.json(
        { success: false, error: 'Analytics are private' },
        { status: 403 }
      )
    }

    const { data: feeData, error: feeError } = await supabaseAdmin
      .from('trading_fees')
      .select('amount, market_identifier')
      .ilike('user_address', normalizedWallet)

    if (feeError) {
      console.error('[PublicAnalytics] Fee query error:', feeError)
    }

    const { data: orderData, error: orderError } = await supabaseAdmin
      .from('userOrderHistory')
      .select('market_identifier, trade_amount, event_type, side')
      .ilike('trader_wallet_address', wallet)

    if (orderError) {
      console.error('[PublicAnalytics] Order query error:', orderError)
    }

    const totalFees = (feeData || []).reduce((sum, row) => sum + (parseFloat(row.amount) || 0), 0)
    const uniqueFeeMarkets = new Set((feeData || []).map(row => row.market_identifier).filter(Boolean))

    const filledOrders = (orderData || []).filter(
      o => o.event_type === 'FILLED' || o.event_type === 'PARTIALLY_FILLED'
    )
    const totalTrades = filledOrders.length
    const totalVolume = filledOrders.reduce((sum, o) => sum + (parseFloat(o.trade_amount) || 0), 0)
    const uniqueOrderMarkets = new Set((orderData || []).map(o => o.market_identifier).filter(Boolean))

    const allMarkets = new Set([...uniqueFeeMarkets, ...uniqueOrderMarkets])

    const buyCount = filledOrders.filter(o => o.side === 'BUY').length
    const winRate = totalTrades > 0 ? (buyCount / totalTrades) * 100 : 0

    return NextResponse.json({
      success: true,
      stats: {
        totalTrades,
        totalVolume,
        totalFees,
        winRate,
        marketsTraded: allMarkets.size,
      },
    })
  } catch (error) {
    console.error('[PublicAnalytics] Error:', error)
    return NextResponse.json(
      { success: false, error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}
