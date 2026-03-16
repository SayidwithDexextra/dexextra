import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { ethers } from 'ethers'
import { createClient as createSbClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'

// TradeRecorded(bytes32 indexed marketId, address indexed buyer, address indexed seller,
//   uint256 price, uint256 amount, uint256 buyerFee, uint256 sellerFee, uint256 timestamp, uint256 liquidationPrice)
const TRADE_RECORDED_TOPIC = '0x728bed593a905dc538dfce2542eb359251213509bd5f44012a2fc977c3e48fac'
const FEE_STRUCTURE_UPDATED_TOPIC = '0xb678e9191cf9254064a297a28478e1d3fcbc1dd3ec4b77edca977ce85865aab3'

const TRADE_RECORDED_ABI = [
  'event TradeRecorded(bytes32 indexed marketId, address indexed buyer, address indexed seller, uint256 price, uint256 amount, uint256 buyerFee, uint256 sellerFee, uint256 timestamp, uint256 liquidationPrice)'
]
const FEE_STRUCTURE_UPDATED_ABI = [
  'event FeeStructureUpdated(uint256 takerFeeBps, uint256 makerFeeBps, address protocolFeeRecipient, uint256 protocolFeeShareBps)'
]

const tradeIface = new ethers.Interface(TRADE_RECORDED_ABI)
const feeStructIface = new ethers.Interface(FEE_STRUCTURE_UPDATED_ABI)

const processedSet = new Set<string>()
const MAX_PROCESSED = 50_000

function getSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY
  if (!url || !key) return null
  return createSbClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

function verifySignature(rawBody: string, signature: string, signingKey: string): boolean {
  try {
    const hmac = createHmac('sha256', signingKey)
    hmac.update(rawBody, 'utf8')
    return signature === hmac.digest('hex')
  } catch {
    return false
  }
}

// Resolve market symbol/id from Supabase by contract address
const marketCache = new Map<string, { market_id: string; symbol: string; creator_wallet_address: string | null } | null>()

async function resolveMarket(sb: ReturnType<typeof createSbClient>, contractAddress: string) {
  const key = contractAddress.toLowerCase()
  if (marketCache.has(key)) return marketCache.get(key)!

  let result: { market_id: string; symbol: string; creator_wallet_address: string | null } | null = null
  try {
    const { data } = await sb
      .from('markets')
      .select('id, symbol, market_identifier, creator_wallet_address')
      .ilike('market_address', key)
      .limit(1)
      .maybeSingle()
    if (data) {
      result = {
        market_id: String(data.id),
        symbol: String(data.symbol || data.market_identifier || data.id),
        creator_wallet_address: data.creator_wallet_address ? String(data.creator_wallet_address).toLowerCase() : null,
      }
    }
  } catch {}

  marketCache.set(key, result)
  return result
}

// Per-market fee config cache (from FeeStructureUpdated events or on-chain reads)
interface FeeConfig {
  takerFeeBps: number
  makerFeeBps: number
  protocolFeeShareBps: number
  protocolFeeRecipient: string | null
}
const feeConfigCache = new Map<string, FeeConfig>()

function determineTakerMaker(
  buyerFee: bigint,
  sellerFee: bigint,
  _config: FeeConfig | undefined
): { buyerRole: 'taker' | 'maker'; sellerRole: 'taker' | 'maker' } {
  // Taker always pays the higher fee (0.045%) vs maker (0.015%).
  // Compare the raw fee amounts directly — no config needed.
  if (buyerFee > sellerFee) {
    return { buyerRole: 'taker', sellerRole: 'maker' }
  }
  if (sellerFee > buyerFee) {
    return { buyerRole: 'maker', sellerRole: 'taker' }
  }
  // Equal fees (legacy flat-fee mode or identical amounts): default buyer as taker
  return { buyerRole: 'taker', sellerRole: 'maker' }
}

function splitFee(totalUsdc: number, protocolShareBps: number): { protocol: number; owner: number } {
  const protocol = Number(((totalUsdc * protocolShareBps) / 10000).toFixed(6))
  const owner = Number((totalUsdc - protocol).toFixed(6))
  return { protocol, owner }
}

interface StandardLog {
  address: string
  topics: string[]
  data: string
  transactionHash: string
  blockNumber?: number | string
  logIndex?: number | string
}

function normalizeBlockNumber(raw: number | string | undefined): number {
  if (raw === undefined || raw === null) return 0
  if (typeof raw === 'string') {
    return raw.startsWith('0x') ? parseInt(raw, 16) : parseInt(raw, 10)
  }
  return raw
}

async function processTradeRecordedLog(
  log: StandardLog,
  sb: ReturnType<typeof createSbClient>
): Promise<number> {
  const parsed = tradeIface.parseLog({ topics: log.topics, data: log.data })
  if (!parsed) return 0

  const marketIdBytes32 = parsed.args[0] as string      // indexed
  const buyer = (parsed.args[1] as string).toLowerCase() // indexed
  const seller = (parsed.args[2] as string).toLowerCase() // indexed
  const price = parsed.args[3] as bigint
  const amount = parsed.args[4] as bigint
  const buyerFee = parsed.args[5] as bigint
  const sellerFee = parsed.args[6] as bigint

  console.log(`[fees] TradeRecorded parsed → buyer=${buyer} seller=${seller} price=${price} amount=${amount} buyerFee=${buyerFee} sellerFee=${sellerFee} marketId=${marketIdBytes32.slice(0, 18)}…`)

  if (buyerFee === 0n && sellerFee === 0n) {
    console.log('[fees]   Both fees are 0 — skipping')
    return 0
  }

  const contractAddress = log.address.toLowerCase()
  const blockNumber = normalizeBlockNumber(log.blockNumber)
  const txHash = log.transactionHash

  // Resolve market
  const market = await resolveMarket(sb, contractAddress)
  const marketId = market?.symbol || marketIdBytes32.slice(0, 18)

  // Compute notional (6 decimals: amount is 1e18, price is 6 decimals)
  const notional6 = (amount * price) / BigInt(1e18)
  const notionalUsdc = Number(notional6) / 1e6

  // Fee config for this market
  const config = feeConfigCache.get(contractAddress)
  const protocolShareBps = config?.protocolFeeShareBps ?? 8000
  const protocolRecipient = config?.protocolFeeRecipient
    ?? ((process.env.PROTOCOL_FEE_RECIPIENT || process.env.NEXT_PUBLIC_PROTOCOL_FEE_RECIPIENT || '').toLowerCase() || null)
  const marketOwner = market?.creator_wallet_address ?? null

  const { buyerRole, sellerRole } = determineTakerMaker(buyerFee, sellerFee, config)

  const rows: any[] = []

  const logIdx = typeof log.logIndex === 'string'
    ? (log.logIndex.startsWith('0x') ? parseInt(log.logIndex, 16) : parseInt(log.logIndex, 10))
    : (log.logIndex ?? 0)
  const syntheticTradeId = blockNumber * 10000 + logIdx

  const priceDecimal = ethers.formatUnits(price, 6)
  const amountDecimal = ethers.formatUnits(amount, 18)

  const sharedFields = {
    market_id: marketId,
    market_address: contractAddress,
    trade_id: syntheticTradeId,
    trade_price: priceDecimal,
    trade_amount: amountDecimal,
    trade_notional: notionalUsdc,
    tx_hash: txHash,
    block_number: blockNumber,
    chain_id: 999,
    protocol_fee_recipient: protocolRecipient,
    market_owner_address: marketOwner,
  }

  if (buyerFee > 0n) {
    const feeUsdc = Number(buyerFee) / 1e6
    const { protocol, owner } = splitFee(feeUsdc, protocolShareBps)
    rows.push({
      ...sharedFields,
      user_address: buyer,
      fee_role: buyerRole,
      fee_amount: ethers.formatUnits(buyerFee, 6),
      fee_amount_usdc: feeUsdc,
      protocol_share: protocol,
      owner_share: owner,
      counterparty_address: seller,
    })
  }

  if (sellerFee > 0n) {
    const feeUsdc = Number(sellerFee) / 1e6
    const { protocol, owner } = splitFee(feeUsdc, protocolShareBps)
    rows.push({
      ...sharedFields,
      user_address: seller,
      fee_role: sellerRole,
      fee_amount: ethers.formatUnits(sellerFee, 6),
      fee_amount_usdc: feeUsdc,
      protocol_share: protocol,
      owner_share: owner,
      counterparty_address: buyer,
    })
  }

  if (rows.length > 0) {
    console.log(`[fees]   Upserting ${rows.length} fee row(s):`, JSON.stringify(rows.map(r => ({ user: r.user_address, role: r.fee_role, fee_usdc: r.fee_amount_usdc, notional: r.trade_notional, market: r.market_id }))))
    const { error } = await sb.from('trading_fees').upsert(rows, {
      onConflict: 'market_address,trade_id,user_address,fee_role',
      ignoreDuplicates: true,
    })
    if (error) {
      console.error('[fees] Supabase insert error:', error.message, error.details, error.hint)
      return 0
    }
    console.log(`[fees]   Upsert successful`)
  }

  return rows.length
}

function processFeeStructureUpdatedLog(log: StandardLog) {
  try {
    const parsed = feeStructIface.parseLog({ topics: log.topics, data: log.data })
    if (!parsed) return

    const takerFeeBps = Number(parsed.args[0])
    const makerFeeBps = Number(parsed.args[1])
    const protocolFeeShareBps = Number(parsed.args[3])

    const protocolFeeRecipient = (parsed.args[2] as string)?.toLowerCase() || null

    const contractAddress = log.address.toLowerCase()
    feeConfigCache.set(contractAddress, { takerFeeBps, makerFeeBps, protocolFeeShareBps, protocolFeeRecipient })
    console.log(`[fees] Updated fee config for ${contractAddress}: taker=${takerFeeBps} maker=${makerFeeBps} share=${protocolFeeShareBps} recipient=${protocolFeeRecipient}`)
  } catch (e: any) {
    console.error('[fees] Failed to parse FeeStructureUpdated:', e?.message)
  }
}

function extractLogs(webhookData: any): StandardLog[] {
  const logs: StandardLog[] = []

  // ADDRESS_ACTIVITY
  const activities = webhookData.event?.activity || []
  for (const act of activities) {
    if (!act.log?.topics?.length) continue
    logs.push({
      address: act.log.address,
      topics: act.log.topics,
      data: act.log.data || '0x',
      transactionHash: act.hash || act.log.transactionHash,
      blockNumber: act.blockNum,
      logIndex: act.log.logIndex,
    })
  }

  // MINED_TRANSACTION
  const txLogs = webhookData.event?.transaction?.logs || []
  for (const tl of txLogs) {
    if (!tl.topics?.length) continue
    logs.push({
      address: tl.address,
      topics: tl.topics,
      data: tl.data || '0x',
      transactionHash: tl.transactionHash || webhookData.event?.transaction?.hash,
      blockNumber: tl.blockNumber || webhookData.event?.transaction?.blockNumber,
      logIndex: tl.logIndex,
    })
  }

  // GRAPHQL / custom
  const gqlLogs = webhookData.event?.data?.block?.logs || []
  for (const gl of gqlLogs) {
    if (!gl.topics?.length) continue
    logs.push({
      address: gl.account?.address || gl.address,
      topics: gl.topics,
      data: gl.data || '0x',
      transactionHash: gl.transaction?.hash,
      blockNumber: gl.transaction?.blockNumber,
      logIndex: gl.index ?? gl.logIndex,
    })
  }

  return logs
}

export async function POST(request: NextRequest) {
  const startTime = Date.now()

  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-alchemy-signature')

    const signingKey = process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_FEES
    if (signingKey && signature) {
      if (!verifySignature(rawBody, signature, signingKey)) {
        return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
      }
    } else if (!signingKey) {
      console.warn('[fees] ALCHEMY_WEBHOOK_SIGNING_KEY_FEES not set — skipping signature verification')
    }

    const webhookData = JSON.parse(rawBody)

    console.log('[fees] ── Incoming webhook payload ──')
    console.log('[fees] webhookId:', webhookData.webhookId)
    console.log('[fees] id:', webhookData.id)
    console.log('[fees] type:', webhookData.type)
    console.log('[fees] event keys:', Object.keys(webhookData.event || {}))
    console.log('[fees] raw payload (truncated):', JSON.stringify(webhookData).slice(0, 2000))

    const sb = getSupabase()
    if (!sb) {
      console.error('[fees] Supabase not configured')
      return NextResponse.json({ error: 'Database not configured' }, { status: 500 })
    }

    const allLogs = extractLogs(webhookData)
    console.log(`[fees] Extracted ${allLogs.length} logs from payload`)
    for (let i = 0; i < allLogs.length; i++) {
      const l = allLogs[i]
      console.log(`[fees]   log[${i}] address=${l.address} topic0=${l.topics[0]?.slice(0, 18)}… tx=${l.transactionHash?.slice(0, 18)}… block=${l.blockNumber} logIdx=${l.logIndex}`)
    }
    let inserted = 0
    let feeConfigUpdates = 0

    for (const log of allLogs) {
      if (!log.topics?.[0]) continue

      const eventId = `${log.transactionHash}:${log.logIndex}`
      if (processedSet.has(eventId)) continue

      const topic0 = log.topics[0]

      if (topic0 === FEE_STRUCTURE_UPDATED_TOPIC) {
        processFeeStructureUpdatedLog(log)
        feeConfigUpdates++
        processedSet.add(eventId)
        continue
      }

      if (topic0 === TRADE_RECORDED_TOPIC) {
        try {
          const count = await processTradeRecordedLog(log, sb)
          inserted += count
          processedSet.add(eventId)
        } catch (e: any) {
          console.error(`[fees] Failed to process TradeRecorded: ${e?.message}`)
        }
      }
    }

    // Evict oldest entries to prevent unbounded memory growth
    if (processedSet.size > MAX_PROCESSED) {
      const toDelete = processedSet.size - MAX_PROCESSED
      let i = 0
      for (const key of processedSet) {
        if (i++ >= toDelete) break
        processedSet.delete(key)
      }
    }

    const elapsed = Date.now() - startTime
    console.log(`[fees] Processed ${allLogs.length} logs → ${inserted} fee rows, ${feeConfigUpdates} config updates (${elapsed}ms)`)

    return NextResponse.json({
      success: true,
      logsReceived: allLogs.length,
      feeRowsInserted: inserted,
      feeConfigUpdates,
      elapsed: `${elapsed}ms`,
    })
  } catch (error: any) {
    console.error('[fees] Webhook error:', error?.message || error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    description: 'Trading fee ingestion webhook for TradeRecorded + FeeStructureUpdated events',
    topics: {
      TradeRecorded: TRADE_RECORDED_TOPIC,
      FeeStructureUpdated: FEE_STRUCTURE_UPDATED_TOPIC,
    },
    processedCount: processedSet.size,
    cachedMarkets: marketCache.size,
    cachedFeeConfigs: feeConfigCache.size,
    timestamp: new Date().toISOString(),
  })
}
