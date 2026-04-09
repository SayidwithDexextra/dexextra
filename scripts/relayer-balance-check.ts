import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const MIN_BALANCE_HYPE = parseFloat(process.env.RELAYER_MIN_BALANCE_HYPE || '0.05')
const CRITICAL_BALANCE_HYPE = parseFloat(process.env.RELAYER_CRITICAL_BALANCE_HYPE || '0.01')
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL

interface RelayerInfo {
  index: number
  privateKey: string
  address: string
  balanceHype: string
  balanceWei: bigint
  blockType: 'Large' | 'Small' | '??'
  status: 'OK' | 'LOW' | 'CRITICAL' | 'EMPTY'
}

async function sendSlackAlert(message: string): Promise<void> {
  if (!SLACK_WEBHOOK_URL) return
  try {
    await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: message }),
    })
  } catch (e) {
    console.error('Failed to send Slack alert:', e)
  }
}

async function sendDiscordAlert(message: string): Promise<void> {
  if (!DISCORD_WEBHOOK_URL) return
  try {
    await fetch(DISCORD_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: message }),
    })
  } catch (e) {
    console.error('Failed to send Discord alert:', e)
  }
}

async function main() {
  const keysJson = process.env.RELAYER_PRIVATE_KEYS_JSON
  if (!keysJson) {
    console.error('RELAYER_PRIVATE_KEYS_JSON is not set in .env.local')
    process.exit(1)
  }

  let privateKeys: string[]
  try {
    privateKeys = JSON.parse(keysJson)
  } catch (e) {
    console.error('Failed to parse RELAYER_PRIVATE_KEYS_JSON:', e)
    process.exit(1)
  }

  if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
    console.error('RELAYER_PRIVATE_KEYS_JSON is empty or not an array')
    process.exit(1)
  }

  const rpcUrl = process.env.RPC_URL || 'https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-'
  const chainId = parseInt(process.env.CHAIN_ID || '999', 10)

  console.log(`\n🔗 Connecting to Hyperliquid (chainId: ${chainId})`)
  console.log(`📡 RPC: ${rpcUrl.substring(0, 50)}...\n`)

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId)

  const relayers: RelayerInfo[] = []

  for (let i = 0; i < privateKeys.length; i++) {
    const privateKey = privateKeys[i].trim()
    try {
      const wallet = new ethers.Wallet(privateKey)
      const address = wallet.address

      const [balanceWei, bigBlocks] = await Promise.all([
        provider.getBalance(address),
        provider.send('eth_usingBigBlocks', [address]).catch(() => null),
      ])
      const balanceHype = ethers.formatEther(balanceWei)
      const balanceNum = parseFloat(balanceHype)
      
      let status: RelayerInfo['status'] = 'OK'
      if (balanceNum <= 0.0001) status = 'EMPTY'
      else if (balanceNum < CRITICAL_BALANCE_HYPE) status = 'CRITICAL'
      else if (balanceNum < MIN_BALANCE_HYPE) status = 'LOW'

      relayers.push({
        index: i,
        privateKey: `${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 4)}`,
        address,
        balanceHype,
        balanceWei,
        blockType: bigBlocks === true ? 'Large' : bigBlocks === false ? 'Small' : '??',
        status,
      })
    } catch (e) {
      console.error(`Error processing key at index ${i}:`, e)
    }
  }

  console.log('┌─────┬────────────────────────────────────────────┬─────────┬──────────────────────┬──────────┐')
  console.log('│  #  │ Address                                    │ Blocks  │ HYPE Balance         │ Status   │')
  console.log('├─────┼────────────────────────────────────────────┼─────────┼──────────────────────┼──────────┤')

  let totalWei = 0n
  const statusEmoji: Record<RelayerInfo['status'], string> = {
    OK: '✅',
    LOW: '⚠️ ',
    CRITICAL: '🔴',
    EMPTY: '💀',
  }
  
  for (const r of relayers) {
    const idx = r.index.toString().padStart(3)
    const blocks = r.blockType.padEnd(5)
    const balance = parseFloat(r.balanceHype).toFixed(6).padStart(18)
    const statusStr = `${statusEmoji[r.status]} ${r.status}`.padEnd(8)
    console.log(`│ ${idx} │ ${r.address} │ ${blocks}   │ ${balance} │ ${statusStr} │`)
    totalWei += r.balanceWei
  }

  console.log('├─────┼────────────────────────────────────────────┼─────────┼──────────────────────┼──────────┤')
  const totalHype = parseFloat(ethers.formatEther(totalWei)).toFixed(6).padStart(18)
  console.log(`│ SUM │                                            │         │ ${totalHype} │          │`)
  console.log('└─────┴────────────────────────────────────────────┴─────────┴──────────────────────┴──────────┘')

  console.log(`\n📊 Total relayers: ${relayers.length}`)
  console.log(`💰 Total HYPE: ${ethers.formatEther(totalWei)} HYPE`)
  console.log(`⚠️  Min balance threshold: ${MIN_BALANCE_HYPE} HYPE`)
  console.log(`🔴 Critical balance threshold: ${CRITICAL_BALANCE_HYPE} HYPE\n`)

  // Count by status
  const okCount = relayers.filter(r => r.status === 'OK').length
  const lowCount = relayers.filter(r => r.status === 'LOW').length
  const criticalCount = relayers.filter(r => r.status === 'CRITICAL').length
  const emptyCount = relayers.filter(r => r.status === 'EMPTY').length

  console.log(`Status summary: ✅ OK: ${okCount} | ⚠️  LOW: ${lowCount} | 🔴 CRITICAL: ${criticalCount} | 💀 EMPTY: ${emptyCount}`)

  // Send alerts if needed
  const needsAlert = criticalCount > 0 || emptyCount > 0 || (lowCount + criticalCount + emptyCount) >= Math.ceil(relayers.length / 2)
  
  if (needsAlert) {
    const alertMessage = [
      `🚨 *RELAYER BALANCE ALERT*`,
      ``,
      `Status: ✅ OK: ${okCount} | ⚠️ LOW: ${lowCount} | 🔴 CRITICAL: ${criticalCount} | 💀 EMPTY: ${emptyCount}`,
      `Total HYPE: ${ethers.formatEther(totalWei)}`,
      ``,
      emptyCount > 0 ? `⚠️ ${emptyCount} relayer(s) are EMPTY and cannot process trades!` : '',
      criticalCount > 0 ? `⚠️ ${criticalCount} relayer(s) are CRITICAL (< ${CRITICAL_BALANCE_HYPE} HYPE)` : '',
      ``,
      `Run \`npx tsx scripts/fund-relayers-hype.ts\` to top up relayers.`,
    ].filter(Boolean).join('\n')

    console.log('\n' + '='.repeat(70))
    console.log('🚨 ALERT: Relayer balances need attention!')
    console.log('='.repeat(70))
    
    if (emptyCount === relayers.length) {
      console.log('\n💀💀💀 ALL RELAYERS ARE EMPTY! GASLESS TRADING IS DOWN! 💀💀💀\n')
    }

    // Send to webhooks
    await Promise.all([
      sendSlackAlert(alertMessage),
      sendDiscordAlert(alertMessage),
    ])
    
    // Exit with error code if critical
    if (emptyCount === relayers.length) {
      process.exit(2) // All empty - critical
    } else if (criticalCount > 0 || emptyCount > 0) {
      process.exit(1) // Some critical/empty - warning
    }
  } else {
    console.log('\n✅ All relayers have sufficient funds.\n')
  }
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
