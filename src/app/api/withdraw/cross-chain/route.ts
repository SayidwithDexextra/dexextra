import { NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'
import { withRelayer, sendWithNonceRetry, isInsufficientFundsError } from '@/lib/relayerRouter'

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
  if (chainId === 137) {
    return {
      name: 'polygon',
      chainId: 137,
      usdcAddress: process.env.SPOKE_POLYGON_USDC_ADDRESS || '',
      inboxAddress: process.env.SPOKE_INBOX_ADDRESS_POLYGON || process.env.SPOKE_INBOX_ADDRESS || '',
      rpcList: [
        process.env.ALCHEMY_POLYGON_HTTP,
        process.env.RPC_URL_POLYGON,
        process.env.POLYGON_RPC_URL,
      ],
    }
  }
  if (chainId === 42161) {
    return {
      name: 'arbitrum',
      chainId: 42161,
      // Use Native USDC for withdrawals (matches deposit token in SpokeVault)
      // Hardcoded fallback due to Vercel env var sync issues
      usdcAddress: process.env.SPOKE_ARBITRUM_NATIVE_USDC_ADDRESS || '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
      inboxAddress: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || '0x1adeA56c1005CcbAE9B043C974077ABad2Dc3d18',
      rpcList: [
        process.env.ALCHEMY_ARBITRUM_HTTP,
        process.env.RPC_URL_ARBITRUM,
        process.env.ARBITRUM_RPC_URL,
        'https://arb-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-',
      ],
    }
  }
  throw new Error(`Unsupported target chain: ${chainId}`)
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

export async function POST(request: NextRequest) {
  const tag = '[cross-chain-withdraw]'

  try {
    const body = await request.json()
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
    if (!targetChainId || (targetChainId !== 137 && targetChainId !== 42161)) {
      return NextResponse.json(
        { error: 'targetChainId must be 137 (Polygon) or 42161 (Arbitrum)' },
        { status: 400 }
      )
    }

    const spokeCfg = getSpokeConfig(targetChainId)
    const amountWei = ethers.parseUnits(amount, 6)
    
    // Debug: log the config being used
    console.log(`${tag} Using spoke config:`, {
      name: spokeCfg.name,
      usdcAddress: spokeCfg.usdcAddress,
      inboxAddress: spokeCfg.inboxAddress,
      envInboxValue: process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || 'NOT_SET',
    })

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

    const hubProvider = new ethers.JsonRpcProvider(getHubRpc())
    const hubDomain = Number(process.env.BRIDGE_DOMAIN_HUB || '999')

    // Step 1: Call CollateralHub.requestWithdraw on the hub chain
    // This debits userCrossChainCredit and emits WithdrawIntent
    console.log(`${tag} Step 1: requestWithdraw on CollateralHub`, {
      user,
      targetChainId,
      amount: amountWei.toString(),
    })

    let withdrawId: string = ''

    await withRelayer({
      pool: 'hub_inbox',
      provider: hubProvider,
      action: async (wallet) => {
        const hub = new ethers.Contract(collateralHubAddr, COLLATERAL_HUB_ABI, wallet)

        // Simulate first
        try {
          withdrawId = await hub.requestWithdraw.staticCall(user, targetChainId, amountWei)
          console.log(`${tag} requestWithdraw simulate OK`, { withdrawId })
        } catch (simErr: any) {
          const msg = simErr?.reason || simErr?.shortMessage || simErr?.message || String(simErr)
          console.error(`${tag} requestWithdraw simulate FAILED`, msg)
          throw new Error(`CollateralHub.requestWithdraw failed: ${msg}`)
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
        console.log(`${tag} requestWithdraw confirmed`, {
          txHash: tx.hash,
          block: rc?.blockNumber,
        })

        // Extract withdrawId from logs if static call didn't provide it
        if (!withdrawId) {
          const iface = new ethers.Interface([
            'event WithdrawIntent(address indexed user, uint64 targetChainId, uint256 amount, bytes32 withdrawId)',
          ])
          for (const log of rc?.logs || []) {
            try {
              const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data })
              if (parsed?.name === 'WithdrawIntent') {
                withdrawId = parsed.args.withdrawId
                break
              }
            } catch {}
          }
        }
      },
    })

    if (!withdrawId) {
      return NextResponse.json(
        { error: 'Failed to obtain withdrawId from CollateralHub' },
        { status: 500 }
      )
    }

    // Step 2: Call HubBridgeOutboxWormhole.sendWithdraw on the hub chain
    // This emits WithdrawSent with the encoded payload
    console.log(`${tag} Step 2: sendWithdraw on HubBridgeOutbox`, {
      dstDomain: targetChainId,
      user,
      token: spokeUsdcAddr,
      amount: amountWei.toString(),
      withdrawId,
    })

    await withRelayer({
      pool: 'hub_inbox',
      provider: hubProvider,
      action: async (wallet) => {
        const outbox = new ethers.Contract(hubOutboxAddr, HUB_OUTBOX_ABI, wallet)

        try {
          await outbox.sendWithdraw.staticCall(
            targetChainId,
            user,
            spokeUsdcAddr,
            amountWei,
            withdrawId
          )
          console.log(`${tag} sendWithdraw simulate OK`)
        } catch (simErr: any) {
          const msg = simErr?.reason || simErr?.shortMessage || simErr?.message || String(simErr)
          console.error(`${tag} sendWithdraw simulate FAILED`, msg)
          throw new Error(`HubBridgeOutbox.sendWithdraw failed: ${msg}`)
        }

        const tx = await sendWithNonceRetry({
          provider: hubProvider,
          wallet,
          contract: outbox as any,
          method: 'sendWithdraw',
          args: [targetChainId, user, spokeUsdcAddr, amountWei, withdrawId],
          label: 'withdraw:hub:sendWithdraw',
        })
        await tx.wait()
        console.log(`${tag} sendWithdraw confirmed`, { txHash: tx.hash })
      },
    })

    // Step 3: Deliver to spoke — call SpokeBridgeInboxWormhole.receiveMessage
    // This instructs SpokeVault.releaseToUser to send USDC to the user
    const spokeRpc = spokeCfg.rpcList.find((v) => !!v) || ''
    if (!spokeRpc) {
      return NextResponse.json(
        { error: `No RPC configured for ${spokeCfg.name}` },
        { status: 500 }
      )
    }

    const spokeProvider = new ethers.JsonRpcProvider(spokeRpc)
    const srcDomain = hubDomain

    const hubOutboxRemoteApp =
      (spokeCfg.name === 'polygon'
        ? process.env.BRIDGE_REMOTE_APP_HUB_FOR_POLYGON
        : process.env.BRIDGE_REMOTE_APP_HUB_FOR_ARBITRUM) ||
      process.env.BRIDGE_REMOTE_APP_HUB ||
      (hubOutboxAddr ? toBytes32Address(hubOutboxAddr) : '')

    if (!hubOutboxRemoteApp || !/^0x[0-9a-fA-F]{64}$/.test(hubOutboxRemoteApp)) {
      return NextResponse.json(
        { error: 'Cannot derive hub remote app for spoke delivery' },
        { status: 500 }
      )
    }

    const TYPE_WITHDRAW = 2
    const spokePayload = ethers.AbiCoder.defaultAbiCoder().encode(
      ['uint8', 'address', 'address', 'uint256', 'bytes32'],
      [TYPE_WITHDRAW, user, spokeUsdcAddr, amountWei, withdrawId]
    )

    console.log(`${tag} Step 3: receiveMessage on spoke inbox (${spokeCfg.name})`, {
      spokeInbox: spokeInboxAddr,
      srcDomain,
      srcApp: hubOutboxRemoteApp,
      withdrawId,
    })

    const spokePoolName =
      spokeCfg.name === 'polygon' ? 'spoke_inbox_polygon' : 'spoke_inbox_arbitrum'

    await withRelayer({
      pool: spokePoolName as any,
      provider: spokeProvider,
      action: async (wallet) => {
        const inbox = new ethers.Contract(spokeInboxAddr, SPOKE_INBOX_ABI, wallet)

        try {
          await inbox.receiveMessage.staticCall(srcDomain, hubOutboxRemoteApp, spokePayload)
          console.log(`${tag} spoke receiveMessage simulate OK`)
        } catch (simErr: any) {
          const msg = simErr?.reason || simErr?.shortMessage || simErr?.message || String(simErr)
          console.error(`${tag} spoke receiveMessage simulate FAILED`, msg)
          throw new Error(`SpokeBridgeInbox.receiveMessage failed: ${msg}`)
        }

        const fee = await spokeProvider.getFeeData().catch(() => ({} as any))
        const maxPriorityFeePerGas =
          spokeCfg.name === 'arbitrum'
            ? ethers.parseUnits('0.05', 'gwei')
            : fee?.maxPriorityFeePerGas || ethers.parseUnits('35', 'gwei')
        const base = fee?.maxFeePerGas || fee?.gasPrice || maxPriorityFeePerGas * 2n
        const maxFeePerGas =
          spokeCfg.name === 'arbitrum'
            ? base + maxPriorityFeePerGas
            : base + maxPriorityFeePerGas * 2n

        let gasLimit = spokeCfg.name === 'arbitrum' ? 150000n : 300000n
        try {
          const est = await inbox.receiveMessage.estimateGas(
            srcDomain,
            hubOutboxRemoteApp,
            spokePayload
          )
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
        console.log(`${tag} spoke delivery confirmed`, {
          txHash: tx.hash,
          block: rc?.blockNumber,
        })
      },
    })

    console.log(`${tag} Cross-chain withdrawal complete`, {
      user,
      targetChainId,
      amount: amountWei.toString(),
      withdrawId,
    })

    return NextResponse.json({
      success: true,
      withdrawId,
      targetChainId,
      amount: amount,
    })
  } catch (err: any) {
    if (isInsufficientFundsError(err) || String(err?.message || '').includes('insufficient funds for gas')) {
      console.error('[WITHDRAW] all relayers out of funds', err?.message || err);
      return NextResponse.json(
        { error: 'all_relayers_insufficient_funds', message: 'All relayers in the pool have insufficient gas funds. Please try again later.' },
        { status: 503 }
      );
    }
    const msg = err?.message || String(err)
    console.error(`${tag} ERROR`, msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
