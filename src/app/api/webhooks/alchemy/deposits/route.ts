import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { ethers } from 'ethers'
import { createClient } from '@supabase/supabase-js'
import { sendWithNonceRetry, withRelayer } from '@/lib/relayerRouter'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const preferredRegion = 'iad1'

function strip0x(h?: string | null): string {
  if (!h) return ''
  return h.startsWith('0x') ? h.slice(2) : h
}

function isHexString(v: any): boolean {
  return typeof v === 'string' && /^0x[0-9a-fA-F]*$/.test(v)
}

function parseUint256(hex: string): bigint {
  const s = strip0x(hex)
  return s ? BigInt('0x' + s) : 0n
}

function maskAddr(addr?: string | null): string | null {
  try {
    if (!addr) return null
    const a = ethers.getAddress(addr)
    return a.slice(0, 6) + '...' + a.slice(-4)
  } catch {
    return addr || null
  }
}

function toLowerAddressMaybe(v?: string | null): string {
  try {
    if (v && /^0x[0-9a-fA-F]{40}$/.test(v)) return ethers.getAddress(v).toLowerCase()
  } catch {}
  return ''
}

function getEnvAddressLower(k: string): string {
  return toLowerAddressMaybe((process.env as any)[k] || '')
}

function parseChainIdFromPayload(data: any): number | null {
  const raw =
    (data && (data.chainId || data?.event?.chainId || data?.event?.data?.chainId)) || null
  if (raw == null) return null
  try {
    if (typeof raw === 'number') return raw
    if (typeof raw === 'string') {
      // supports decimal or hex (e.g. '0xa4b1')
      const n = Number(raw)
      return Number.isFinite(n) && n > 0 ? n : null
    }
  } catch {}
  return null
}

function inferChainIdFromLogs(logs: any[]): number | null {
  try {
    const polyVault = getEnvAddressLower('SPOKE_POLYGON_VAULT_ADDRESS')
    const polyUsdc = getEnvAddressLower('SPOKE_POLYGON_USDC_ADDRESS')
    const arbVault = getEnvAddressLower('SPOKE_ARBITRUM_VAULT_ADDRESS')
    const arbUsdc = getEnvAddressLower('SPOKE_ARBITRUM_USDC_ADDRESS')
    const anyMatch = (addr: string) =>
      !!addr &&
      logs.some((log: any) => {
        const la = toLowerAddressMaybe(log?.address)
        return la === addr
      })
    if (anyMatch(arbUsdc) || anyMatch(arbVault)) return 42161
    if (anyMatch(polyUsdc) || anyMatch(polyVault)) return 137
  } catch {}
  return null
}

function getTokenDecimals(tokenAddr?: string | null): number {
  try {
    const usdc = (process.env.SPOKE_POLYGON_USDC_ADDRESS || '').toLowerCase()
    const usdcDec = parseInt(process.env.SPOKE_POLYGON_USDC_DECIMALS || '6', 10)
    if (tokenAddr && usdc && tokenAddr.toLowerCase() === usdc) return usdcDec
  } catch {}
  return parseInt(process.env.DEFAULT_TOKEN_DECIMALS || '18', 10)
}

function parseDecimalToBaseUnits(value: string, decimals: number): bigint {
  if (!value) return 0n
  const neg = value.startsWith('-')
  const v = neg ? value.slice(1) : value
  const [whole, fracRaw = ''] = v.split('.')
  if (!/^[0-9]*$/.test(whole) || !/^[0-9]*$/.test(fracRaw)) return 0n
  const frac = fracRaw.slice(0, decimals).padEnd(decimals, '0')
  const digits = (whole || '0') + frac
  const bn = BigInt(digits || '0')
  return neg ? -bn : bn
}

function decodedValueBigInt(log: any, tokenAddr?: string | null): bigint | null {
  const params = Array.isArray(log?.decoded?.params) ? log.decoded.params : []
  const valueParam = params.find(
    (x: any) => String(x?.name || '').toLowerCase() === 'value'
  )
  if (!valueParam) return null
  const v = valueParam?.value
  try {
    if (typeof v === 'bigint') return v
    if (typeof v === 'number') return BigInt(v)
    if (typeof v === 'string') {
      if (isHexString(v)) return parseUint256(v)
      if (/^[0-9]+(\.[0-9]+)?$/.test(v)) {
        return parseDecimalToBaseUnits(v, getTokenDecimals(tokenAddr))
      }
      return BigInt(v)
    }
  } catch {
    return null
  }
  return null
}

function resolveAmountFromLog(log: any, tokenAddr?: string | null): bigint {
  if (typeof log?.data === 'string' && isHexString(log.data) && log.data.length > 2) {
    return parseUint256(log.data)
  }
  const dec = decodedValueBigInt(log, tokenAddr)
  if (dec !== null) return dec
  const rawHex = (log as any)?.rawContract?.rawValue
  if (typeof rawHex === 'string' && isHexString(rawHex) && rawHex.length > 2) {
    return parseUint256(rawHex)
  }
  const rawVal = (log as any)?.rawContract?.value
  if (typeof rawVal === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(rawVal)) {
    return parseDecimalToBaseUnits(rawVal, getTokenDecimals(tokenAddr))
  }
  const erc20Val = (log as any)?.erc20?.value
  if (typeof erc20Val === 'string' && /^[0-9]+(\.[0-9]+)?$/.test(erc20Val)) {
    return parseDecimalToBaseUnits(erc20Val, getTokenDecimals(tokenAddr))
  }
  const valHex = (log as any)?.value
  if (typeof valHex === 'string' && isHexString(valHex) && valHex.length > 2) {
    return parseUint256(valHex)
  }
  return 0n
}

