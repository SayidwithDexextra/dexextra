import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

interface RelayerInfo {
  index: number
  privateKey: string
  address: string
  balanceHype: string
  balanceWei: bigint
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
      const balanceWei = await provider.getBalance(address)
      const balanceHype = ethers.formatEther(balanceWei)

      relayers.push({
        index: i,
        privateKey: `${privateKey.substring(0, 10)}...${privateKey.substring(privateKey.length - 4)}`,
        address,
        balanceHype,
        balanceWei,
      })
    } catch (e) {
      console.error(`Error processing key at index ${i}:`, e)
    }
  }

  console.log('┌─────┬────────────────────────────────────────────┬──────────────────────┐')
  console.log('│  #  │ Address                                    │ HYPE Balance         │')
  console.log('├─────┼────────────────────────────────────────────┼──────────────────────┤')

  let totalWei = 0n
  for (const r of relayers) {
    const idx = r.index.toString().padStart(3)
    const balance = parseFloat(r.balanceHype).toFixed(6).padStart(18)
    console.log(`│ ${idx} │ ${r.address} │ ${balance} │`)
    totalWei += r.balanceWei
  }

  console.log('├─────┼────────────────────────────────────────────┼──────────────────────┤')
  const totalHype = parseFloat(ethers.formatEther(totalWei)).toFixed(6).padStart(18)
  console.log(`│ SUM │                                            │ ${totalHype} │`)
  console.log('└─────┴────────────────────────────────────────────┴──────────────────────┘')

  console.log(`\n📊 Total relayers: ${relayers.length}`)
  console.log(`💰 Total HYPE: ${ethers.formatEther(totalWei)} HYPE\n`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
