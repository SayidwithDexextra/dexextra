import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { withRelayer, sendWithNonceRetry, isInsufficientFundsError } from '@/lib/relayerRouter'
import {
  createWithdrawalJob,
  markWithdrawalStep,
  failOrRequeueWithdrawalJob,
  completeWithdrawalJob,
} from '@/lib/withdrawalJobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const COLLATERAL_HUB_ABI = [
  'function requestWithdraw(address user, uint64 targetChainId, uint256 amount) external returns (bytes32)',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

const HUB_OUTBOX_ABI = [
  'function sendWithdraw(uint64 dstDomain, address user, address token, uint256 amount, bytes32 withdrawId) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
] as const

const SPOKE_INBOX_ABI = [
  'function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes payload) external',
  'function hasRole(bytes32 role, address account) view returns (bool)',
  'function remoteAppByDomain(uint64) view returns (bytes32)',
] as const

type SpokeChainConfig = {
  name: string
  chainId: number
  usdcAddress: string
  inboxAddress: string
  rpcList: (string | undefined)[]
}

function getSpokeConfig(chainId: number): SpokeChainConfig {
  // Arbitrum is the only supported spoke chain. Polygon was removed.
  if (chainId === 42161) {
    return {
      name: 'arbitrum',
      chainId: 42161,
      // Use Native USDC for withdrawals (matches deposit token in SpokeVault)
      // Hardcoded fallback due to Vercel env var sync issues
      usdcAddress: process.env.SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      // V3 SpokeInboxAdapter (2026-05-05)
      inboxAddress: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || '0x8FDFAF6146318DD893E89E5ac2e3FD73554c02b6',
      rpcList: [
        process.env.ALCHEMY_ARBITRUM_HTTP,
        process.env.RPC_URL_ARBITRUM,
        process.env.ARBITRUM_RPC_URL,
        'https://arb-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-',
      ],
    }
  }
  throw new Error(`Unsupported target chain: ${chainId} (only Arbitrum / 42161 is supported)`)
}

function getHubRpc(): string {
  const rpc =
    process.env.HUB_RPC_URL ||
    process.env.ALCHEMY_HYPERLIQUID_HTTP ||
    process.env.RPC_URL_HUB ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.RPC_URL ||
    ''
  if (!rpc) throw new Error('Missing hub RPC URL')
  return rpc
}

function toBytes32Address(addr: string): string {
  const hex = addr.toLowerCase().replace(/^0x/, '')
  return '0x' + '0'.repeat(24) + hex
}

function shortErr(err: any): string {
  return String(err?.reason || err?.shortMessage || err?.message || err || '').slice(0, 800)
}