// Polygon RPC helpers (ONLY for webhook decoding, receipt lookup, finality checks on Polygon)
async function fetchRpc(method: string, params: any[], chainId: number): Promise<any | null> {
  const cfg = getChainConfig(chainId)
  const rpc = cfg.rpcList.find((v) => !!v) || ''
  if (!rpc) {
    console.warn(`[alchemy-deposits][rpc:missing] Cannot decode webhook without RPC for chainId=${chainId}`)
    return null
  }
  try {
    const res = await fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method,
        params,
      }),
    })
    const j: any = await res.json()
    if (j?.result !== undefined) return j.result
    console.warn('[alchemy-deposits][rpc:error]', j?.error || j)
    return null
  } catch (e: any) {
    console.error('[alchemy-deposits][rpc:exception]', String(e?.message || e))
    return null
  }
}

async function fetchReceiptByChain(txHash: string, chainId: number): Promise<any | null> {
  return await fetchRpc('eth_getTransactionReceipt', [txHash], chainId)
}

async function fetchBlockNumberByChain(chainId: number): Promise<bigint | null> {
  const r = await fetchRpc('eth_blockNumber', [], chainId)
  try {
    return r ? BigInt(r) : null
  } catch {
    return null
  }
}

function verifyAlchemySignature(
  rawBody: string,
  signature: string | null,
  signingKey: string | undefined
): boolean {
  if (!signature || !signingKey) return false
  try {
    const hmac = createHmac('sha256', signingKey)
    hmac.update(rawBody, 'utf8')
    const digest = hmac.digest('hex')
    return signature === digest
  } catch {
    return false
  }
}

function topicToAddress(topic: string): string {
  // topic is 32-byte hex; last 20 bytes are the address
  const hex = topic.toLowerCase().replace(/^0x/, '')
  const addr = '0x' + hex.slice(24)
  return ethers.getAddress(addr)
}

function toBytes32Address(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, '')
  return '0x' + '0'.repeat(24) + hex
}

function candidateTokenAddress(log: any): string {
  const c =
    log?.address ||
    log?.contractAddress ||
    log?.account?.address ||
    log?.rawContract?.address ||
    log?.erc20?.contract ||
    log?.tokenAddress ||
    ''
  return ethers.getAddress(c)
}

function encodeDepositIdFromTx(
  chainId: number,
  txHash: string,
  logIndex: number
): string {
  const abi = ethers.AbiCoder.defaultAbiCoder()
  return ethers.keccak256(
    abi.encode(['uint64', 'bytes32', 'uint32'], [chainId, txHash, logIndex])
  )
}

function extractLogs(body: any): any[] {
  const direct = body?.logs
  const eventLogs = body?.event?.logs
  const dataLogs = body?.event?.data?.logs
  const blockLogs = body?.event?.data?.block?.logs
  if (Array.isArray(direct)) return direct
  if (Array.isArray(eventLogs)) return eventLogs
  if (Array.isArray(dataLogs)) return dataLogs
  if (Array.isArray(blockLogs)) return blockLogs
  const activity = body?.event?.activity
  if (Array.isArray(activity) && activity.length) {
    const pseudo: any[] = []
    for (let i = 0; i < activity.length; i++) {
      const a = activity[i]
      const cat = String(a?.category || '').toLowerCase()
      const txHash = a?.hash || a?.transactionHash || ''
      const tokenAddr = a?.rawContract?.address || ''
      const from = a?.fromAddress || a?.from || ''
      const to = a?.toAddress || a?.to || ''
      const rawHex = a?.rawContract?.rawValue || a?.rawContract?.value
      const val = a?.value
      if (!tokenAddr || !from || !to) continue
      if (!cat.includes('token')) continue
      let amount = 0n
      if (isHexString(rawHex)) amount = parseUint256(rawHex)
      else if (typeof val === 'string') {
        const dec = Number(process.env.SPOKE_POLYGON_USDC_DECIMALS || '6')
        amount = ethers.parseUnits(val, dec)
      } else if (typeof val === 'number') {
        const dec = Number(process.env.SPOKE_POLYGON_USDC_DECIMALS || '6')
        amount = ethers.parseUnits(String(val), dec)
      }
      const dataHex = ethers.AbiCoder.defaultAbiCoder().encode(['uint256'], [amount])
      pseudo.push({
        address: tokenAddr,
        topics: [
          ethers.id('Transfer(address,address,uint256)'),
          toBytes32Address(from),
          toBytes32Address(to),
        ],
        data: dataHex,
        transactionHash: txHash,
        logIndex: i,
      })
    }
    return pseudo
  }
  return []
}

function getTxIdFromLog(log: any): string {
  try {
    return (
      log?.transactionHash ||
      log?.hash ||
      (log as any)?.tx_hash ||
      log?.transaction?.hash ||
      (log as any)?.receipt?.transactionHash ||
      (log as any)?.metadata?.transactionHash ||
      (log as any)?.meta?.transactionHash ||
      (log as any)?.event?.transaction?.hash ||
      ''
    )
  } catch {
    return ''
  }
}

function selectReceiptTransferLog(
  receipt: any,
  opts: { tokenAddr?: string; vaultAddr?: string; alchFrom?: string; alchTo?: string }
): any | null {
  try {
    const logs: any[] = Array.isArray(receipt?.logs) ? receipt.logs : []
    const t0 = ethers.id('Transfer(address,address,uint256)').toLowerCase()
    const tokenLc = String(opts.tokenAddr || '').toLowerCase()
    const vaultTopic = opts.vaultAddr ? toBytes32Address(opts.vaultAddr).toLowerCase() : ''
    const alchFromTopic = opts.alchFrom ? toBytes32Address(opts.alchFrom).toLowerCase() : ''
    const alchToTopic = opts.alchTo ? toBytes32Address(opts.alchTo).toLowerCase() : ''
    let cands = logs.filter(
      (lg: any) =>
        Array.isArray(lg?.topics) &&
        lg.topics.length >= 3 &&
        String(lg.topics[0]).toLowerCase() === t0
    )
    if (tokenLc) {
      cands = cands.filter((lg: any) => String(lg?.address || '').toLowerCase() === tokenLc)
    }
    if (vaultTopic) {
      const byVault = cands.filter((lg: any) => String(lg.topics[2]).toLowerCase() === vaultTopic)
      if (byVault.length) cands = byVault
    }
    if (alchToTopic && cands.length > 1) {
      const byTo = cands.filter((lg: any) => String(lg.topics[2]).toLowerCase() === alchToTopic)
      if (byTo.length) cands = byTo
    }
    if (alchFromTopic && cands.length > 1) {
      const byFrom = cands.filter((lg: any) => String(lg.topics[1]).toLowerCase() === alchFromTopic)
      if (byFrom.length) cands = byFrom
    }
    return cands[0] || null
  } catch {
    return null
  }
}

function ensureSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL as string
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY) as string
  if (!url || !key) return null
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

// Chain-aware config helpers
function getChainConfig(chainId: number) {
  const cfg = {
    name: chainId === 137 ? 'polygon' : chainId === 42161 ? 'arbitrum' : 'unknown',
    domain: chainId,
    vaultEnv:
      chainId === 137 ? 'SPOKE_POLYGON_VAULT_ADDRESS' : chainId === 42161 ? 'SPOKE_ARBITRUM_VAULT_ADDRESS' : '',
    usdcEnv:
      chainId === 137 ? 'SPOKE_POLYGON_USDC_ADDRESS' : chainId === 42161 ? 'SPOKE_ARBITRUM_USDC_ADDRESS' : '',
    outboxEnv:
      chainId === 137 ? 'SPOKE_OUTBOX_ADDRESS_POLYGON' : chainId === 42161 ? 'SPOKE_OUTBOX_ADDRESS_ARBITRUM' : '',
    inboxEnv:
      chainId === 137 ? 'SPOKE_INBOX_ADDRESS_POLYGON' : chainId === 42161 ? 'SPOKE_INBOX_ADDRESS_ARBITRUM' : '',
    rpcList:
      chainId === 137
        ? [
            process.env.ALCHEMY_POLYGON_HTTP,
            process.env.RPC_URL_POLYGON,
            process.env.POLYGON_RPC_URL,
            process.env.NEXT_PUBLIC_ALCHEMY_POLYGON_HTTP,
          ]
        : chainId === 42161
        ? [
            process.env.ALCHEMY_ARBITRUM_HTTP,
            process.env.RPC_URL_ARBITRUM,
            process.env.ARBITRUM_RPC_URL,
            process.env.NEXT_PUBLIC_ALCHEMY_ARBITRUM_HTTP,
          ]
        : [],
    finality:
      chainId === 137
        ? Number(process.env.POLYGON_FINALITY_BLOCKS || '20')
        : chainId === 42161
        ? Number(process.env.ARBITRUM_FINALITY_BLOCKS || '10')
        : 20,
  }
  return cfg
}

// Spoke provider (Polygon or Arbitrum) for spoke operations: sendDeposit, gas estimation
async function getSpokeProviderForChain(chainId: number): Promise<ethers.JsonRpcProvider> {
  const cfg = getChainConfig(chainId)
  const rpc = cfg.rpcList.find((v) => !!v) || ''
  if (!rpc) {
    if (chainId === 137) {
      throw new Error('Missing Polygon RPC (ALCHEMY_POLYGON_HTTP/POLYGON_RPC_URL/RPC_URL_POLYGON)')
    }
    if (chainId === 42161) {
      throw new Error('Missing Arbitrum RPC (ALCHEMY_ARBITRUM_HTTP/ARBITRUM_RPC_URL/RPC_URL_ARBITRUM)')
    }
    throw new Error('Missing spoke RPC')
  }
  console.log('[alchemy-deposits] 🔗 using Spoke RPC', { chainId, name: cfg.name })
  return new ethers.JsonRpcProvider(rpc)
}

// Hyperliquid provider (ONLY for hub chain delivery: receiveMessage on HubBridgeInboxWormhole)
async function getHubProvider(): Promise<ethers.JsonRpcProvider> {
  const hubRpc =
    process.env.HUB_RPC_URL ||
    process.env.ALCHEMY_HYPERLIQUID_HTTP ||
    process.env.RPC_URL_HUB ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.HYPERLIQUID_RPC_URL ||
    ''
  if (!hubRpc) {
    throw new Error('Missing Hyperliquid RPC (HUB_RPC_URL/ALCHEMY_HYPERLIQUID_HTTP/RPC_URL_HUB)')
  }
  console.log('[alchemy-deposits] 🔗 using Hyperliquid RPC for hub delivery')
  return new ethers.JsonRpcProvider(hubRpc)
}

function getDepositRelayerWallet(provider: ethers.JsonRpcProvider, label: string): ethers.Wallet {
  const raw = String(process.env.RELAYER_PRIVATE_KEY || '').trim()
  if (!raw) {
    throw new Error('[alchemy-deposits] RELAYER_PRIVATE_KEY is not set; cannot relay gasless deposits')
  }
  const pk = raw.startsWith('0x') ? raw : `0x${raw}`
  if (!/^0x[0-9a-fA-F]{64}$/.test(pk)) {
    throw new Error('[alchemy-deposits] RELAYER_PRIVATE_KEY must be a 32-byte hex string (0x...)')
  }
  const wallet = new ethers.Wallet(pk, provider)
  console.log('[alchemy-deposits] using single deposit relayer', { label, address: wallet.address })
  return wallet
}

