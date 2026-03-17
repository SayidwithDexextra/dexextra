import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const MIN_BALANCE = ethers.parseEther(process.env.HYPE_MIN_BALANCE || '0.08')
const TOP_UP_AMOUNT = ethers.parseEther(process.env.HYPE_TOPUP_AMOUNT || '0.1')

interface RelayerStatus {
  index: number
  address: string
  balance: bigint
  status: 'OK' | 'LOW' | 'FUNDER'
}

async function main() {
  const funderPk = process.env.FUNDER_PRIVATE_KEY || process.env.PRIVATE_KEY_USERD
  if (!funderPk) {
    console.error('Set FUNDER_PRIVATE_KEY (or PRIVATE_KEY_USERD) in .env.local')
    process.exit(1)
  }

  const keysJson = process.env.RELAYER_PRIVATE_KEYS_JSON
  if (!keysJson) {
    console.error('RELAYER_PRIVATE_KEYS_JSON is not set in .env.local')
    process.exit(1)
  }

  let privateKeys: string[]
  try {
    privateKeys = JSON.parse(keysJson)
  } catch {
    console.error('Failed to parse RELAYER_PRIVATE_KEYS_JSON')
    process.exit(1)
  }

  if (!Array.isArray(privateKeys) || privateKeys.length === 0) {
    console.error('RELAYER_PRIVATE_KEYS_JSON is empty or not an array')
    process.exit(1)
  }

  const rpcUrl = process.env.RPC_URL || 'https://hyperliquid-mainnet.g.alchemy.com/v2/PDSUXXYcDJZCb-VLvpvN-'
  const chainId = parseInt(process.env.CHAIN_ID || '999', 10)

  console.log(`\n🔗 Hyperliquid (chainId: ${chainId})`)
  console.log(`📡 RPC: ${rpcUrl.substring(0, 50)}...`)

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId)
  const funder = new ethers.Wallet(funderPk.trim(), provider)

  const relayerAddresses = privateKeys.map((pk) => new ethers.Wallet(pk.trim()).address)
  const uniqueAddresses = [...new Set(relayerAddresses)]

  const [funderBal, ...relayerBals] = await Promise.all([
    provider.getBalance(funder.address),
    ...uniqueAddresses.map((addr) => provider.getBalance(addr)),
  ])

  console.log(`\n💳 Funder: ${funder.address}`)
  console.log(`   Balance: ${ethers.formatEther(funderBal)} HYPE`)
  console.log(`   Min threshold: ${ethers.formatEther(MIN_BALANCE)} HYPE`)
  console.log(`   Top-up amount: ${ethers.formatEther(TOP_UP_AMOUNT)} HYPE`)

  const relayers: RelayerStatus[] = uniqueAddresses.map((address, i) => {
    const isFunder = address.toLowerCase() === funder.address.toLowerCase()
    return {
      index: i,
      address,
      balance: relayerBals[i],
      status: isFunder ? 'FUNDER' : relayerBals[i] < MIN_BALANCE ? 'LOW' : 'OK',
    }
  })

  console.log('\n┌─────┬────────────────────────────────────────────┬──────────────────────┬────────┐')
  console.log('│  #  │ Address                                    │ HYPE Balance         │ Status │')
  console.log('├─────┼────────────────────────────────────────────┼──────────────────────┼────────┤')

  for (const r of relayers) {
    const idx = r.index.toString().padStart(3)
    const bal = parseFloat(ethers.formatEther(r.balance)).toFixed(6).padStart(18)
    const tag = r.status.padEnd(6)
    console.log(`│ ${idx} │ ${r.address} │ ${bal} │ ${tag} │`)
  }
  console.log('└─────┴────────────────────────────────────────────┴──────────────────────┴────────┘')

  const needsFunding = relayers.filter((r) => r.status === 'LOW')

  if (needsFunding.length === 0) {
    console.log('\n✅ All relayer wallets have sufficient HYPE. Nothing to do.\n')
    return
  }

  const totalNeeded = TOP_UP_AMOUNT * BigInt(needsFunding.length)
  console.log(`\n⚠️  ${needsFunding.length} wallet(s) below threshold.`)
  console.log(`   Total HYPE needed: ${ethers.formatEther(totalNeeded)} HYPE`)

  const reserveBuffer = ethers.parseEther('0.01')
  if (funderBal < totalNeeded + reserveBuffer) {
    console.error(
      `\n❌ Funder has insufficient balance. Need ~${ethers.formatEther(totalNeeded + reserveBuffer)} HYPE but have ${ethers.formatEther(funderBal)} HYPE`
    )
    process.exit(1)
  }

  console.log('\n--- Sending HYPE ---\n')

  let funded = 0
  let failed = 0

  for (const r of needsFunding) {
    try {
      const tx = await funder.sendTransaction({
        to: r.address,
        value: TOP_UP_AMOUNT,
      })
      console.log(`  → ${r.address}  tx: ${tx.hash}`)
      await tx.wait()
      console.log(`    ✓ confirmed`)
      funded++
    } catch (e: any) {
      console.error(`  ✗ ${r.address}  ${e?.shortMessage || e?.message || e}`)
      failed++
    }
  }

  console.log('\n--- Final balances ---\n')

  const finalBals = await Promise.all(uniqueAddresses.map((addr) => provider.getBalance(addr)))
  for (let i = 0; i < uniqueAddresses.length; i++) {
    const bal = parseFloat(ethers.formatEther(finalBals[i])).toFixed(6).padStart(18)
    console.log(`  ${uniqueAddresses[i]}  ${bal} HYPE`)
  }

  const newFunderBal = await provider.getBalance(funder.address)
  console.log(`\n💳 Funder remaining: ${ethers.formatEther(newFunderBal)} HYPE`)
  console.log(`\n🎉 Done — funded: ${funded}, failed: ${failed}\n`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