export async function POST(request: NextRequest) {
  const tag = '[cross-chain-withdraw]'

  let body: any
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { user, amount, targetChainId } = body as {
    user?: string
    amount?: string
    targetChainId?: number
  }

  if (!user || !ethers.isAddress(user)) {
    return NextResponse.json({ error: 'Invalid user address' }, { status: 400 })
  }
  if (!amount || isNaN(Number(amount)) || Number(amount) <= 0) {
    return NextResponse.json({ error: 'Invalid amount' }, { status: 400 })
  }
  if (!targetChainId || targetChainId !== 42161) {
    return NextResponse.json(
      { error: 'targetChainId must be 42161 (Arbitrum). Polygon withdrawals are not supported.' },
      { status: 400 }
    )
  }

  const spokeCfg = getSpokeConfig(targetChainId)
  const amountWei = ethers.parseUnits(amount, 6)

  // Hardcoded fallbacks due to Vercel env var sync issues
  const collateralHubAddr = process.env.COLLATERAL_HUB_ADDRESS || '0xB4d81a5093dB98de9088a061fb1b3982Fe09D3b5'
  const hubOutboxAddr = process.env.HUB_OUTBOX_ADDRESS || '0x4c32ff22b927a134a3286d5E33212debF951AcF5'
  if (!collateralHubAddr || !ethers.isAddress(collateralHubAddr)) {
    return NextResponse.json({ error: 'COLLATERAL_HUB_ADDRESS not configured' }, { status: 500 })
  }
  if (!hubOutboxAddr || !ethers.isAddress(hubOutboxAddr)) {
    return NextResponse.json({ error: 'HUB_OUTBOX_ADDRESS not configured' }, { status: 500 })
  }

  const spokeUsdcAddr = spokeCfg.usdcAddress
  if (!spokeUsdcAddr || !ethers.isAddress(spokeUsdcAddr)) {
    return NextResponse.json(
      { error: `USDC address not configured for ${spokeCfg.name}` },
      { status: 500 }
    )
  }

  const spokeInboxAddr = spokeCfg.inboxAddress
  if (!spokeInboxAddr || !ethers.isAddress(spokeInboxAddr)) {
    return NextResponse.json(
      { error: `Spoke inbox not configured for ${spokeCfg.name}` },
      { status: 500 }
    )
  }

  // Persist the saga BEFORE touching the chain so we never lose track of an
  // in-flight withdrawal (and the retry worker can pick it up if we crash).
  let jobId = ''
  try {
    jobId = await createWithdrawalJob({
      user,
      targetChainId,
      amountWei,
      amountHuman: amount,
      spokeToken: spokeUsdcAddr,
      metadata: {
        spokeName: spokeCfg.name,
        spokeInbox: spokeInboxAddr.toLowerCase(),
        hubOutbox: hubOutboxAddr.toLowerCase(),
        collateralHub: collateralHubAddr.toLowerCase(),
      },
      maxAttempts: 8,
    })
  } catch (e: any) {
    console.error(`${tag} failed to create withdrawal job`, shortErr(e))
    return NextResponse.json(
      { error: 'Failed to persist withdrawal job; refusing to start chain calls.' },
      { status: 500 }
    )
  }

  console.log(`${tag} job ${jobId} starting`, {
    user, targetChainId, amount, spokeInbox: spokeInboxAddr,
  })

  const hubProvider = new ethers.JsonRpcProvider(getHubRpc())
  const hubDomain = Number(process.env.BRIDGE_DOMAIN_HUB || '999')
  let withdrawId: string = ''

  // ─────────── STEP 1: requestWithdraw on hub ───────────
  // This is the ONLY irreversible step from a user-credit POV. If this
  // succeeds and step 2/3 fail, the retry worker handles the rest.
  await markWithdrawalStep(jobId, 'hub_debiting')

  try {
    await withRelayer({
      pool: 'hub_inbox',
      provider: hubProvider,
      action: async (wallet) => {
        const hub = new ethers.Contract(collateralHubAddr, COLLATERAL_HUB_ABI, wallet)

        try {
          withdrawId = await hub.requestWithdraw.staticCall(user, targetChainId, amountWei)
        } catch (simErr: any) {
          throw new Error(`CollateralHub.requestWithdraw simulate failed: ${shortErr(simErr)}`)
        }

        const tx = await sendWithNonceRetry({
          provider: hubProvider,
          wallet,
          contract: hub as any,
          method: 'requestWithdraw',
          args: [user, targetChainId, amountWei],
          label: 'withdraw:hub:requestWithdraw',
        })
        const rc = await tx.wait()
        console.log(`${tag} job ${jobId} step1 confirmed`, { txHash: tx.hash, block: rc?.blockNumber })

        if (!withdrawId) {
          const iface = new ethers.Interface([
            'event WithdrawIntent(address indexed user, uint64 targetChainId, uint256 amount, bytes32 withdrawId)',
          ])
          for (const log of rc?.logs || []) {
            try {
              const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
              if (parsed?.name === 'WithdrawIntent') { withdrawId = parsed.args.withdrawId; break }
            } catch {}
          }
        }

        await markWithdrawalStep(jobId, 'hub_debited', {
          withdraw_id: withdrawId || undefined,
          hub_request_tx: tx.hash,
          hub_request_block: rc?.blockNumber ?? undefined,
        })
      },
    })
  } catch (err: any) {
    // Step 1 failure → user wasn't debited. Mark hub_debit_failed (terminal).
    await markWithdrawalStep(jobId, 'hub_debit_failed', { last_error: shortErr(err) }).catch(() => {})
    if (isInsufficientFundsError(err)) {
      return NextResponse.json(
        { jobId, error: 'all_relayers_insufficient_funds', message: 'All hub relayers are out of gas. Please retry shortly.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ jobId, error: shortErr(err) }, { status: 500 })
  }

  if (!withdrawId) {
    await failOrRequeueWithdrawalJob(jobId, 'no withdrawId after step1', 'requires_manual', 0).catch(() => {})
    return NextResponse.json(
      { jobId, error: 'Failed to obtain withdrawId from CollateralHub' },
      { status: 500 }
    )
  }

  // ─────────── STEP 2: sendWithdraw on hub outbox ───────────
  // From here on, any failure is RECOVERABLE by the retry worker because
  // we have withdrawId persisted. We mark `outbox_failed` so the worker
  // knows to re-emit the WithdrawSent event.
  await markWithdrawalStep(jobId, 'hub_sending')
  try {
    await withRelayer({
      pool: 'hub_inbox',
      provider: hubProvider,
      action: async (wallet) => {
        const outbox = new ethers.Contract(hubOutboxAddr, HUB_OUTBOX_ABI, wallet)
        try {
          await outbox.sendWithdraw.staticCall(targetChainId, user, spokeUsdcAddr, amountWei, withdrawId)
        } catch (simErr: any) {
          throw new Error(`HubBridgeOutbox.sendWithdraw simulate failed: ${shortErr(simErr)}`)
        }
        const tx = await sendWithNonceRetry({
          provider: hubProvider,
          wallet,
          contract: outbox as any,
          method: 'sendWithdraw',
          args: [targetChainId, user, spokeUsdcAddr, amountWei, withdrawId],
          label: 'withdraw:hub:sendWithdraw',
        })
        const rc = await tx.wait()
        console.log(`${tag} job ${jobId} step2 confirmed`, { txHash: tx.hash })
        await markWithdrawalStep(jobId, 'hub_sent', {
          hub_send_tx: tx.hash,
          hub_send_block: rc?.blockNumber ?? undefined,
        })
      },
    })
  } catch (err: any) {
    const outcome = await failOrRequeueWithdrawalJob(
      jobId, shortErr(err), 'outbox_failed', 30
    ).catch(() => 'requeued' as const)
    return NextResponse.json(
      {
        jobId, withdrawId,
        error: 'hub_outbox_failed',
        message: 'Hub debit succeeded; outbox send failed and is queued for retry.',
        recoverable: outcome !== 'requires_manual',
      },
      { status: 202 }
    )
  }

  // ─────────── STEP 3: deliver to spoke ───────────
  const spokeRpc = spokeCfg.rpcList.find((v) => !!v) || ''
  if (!spokeRpc) {
    await failOrRequeueWithdrawalJob(jobId, `No RPC for ${spokeCfg.name}`, 'spoke_pending', 30).catch(() => {})
    return NextResponse.json(
      { jobId, withdrawId, error: 'spoke_rpc_missing', message: `No RPC configured for ${spokeCfg.name}; queued for retry.` },
      { status: 202 }
    )
  }

  const spokeProvider = new ethers.JsonRpcProvider(spokeRpc)
  const srcDomain = hubDomain

  const hubOutboxRemoteApp =
    process.env.BRIDGE_REMOTE_APP_HUB_FOR_ARBITRUM ||
    process.env.BRIDGE_REMOTE_APP_HUB ||
    (hubOutboxAddr ? toBytes32Address(hubOutboxAddr) : '')

  if (!hubOutboxRemoteApp || !/^0x[0-9a-fA-F]{64}$/.test(hubOutboxRemoteApp)) {
    await failOrRequeueWithdrawalJob(jobId, 'Cannot derive hub remote app', 'spoke_pending', 60).catch(() => {})
    return NextResponse.json(
      { jobId, withdrawId, error: 'spoke_remote_app_missing', message: 'Cannot derive hub remote app; queued for retry.' },
      { status: 202 }
    )
  }

  const TYPE_WITHDRAW = 2
  const spokePayload = ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint8', 'address', 'address', 'uint256', 'bytes32'],
    [TYPE_WITHDRAW, user, spokeUsdcAddr, amountWei, withdrawId]
  )

  const spokePoolName = 'spoke_inbox_arbitrum'

  await markWithdrawalStep(jobId, 'spoke_delivering')

  try {
    await withRelayer({
      pool: spokePoolName,
      provider: spokeProvider,
      action: async (wallet) => {
        const inbox = new ethers.Contract(spokeInboxAddr, SPOKE_INBOX_ABI, wallet)

        try {
          await inbox.receiveMessage.staticCall(srcDomain, hubOutboxRemoteApp, spokePayload)
        } catch (simErr: any) {
          throw new Error(`SpokeBridgeInbox.receiveMessage simulate failed: ${shortErr(simErr)}`)
        }

        const fee = await spokeProvider.getFeeData().catch(() => ({} as any))
        const maxPriorityFeePerGas = ethers.parseUnits('0.05', 'gwei')
        const base = fee?.maxFeePerGas || fee?.gasPrice || maxPriorityFeePerGas * 2n
        const maxFeePerGas = base + maxPriorityFeePerGas

        let gasLimit = 150000n
        try {
          const est = await inbox.receiveMessage.estimateGas(srcDomain, hubOutboxRemoteApp, spokePayload)
          gasLimit = (est * 130n) / 100n
        } catch {}

        const tx = await sendWithNonceRetry({
          provider: spokeProvider,
          wallet,
          contract: inbox as any,
          method: 'receiveMessage',
          args: [srcDomain, hubOutboxRemoteApp, spokePayload],
          overrides: { gasLimit, maxFeePerGas, maxPriorityFeePerGas },
          label: `withdraw:spoke:${spokeCfg.name}`,
        })
        const rc = await tx.wait()
        console.log(`${tag} job ${jobId} step3 confirmed`, { txHash: tx.hash })
        await completeWithdrawalJob(jobId, tx.hash, rc?.blockNumber ?? undefined)
      },
    })
  } catch (err: any) {
    const outcome = await failOrRequeueWithdrawalJob(
      jobId, shortErr(err), 'spoke_failed', 30
    ).catch(() => 'requeued' as const)
    return NextResponse.json(
      {
        jobId, withdrawId,
        error: 'spoke_delivery_failed',
        message: 'Hub steps succeeded; spoke delivery failed and is queued for retry.',
        recoverable: outcome !== 'requires_manual',
        hubSent: true,
      },
      { status: 202 }
    )
  }

  console.log(`${tag} job ${jobId} complete`, { user, targetChainId, withdrawId })
  return NextResponse.json({ success: true, jobId, withdrawId, targetChainId, amount })
}