async function sendDepositOnSpoke(params: {
  user: string
  token: string
  amount: bigint
  txHash: string
  logIndex: number
  chainId: number
}) {
  const cfg = getChainConfig(params.chainId)
  // Prefer chain-specific outbox env, fallback to generic if explicitly provided
  const outboxAddr =
    (cfg.outboxEnv ? (process.env as any)[cfg.outboxEnv] : '') ||
    process.env.SPOKE_OUTBOX_ADDRESS
  if (!outboxAddr || !ethers.isAddress(outboxAddr)) {
    throw new Error('SPOKE_OUTBOX_ADDRESS (chain-specific) is not set')
  }
  const dstDomain = Number(process.env.BRIDGE_DOMAIN_HUB || '999')
  const provider = await getSpokeProviderForChain(params.chainId)
  const wallet = getDepositRelayerWallet(provider, `spoke:${cfg.name}`)

  const OutboxIface = new ethers.Interface([
    'function sendDeposit(uint64 dstDomain, address user, address token, uint256 amount, bytes32 depositId) external',
    'function hasRole(bytes32 role, address account) view returns (bool)',
  ])
  const outbox = new ethers.Contract(outboxAddr, OutboxIface, wallet)

  const network = await provider.getNetwork()
  const chainId = Number(network.chainId)
  const depositId = encodeDepositIdFromTx(chainId, params.txHash, params.logIndex)

  // Optional simulate to catch reverts
  try {
    await outbox.sendDeposit.staticCall(
      Number(dstDomain),
      params.user,
      params.token,
      params.amount,
      depositId
    )
    console.log('[alchemy-deposits] outbox simulate ok', { depositId })
  } catch (simErr: any) {
    throw new Error(`Outbox simulate failed: ${simErr?.reason || simErr?.message || String(simErr)}`)
    // do not proceed with transaction if simulate failed
  }

  // Chain-aware gas settings with sane fallbacks
  const chainCfg = getChainConfig(chainId)
  const fee = await provider.getFeeData().catch(() => ({} as any))
  const priorityEnv =
    chainCfg.name === 'polygon'
      ? process.env.POLYGON_MAX_PRIORITY_GWEI
      : chainCfg.name === 'arbitrum'
      ? process.env.ARBITRUM_MAX_PRIORITY_GWEI
      : undefined
  const feeEnv =
    chainCfg.name === 'polygon'
      ? process.env.POLYGON_MAX_FEE_GWEI
      : chainCfg.name === 'arbitrum'
      ? process.env.ARBITRUM_MAX_FEE_GWEI
      : undefined
  const gasLimitEnv =
    chainCfg.name === 'polygon'
      ? process.env.POLYGON_GAS_LIMIT
      : chainCfg.name === 'arbitrum'
      ? process.env.ARBITRUM_GAS_LIMIT
      : undefined
  const maxPriorityFallback =
    chainCfg.name === 'polygon'
      ? ethers.parseUnits('35', 'gwei')
      : chainCfg.name === 'arbitrum'
      ? ethers.parseUnits('0.05', 'gwei')
      : ethers.parseUnits('1', 'gwei')
  const maxPriorityFeePerGas =
    (priorityEnv ? ethers.parseUnits(priorityEnv, 'gwei') : undefined) ||
    fee?.maxPriorityFeePerGas ||
    maxPriorityFallback
  const base = fee?.maxFeePerGas || fee?.gasPrice || maxPriorityFeePerGas * 2n
  const maxFeePerGas =
    (feeEnv ? ethers.parseUnits(feeEnv, 'gwei') : undefined) ||
    (chainCfg.name === 'arbitrum'
      ? base + maxPriorityFeePerGas // smaller margin on Arbitrum
      : base + maxPriorityFeePerGas * 2n)
  // Try estimating gas; fallback to env/defaults
  let gasLimit: bigint = 0n
  try {
    const est = await (outbox.estimateGas as any).sendDeposit(
      Number(dstDomain),
      params.user,
      params.token,
      params.amount,
      depositId
    )
    gasLimit = (est * 120n) / 100n // +20% buffer
  } catch {
    try {
      const n = Number(gasLimitEnv)
      gasLimit =
        Number.isFinite(n) && n > 0
          ? BigInt(n)
          : chainCfg.name === 'arbitrum'
          ? 120000n
          : 250000n
    } catch {
      gasLimit = chainCfg.name === 'arbitrum' ? 120000n : 250000n
    }
  }
  try {
    console.log('[alchemy-deposits] outbox gas', {
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas?.toString?.() || String(maxFeePerGas),
      maxPriorityFeePerGas: maxPriorityFeePerGas?.toString?.() || String(maxPriorityFeePerGas),
    })
  } catch {}

  // Optional role check per selected key (best-effort)
  try {
    const DEPOSIT_SENDER_ROLE = ethers.keccak256(ethers.toUtf8Bytes('DEPOSIT_SENDER_ROLE'))
    const has = await outbox.hasRole(DEPOSIT_SENDER_ROLE, wallet.address)
    console.log('[alchemy-deposits] outbox config', {
      outbox: outboxAddr,
      dstDomain,
      relayer: wallet.address,
      depositId,
      hasRole: has,
    })
    if (!has) console.warn('[alchemy-deposits] relayer missing DEPOSIT_SENDER_ROLE on outbox')
  } catch {}

  const tx = await sendWithNonceRetry({
    provider,
    wallet,
    contract: outbox as any,
    method: 'sendDeposit',
    args: [Number(dstDomain), params.user, params.token, params.amount, depositId],
    overrides: { gasLimit, maxFeePerGas, maxPriorityFeePerGas },
    label: `deposit:outbox:${cfg.name}`,
  })
  const rc = await tx.wait()
  return { txHash: tx.hash, blockNumber: rc?.blockNumber, depositId }
}

