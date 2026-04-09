import { ethers } from 'ethers'
import * as dotenv from 'dotenv'
import * as path from 'path'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const RESERVE_FOR_BIG_RELAYER = ethers.parseEther(process.env.BIG_RELAYER_RESERVE || '0.05')

interface RelayerInfo {
  address: string
  balance: bigint
}

async function main() {
  // Get the big relayer (source of funds)
  const bigRelayerKeysJson = process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON
  if (!bigRelayerKeysJson) {
    console.error('RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON is not set in .env.local')
    process.exit(1)
  }

  let bigRelayerKeys: string[]
  try {
    bigRelayerKeys = JSON.parse(bigRelayerKeysJson)
  } catch {
    console.error('Failed to parse RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON')
    process.exit(1)
  }

  if (!bigRelayerKeys.length) {
    console.error('No big relayer keys found')
    process.exit(1)
  }

  // Get the small relayers (destinations)
  const smallRelayerKeysJson = process.env.RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON
  if (!smallRelayerKeysJson) {
    console.error('RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON is not set in .env.local')
    process.exit(1)
  }

  let smallRelayerKeys: string[]
  try {
    // Handle trailing commas in JSON array
    const cleaned = smallRelayerKeysJson.replace(/,\s*\]/g, ']')
    smallRelayerKeys = JSON.parse(cleaned)
  } catch (e) {
    console.error('Failed to parse RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON:', e)
    process.exit(1)
  }

  if (!smallRelayerKeys.length) {
    console.error('No small relayer keys found')
    process.exit(1)
  }

  const rpcUrl = process.env.RPC_URL || 'https://rpc.hyperliquid.xyz/evm'
  const chainId = parseInt(process.env.CHAIN_ID || '999', 10)

  console.log(`\n🔗 Connecting to Hyperliquid (chainId: ${chainId})`)
  console.log(`📡 RPC: ${rpcUrl.substring(0, 50)}...\n`)

  const provider = new ethers.JsonRpcProvider(rpcUrl, chainId)

  // Setup big relayer wallet
  const bigRelayerWallet = new ethers.Wallet(bigRelayerKeys[0].trim(), provider)
  const bigRelayerBalance = await provider.getBalance(bigRelayerWallet.address)

  console.log('=== SOURCE (Big Block Relayer) ===')
  console.log(`Address: ${bigRelayerWallet.address}`)
  console.log(`Balance: ${ethers.formatEther(bigRelayerBalance)} HYPE`)
  console.log(`Reserve: ${ethers.formatEther(RESERVE_FOR_BIG_RELAYER)} HYPE (will keep for big-block txs)`)
  console.log()

  // Get small relayer addresses and balances
  const smallRelayers: RelayerInfo[] = []
  for (const pk of smallRelayerKeys) {
    const wallet = new ethers.Wallet(pk.trim())
    const balance = await provider.getBalance(wallet.address)
    smallRelayers.push({ address: wallet.address, balance })
  }

  console.log('=== DESTINATIONS (Small Block Relayers) ===')
  let totalSmallBalance = 0n
  for (let i = 0; i < smallRelayers.length; i++) {
    const r = smallRelayers[i]
    console.log(`  ${i + 1}. ${r.address}: ${ethers.formatEther(r.balance)} HYPE`)
    totalSmallBalance += r.balance
  }
  console.log(`\nTotal small relayer count: ${smallRelayers.length}`)
  console.log(`Total small relayer balance: ${ethers.formatEther(totalSmallBalance)} HYPE`)
  console.log()

  // Calculate dispersal
  const availableToDisperse = bigRelayerBalance - RESERVE_FOR_BIG_RELAYER
  if (availableToDisperse <= 0n) {
    console.error(`❌ Big relayer balance (${ethers.formatEther(bigRelayerBalance)} HYPE) is less than reserve (${ethers.formatEther(RESERVE_FOR_BIG_RELAYER)} HYPE)`)
    console.error('   Nothing to disperse.')
    process.exit(1)
  }

  // Estimate gas cost per transfer
  const estimatedGasPerTx = 21000n
  const gasPrice = (await provider.getFeeData()).gasPrice || ethers.parseUnits('0.1', 'gwei')
  const gasCostPerTx = estimatedGasPerTx * gasPrice
  const totalGasCost = gasCostPerTx * BigInt(smallRelayers.length)

  console.log('=== DISPERSAL PLAN ===')
  console.log(`Available to disperse: ${ethers.formatEther(availableToDisperse)} HYPE`)
  console.log(`Estimated gas per tx: ${ethers.formatEther(gasCostPerTx)} HYPE`)
  console.log(`Total gas for ${smallRelayers.length} txs: ${ethers.formatEther(totalGasCost)} HYPE`)

  const netToDisperse = availableToDisperse - totalGasCost
  if (netToDisperse <= 0n) {
    console.error(`❌ Not enough funds after gas costs`)
    process.exit(1)
  }

  const amountPerRelayer = netToDisperse / BigInt(smallRelayers.length)
  console.log(`Amount per relayer: ${ethers.formatEther(amountPerRelayer)} HYPE`)
  console.log()

  // Confirm (skip if --yes flag is passed)
  const autoConfirm = process.argv.includes('--yes') || process.argv.includes('-y')
  
  if (!autoConfirm) {
    const readline = await import('readline')
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
    
    const answer = await new Promise<string>((resolve) => {
      rl.question('Proceed with dispersal? (yes/no): ', resolve)
    })
    rl.close()

    if (answer.toLowerCase() !== 'yes' && answer.toLowerCase() !== 'y') {
      console.log('Aborted.')
      process.exit(0)
    }
  } else {
    console.log('Auto-confirmed with --yes flag')
  }

  console.log('\n--- Sending HYPE ---\n')

  let successful = 0
  let failed = 0

  for (let i = 0; i < smallRelayers.length; i++) {
    const r = smallRelayers[i]
    try {
      console.log(`  [${i + 1}/${smallRelayers.length}] Sending ${ethers.formatEther(amountPerRelayer)} HYPE to ${r.address}...`)
      const tx = await bigRelayerWallet.sendTransaction({
        to: r.address,
        value: amountPerRelayer,
      })
      console.log(`      tx: ${tx.hash}`)
      await tx.wait()
      console.log(`      ✓ confirmed`)
      successful++
    } catch (e: any) {
      console.error(`      ✗ failed: ${e?.shortMessage || e?.message || e}`)
      failed++
    }
  }

  console.log('\n--- Final Balances ---\n')

  const newBigBalance = await provider.getBalance(bigRelayerWallet.address)
  console.log(`Big Relayer: ${ethers.formatEther(newBigBalance)} HYPE`)
  console.log()

  for (let i = 0; i < smallRelayers.length; i++) {
    const r = smallRelayers[i]
    const newBal = await provider.getBalance(r.address)
    console.log(`  ${i + 1}. ${r.address}: ${ethers.formatEther(newBal)} HYPE`)
  }

  console.log(`\n🎉 Done — successful: ${successful}, failed: ${failed}\n`)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  process.exit(1)
})