async function deliverToHub(params: {
  user: string
  token: string
  amount: bigint
  depositId: string
  chainId: number
}) {
  const hubInbox = process.env.HUB_INBOX_ADDRESS
  if (!hubInbox || !ethers.isAddress(hubInbox)) {
    throw new Error('HUB_INBOX_ADDRESS is not set')
  }
  const cfg = getChainConfig(params.chainId)
  const srcDomain =
    cfg.domain ||
    (cfg.name === 'polygon' ? 137 : cfg.name === 'arbitrum' ? 42161 : 0)
  const chainOutbox =
    (cfg.outboxEnv ? (process.env as any)[cfg.outboxEnv] : '') ||
    process.env.SPOKE_OUTBOX_ADDRESS ||
    ''
  const srcApp =
    (cfg.name === 'polygon' ? process.env.BRIDGE_REMOTE_APP_POLYGON : process.env.BRIDGE_REMOTE_APP_ARBITRUM) ||
    (chainOutbox ? toBytes32Address(chainOutbox) : '')
  if (!srcApp || !/^0x[0-9a-fA-F]{64}$/.test(srcApp)) {
    throw new Error('Missing chain-specific remote app or outbox to derive srcApp')
  }
  const provider = await getHubProvider()
  const wallet = getDepositRelayerWallet(provider, 'hub_inbox')

  const HubInboxIface = new ethers.Interface([
    'function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes payload) external',
    'function hasRole(bytes32 role, address account) view returns (bool)',
    'function remoteAppByDomain(uint64) view returns (bytes32)',
  ])
  const hubRead = new ethers.Contract(hubInbox, HubInboxIface, provider)
  const hub = new ethers.Contract(hubInbox, HubInboxIface, wallet)

  const TYPE_DEPOSIT = 1
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint8', 'address', 'address', 'uint256', 'bytes32'],
    [TYPE_DEPOSIT, params.user, params.token, params.amount, params.depositId]
  )
  
  console.log('[alchemy-deposits] hub delivery params', {
    hubInbox,
    srcDomain,
    srcApp,
    depositId: params.depositId,
    user: params.user,
    token: params.token,
    amount: params.amount.toString(),
    payloadLength: payload.length,
  })
  
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes('BRIDGE_ENDPOINT_ROLE'))
  // Role check is done against the selected relayer during send.
  // Validate remote app allowlist matches srcApp
  try {
    const expectedRemote: string = await hubRead.remoteAppByDomain(Number(srcDomain))
    console.log('[alchemy-deposits] remoteAppByDomain check', {
      srcDomain,
      srcApp,
      expectedRemote,
      matches: String(expectedRemote).toLowerCase() === String(srcApp).toLowerCase(),
    })
  } catch (e: any) {
    console.warn('[alchemy-deposits] remoteAppByDomain read failed:', e?.message || e)
  }
  // Preflight simulate (as the relayer address so AccessControl checks see the correct sender)
  try {
    await hub.receiveMessage.staticCall(Number(srcDomain), srcApp, payload)
    console.log('[alchemy-deposits] ✅ hub.receiveMessage simulate OK')
  } catch (simErr: any) {
    const simMsg = simErr?.reason || simErr?.shortMessage || simErr?.message || String(simErr)
    console.error('[alchemy-deposits] ❌ hub.receiveMessage simulate failed', simMsg)
    if (typeof simMsg === 'string' && simMsg.toLowerCase().includes('processed')) {
      // Idempotent: already processed on hub; skip sending
      return { txHash: null, blockNumber: null, status: 'already_processed' }
    }
    // For other simulate failures, bubble up to caller (avoid sending a reverting tx)
    throw simErr
  }

  const fee = await provider.getFeeData().catch(() => ({} as any))
  const maxPriorityFeePerGasDefault = ethers.parseUnits('3', 'gwei')
  const maxPriorityFeePerGas =
    (process.env.HUB_MAX_PRIORITY_GWEI ? ethers.parseUnits(process.env.HUB_MAX_PRIORITY_GWEI, 'gwei') : undefined) ||
    fee?.maxPriorityFeePerGas ||
    maxPriorityFeePerGasDefault
  const base = fee?.maxFeePerGas || fee?.gasPrice || maxPriorityFeePerGas * 2n
  const maxFeePerGas =
    (process.env.HUB_MAX_FEE_GWEI ? ethers.parseUnits(process.env.HUB_MAX_FEE_GWEI, 'gwei') : undefined) ||
    (base + maxPriorityFeePerGas * 2n)
  const gasLimit =
    (() => {
      try {
        const n = Number(process.env.HUB_GAS_LIMIT)
        return Number.isFinite(n) && n > 0 ? BigInt(n) : 300000n
      } catch {
        return 300000n
      }
    })()
  try {
    console.log('[alchemy-deposits] hub gas', {
      gasLimit: gasLimit.toString(),
      maxFeePerGas: maxFeePerGas?.toString?.() || String(maxFeePerGas),
      maxPriorityFeePerGas: maxPriorityFeePerGas?.toString?.() || String(maxPriorityFeePerGas),
    })
  } catch {}

  // Standard contract call (mirror send-deposit.js) using the single deposit relayer
  // Optional role check per selected key
  try {
    const has = await hub.hasRole(BRIDGE_ENDPOINT_ROLE, wallet.address)
    console.log('[alchemy-deposits] BRIDGE_ENDPOINT_ROLE check', { relayer: wallet.address, hasRole: has })
    if (!has) {
      console.error('[alchemy-deposits] ❌ CRITICAL: hub relayer missing BRIDGE_ENDPOINT_ROLE - delivery will fail')
    }
  } catch (e: any) {
    console.warn('[alchemy-deposits] role check failed:', e?.message || e)
  }
  const tx = await sendWithNonceRetry({
    provider,
    wallet,
    contract: hub as any,
    method: 'receiveMessage',
    args: [Number(srcDomain), srcApp, payload],
    overrides: { gasLimit, maxFeePerGas, maxPriorityFeePerGas },
    label: 'deposit:hub:receiveMessage',
  })
  const rc = await tx.wait()
  return { txHash: tx.hash, blockNumber: rc?.blockNumber }
}

export async function POST(request: NextRequest) {
  try {
    console.log('[alchemy-deposits] 📥 webhook received');
    const rawBody = await request.text()
    const signature = request.headers.get('x-alchemy-signature')

    // Track which key matched to use as a chain hint later
    let matchedLabel: string | null = null

    // Accept multiple Alchemy signing keys (Polygon + Arbitrum) and legacy names
    const keyCandidates = [
      { key: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_DEPOSITS_POLYGON, label: 'DEPOSITS_POLYGON' },
      { key: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_DEPOSITS_ARBITRUM, label: 'DEPOSITS_ARBITRUM' },
      { key: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY_DEPOSITS, label: 'DEPOSITS' },
      { key: process.env.ALCHEMY_WEBHOOK_SIGNING_KEY, label: 'LEGACY' },
      ...((String(process.env.ALCHEMY_WEBHOOK_SIGNING_KEYS_DEPOSITS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)).map((k, i) => ({ key: k, label: `LIST_DEPOSITS[${i}]` }))),
      ...((String(process.env.ALCHEMY_WEBHOOK_SIGNING_KEYS || '')
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)).map((k, i) => ({ key: k, label: `LIST[${i}]` }))),
    ].filter((x) => !!x.key) as { key: string, label: string }[]

    if (keyCandidates.length > 0) {
      let verified = false
      for (const k of keyCandidates) {
        if (verifyAlchemySignature(rawBody, signature, k.key)) {
          verified = true
          matchedLabel = k.label
          break
        }
      }
      if (!verified) {
        console.error('[alchemy-deposits] ❌ signature verification failed (no keys matched)');
        return NextResponse.json(
          { ok: false, reason: 'invalid_signature' },
          { status: 200 }
        )
      }
      console.log('[alchemy-deposits] ✅ signature verified (multi-key)', { matched: matchedLabel });
    } else {
      console.log('[alchemy-deposits] ℹ️ no signing key configured, skipping verification');
    }

    const data = JSON.parse(rawBody)
    console.log('[alchemy-deposits] 🔎 payload keys:', Object.keys(data || {}))

    // Extract logs similar to Edge function, then determine chain
    const logs = extractLogs(data)
    // Resolve chainId with robust strategy and no env-based bias
    let chainId = parseChainIdFromPayload(data)
    let chainSource = 'payload'
    if (!(Number.isFinite(chainId) && chainId! > 0)) {
      // Use signature hint if available
      const hint =
        matchedLabel && matchedLabel.toUpperCase().includes('ARBITRUM')
          ? 42161
          : matchedLabel && matchedLabel.toUpperCase().includes('POLYGON')
          ? 137
          : null
      if (hint) {
        chainId = hint
        chainSource = 'signature'
      }
    }
    if (!(Number.isFinite(chainId) && chainId! > 0)) {
      const infer = inferChainIdFromLogs(Array.isArray(logs) ? logs : [])
      if (infer) {
        chainId = infer
        chainSource = 'logs'
      }
    }
    if (!Number.isFinite(chainId) || (chainId as any) <= 0) {
      chainId = 137
      chainSource = 'default'
    }
    const chainIdNum = Number(chainId as number)
    const cfg = getChainConfig(chainIdNum)
    const VAULT = (cfg.vaultEnv ? (process.env as any)[cfg.vaultEnv] : '') || ''
    const usdc = (cfg.usdcEnv ? (process.env as any)[cfg.usdcEnv] : undefined) as string | undefined
    const outboxEnvVal = (cfg.outboxEnv ? (process.env as any)[cfg.outboxEnv] : '') as string
    const outboxGeneric = process.env.SPOKE_OUTBOX_ADDRESS || ''
    const hubInbox = process.env.HUB_INBOX_ADDRESS || ''
    const domainHub = process.env.BRIDGE_DOMAIN_HUB || ''
    console.log('[alchemy-deposits] 🔧 config snapshot', {
      chainId: chainIdNum,
      chain: cfg.name,
      chainSource,
      sigKeyMatched: matchedLabel,
      vault: maskAddr(VAULT),
      usdc: maskAddr(usdc || ''),
      outbox: maskAddr(outboxEnvVal || outboxGeneric),
      hubInbox: maskAddr(hubInbox),
      domainHub,
      rpcConfigured: !!(cfg.rpcList.find(v => !!v)),
      finality: cfg.finality,
    })
    if (!usdc || !VAULT) {
      console.error('[alchemy-deposits] ❌ missing USDC or SpokeVault env');
      // Return 200 to prevent Alchemy retries; we can still view logs and fix config without being spammed
      return NextResponse.json(
        { ok: false, reason: 'missing_env', detail: 'Spoke USDC or SpokeVault env not set for this chain' },
        { status: 200 }
      )
    }
    console.log('[alchemy-deposits] payload snapshot', {
      logCount: Array.isArray(logs) ? logs.length : 0,
      chainId,
      VAULT: VAULT ? VAULT.slice(0, 6) + '...' + VAULT.slice(-4) : null,
    })

    if (!Array.isArray(logs) || logs.length === 0) {
      console.log('[alchemy-deposits] ⏭️ no logs, ack')
      return NextResponse.json(
        { ok: true, inserted: 0, reason: 'no logs' },
        { status: 200 }
      )
    }

    // Lazily resolve provider only when needed so missing RPC does not cause a 500 (which triggers webhook retries)
    let provider: ethers.JsonRpcProvider | null = null
    try {
      provider = await getSpokeProviderForChain(chainIdNum)
    } catch (e: any) {
      console.warn('[alchemy-deposits] ⚠️ Spoke RPC not configured; proceeding without provider', e?.message || e)
    }
    const supabase = ensureSupabase()
    const results: any[] = []
    const FINALITY = cfg.finality

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i]
      try {
        const topics: string[] = Array.isArray(log?.topics) ? log.topics : []
        if (topics.length < 3) {
          console.log('[alchemy-deposits] skip: insufficient topics', { i, topicsLen: topics.length })
          continue
        }
        // Debug: log the raw log to see what fields Alchemy sends
        console.log('[alchemy-deposits] 🔍 raw log fields:', {
          i,
          keys: Object.keys(log || {}),
          transactionHash: log?.transactionHash,
          hash: log?.hash,
          tx_hash: log?.tx_hash,
          transaction: log?.transaction,
          blockHash: log?.blockHash,
        })

        const txHash = getTxIdFromLog(log)
        const blockHash = (log as any)?.blockHash || (log as any)?.block?.hash || ''
        const txId = txHash || blockHash || '0x' + '0'.repeat(64)
        
        console.log('[alchemy-deposits] 🔍 extracted txHash:', { i, txHash, blockHash, txId })
        
        const from_hint = topicToAddress(topics[1])
        const to_hint = topicToAddress(topics[2])
        let tokenAddr = candidateTokenAddress(log)
        let from = from_hint
        let to = to_hint
        let amountBn: bigint | null = null
        let chosen: any | null = null

        // CRITICAL: Alchemy webhook doesn't include log.data, so we MUST fetch receipt via RPC
        if (txHash) {
          console.log('[alchemy-deposits] 🔍 fetching receipt for txHash:', txHash)
          let receipt: any | null = await fetchReceiptByChain(txHash, chainIdNum)
          let hadReceipt = !!receipt
          if (!receipt) {
            console.log('[alchemy-deposits] ⚠️ RPC receipt not found, trying provider fallback')
            try {
              if (provider) {
                receipt = await provider.getTransactionReceipt(txHash)
              }
            } catch (e: any) {
              console.error('[alchemy-deposits] ❌ provider receipt failed:', e?.message || e)
            }
          }
          if (receipt) {
            console.log('[alchemy-deposits] ✅ receipt found, logs count:', receipt?.logs?.length || 0)
          } else {
            console.log('[alchemy-deposits] ❌ NO RECEIPT - cannot extract amount')
          }
          chosen = receipt
            ? selectReceiptTransferLog(receipt, {
                tokenAddr,
                vaultAddr: VAULT,
                alchFrom: from_hint,
                alchTo: to_hint,
              })
            : null
          console.log('[alchemy-deposits][rpc:first]', { 
            i, 
            hadReceipt, 
            foundLog: !!chosen,
            chosenData: chosen?.data,
            chosenAddress: chosen?.address,
          })
          if (chosen) {
            tokenAddr = ethers.getAddress(chosen?.address || tokenAddr)
            if (Array.isArray(chosen?.topics) && chosen.topics.length >= 3) {
              from = topicToAddress(chosen.topics[1])
              to = topicToAddress(chosen.topics[2])
            }
            if (typeof chosen?.data === 'string' && isHexString(chosen.data)) {
              amountBn = parseUint256(chosen.data)
              console.log('[alchemy-deposits] ✅ amount from chosen.data (receipt)', { i, amount: amountBn.toString(), data: chosen.data })
            }
          }
        }

        // Fallback 1: try log.data directly (edge.txt line 449)
        if (amountBn === null && typeof log?.data === 'string' && isHexString(log.data) && log.data.length > 2) {
          amountBn = parseUint256(log.data)
          console.log('[alchemy-deposits] ✅ amount from log.data', { i, amount: amountBn.toString(), data: log.data })
        }

        // Fallback 2: try decoded.params.value (edge.txt line 450-452: decodedValueBigInt)
        if (amountBn === null) {
          const dec = decodedValueBigInt(log, tokenAddr)
          if (dec !== null) {
            amountBn = dec
            console.log('[alchemy-deposits] ✅ amount from decoded.params.value', { i, amount: amountBn.toString() })
          }
        }

        // Debug: log the raw log structure if still null
        if (amountBn === null || amountBn === 0n) {
          console.log('[alchemy-deposits] 🔍 DEBUG raw log structure:', {
            i,
            hasData: !!log?.data,
            dataLength: log?.data?.length,
            dataValue: log?.data,
            hasDecoded: !!log?.decoded,
            decodedParams: log?.decoded?.params,
            hasRawContract: !!log?.rawContract,
            rawContractRawValue: log?.rawContract?.rawValue,
            rawContractValue: log?.rawContract?.value,
            topicsLength: topics?.length,
          })
        }

        // Final: ensure non-null
        if (amountBn === null) {
          amountBn = 0n
        }
        const address = ethers.getAddress(tokenAddr || '')
        const logIndex: number =
          typeof log?.logIndex === 'string' ? parseInt(log.logIndex, 16) : Number(log?.logIndex ?? i)
        const finalAmount = amountBn ?? 0n
        if (finalAmount === 0n) {
          console.log('[alchemy-deposits] ⚠️ resolved zero amount after fallbacks', {
            i,
            txId,
            tokenAddr: address,
            from,
            to,
          })
        }
        const depositId = encodeDepositIdFromTx(chainIdNum, txId, logIndex)

        // Save claim row
        try {
          if (supabase) {
            const claimRow = {
              chain_id: chainId,
              tx_hash: txId,
              log_index: logIndex,
              user_address: from,
              token_address: address,
              amount: finalAmount.toString(),
              deposit_id: depositId,
              processed: false,
              received_at: new Date().toISOString(),
            }
            const { error: claimError } = await supabase.from('bridge_deposits').insert([claimRow] as any)
            if (claimError) {
              console.error('[alchemy-deposits] supabase insert error', {
                depositId,
                code: (claimError as any)?.code,
                message: (claimError as any)?.message,
              })
            }
          } else {
            console.warn('[alchemy-deposits] supabase not configured; skipping claim insert')
          }
        } catch (e) {
          console.error('[alchemy-deposits] supabase exception', (e as any)?.message || e)
        }

        // Check conditions for sending
        const OUTBOX =
          ((cfg.outboxEnv ? (process.env as any)[cfg.outboxEnv] : '') as string) ||
          process.env.SPOKE_OUTBOX_ADDRESS ||
          ''
        const DST_DOMAIN = Number(process.env.BRIDGE_DOMAIN_HUB || '0')
        const HAS_KEY =
          !!(process.env.RELAYER_PRIVATE_KEY ||
            (process.env as any).BRIDGE_RELAYER_PRIVATE_KEY ||
            (process.env as any).PRIVATE_KEY_RELAY ||
            process.env.PRIVATE_KEY)
        const HAS_RPC = !!(getChainConfig(chainIdNum).rpcList.find((v) => !!v))
        const isVaultMatch = !!(VAULT && to && VAULT.toLowerCase() === to.toLowerCase())

        if (isVaultMatch && OUTBOX && DST_DOMAIN && HAS_KEY && HAS_RPC && finalAmount > 0n) {
          // Finality check
          try {
            if (txHash) {
              // Try RPC blockNumber first (align with edge.txt)
              const r = await fetchReceiptByChain(txHash, chainIdNum)
              let blockNum: number | null = null
              if (r?.blockNumber) {
                try {
                  blockNum = Number(BigInt(r.blockNumber))
                } catch {}
              }
              if (blockNum == null && provider) {
                const provR = await provider.getTransactionReceipt(txHash).catch(() => null as any)
                if (provR?.blockNumber != null) blockNum = Number(provR.blockNumber)
              }
              if (blockNum != null) {
                let head: number | null = null
                const rpcHead = await fetchBlockNumberByChain(chainIdNum)
                if (rpcHead != null) {
                  try {
                    head = Number(rpcHead)
                  } catch {}
                }
                if (head == null && provider) {
                  head = await provider.getBlockNumber().catch(() => null as any)
                }
                if (typeof head === 'number' && Number.isFinite(head)) {
                  const confs = head - blockNum
                  if (confs < FINALITY) {
                    console.log('[alchemy-deposits] send skip: not final', { i, confs, required: FINALITY })
                    continue
                  }
                }
              }
            }
          } catch (e) {
            console.warn('[alchemy-deposits] finality check error', (e as any)?.message || e)
          }

          console.log('[alchemy-deposits] 🚀 sending spoke deposit', {
            user: from,
            token: address,
            amount: finalAmount.toString(),
            txHash: txId,
            logIndex,
          })
          try {
            const sent = await sendDepositOnSpoke({
              user: from,
              token: address,
              amount: finalAmount,
              txHash: txId,
              logIndex,
              chainId: chainIdNum,
            })
            console.log('[alchemy-deposits] ✅ spoke send complete', sent)
            // Update outbox hash
            try {
              if (supabase) {
                await supabase
                  .from('bridge_deposits')
                  .update({ outbox_tx_hash: sent.txHash } as any)
                  .eq('deposit_id', depositId)
              }
            } catch {}

            // Optional hub delivery
            let delivered: any = null
            const autoDeliver =
              process.env.AUTO_DELIVER_TO_HUB === '1' ||
              process.env.DELIVER_TO_HUB === '1' ||
              String(process.env.AUTO_DELIVER_TO_HUB || '').toLowerCase() === 'true'
            if (autoDeliver) {
              // Idempotency: skip if this deposit was already processed on hub
              try {
                if (supabase) {
                  const { data: existing, error: exErr } = await (supabase as any)
                    .from('bridge_deposits')
                    .select('processed')
                    .eq('deposit_id', depositId)
                    .maybeSingle()
                  if (!exErr && existing?.processed) {
                    console.log('[alchemy-deposits] ⏭️ hub delivery skipped (already processed)', { depositId })
                    results.push({ i, sent, delivered: null, status: 'already_processed' })
                    continue
                  }
                }
              } catch {}
              console.log('[alchemy-deposits] 📬 delivering to hub', {
                depositId,
                amount: finalAmount.toString(),
                user: from,
              })
              delivered = await deliverToHub({
                user: from,
                token: address,
                amount: finalAmount,
                depositId,
                chainId: chainIdNum,
              })
              console.log('[alchemy-deposits] ✅ hub delivery complete', delivered)
              // Mark processed in DB
              try {
                if (supabase) {
                  await (supabase as any)
                    .from('bridge_deposits')
                    .update({
                      hub_tx_hash: delivered?.txHash || null,
                      processed: true,
                      credited_at: new Date().toISOString(),
                    })
                    .eq('deposit_id', depositId)
                }
              } catch {}
            }
            results.push({ i, sent, delivered })
          } catch (e) {
            console.error('[alchemy-deposits] ❌ send error', (e as any)?.message || e)
            results.push({ i, status: 'send_error', message: (e as any)?.message || String(e) })
          }
        } else {
          console.log('[alchemy-deposits] ⏭️ send skip', {
            i,
            reason: {
              vaultMatch: isVaultMatch,
              hasOutbox: !!OUTBOX,
              hasDomain: !!DST_DOMAIN,
              hasKey: !!HAS_KEY,
              hasRpc: !!HAS_RPC,
              amountPositive: finalAmount > 0n,
            },
          })
          results.push({ i, status: 'skipped' })
        }
      } catch (e) {
        console.error('[alchemy-deposits] item error', (e as any)?.message || e)
      }
    }

    console.log('[alchemy-deposits] 🟢 processed', results.length, 'items')
    return NextResponse.json({ ok: true, processed: results.length, results })
  } catch (e: any) {
    console.error('[alchemy-deposits] ❌ error:', e?.message || e)
    return NextResponse.json(
      { ok: false, error: e?.message || 'internal error' },
      { status: 200 }
    )
  }
}


