import "dotenv/config";
import { ethers } from "ethers";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// Safe relayer (NOT compromised, has funds)
const SAFE_RELAYER_KEY = "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319";

// New relayer addresses from relayers.generated.v2.json
const NEW_RELAYERS = [
  "0x0258eDbF16cD01537Fde74a57D49fb10500Ee4b7",
  "0xF12cFFf4A024a20CbffE5F6CFa621127d9f619ae",
  "0xef2e2399af7F5f7Fb3Bc41952D7B1F3901f437Fe",
  "0xbd748Da20dAC89288e50EFaf3eD8644a1279Aace",
  "0xdceCa7290c008acb5e27e7B83f59f25599D6fc28",
  "0xED7D9eCA75c8d73A9396b1427Bf1d3E37DA73B65",
  "0x432005115A972DF329f015cF200D53d9168AeB4d",
  "0x0f80e0e0743a65B0e958a87615a63B3F448603b5",
  "0xF989598Bf514a6B82Cb9cC2B77f67DbCA644E20C",
  "0x8e15e8b84174BdCfD3DE7e4D690Ab0A71aED878F",
  "0xa1eb9C885785D8474be9929244f43A6bac9a4435",
  "0x4389Dd387Efa4fcb4088036de6919b6623b07251",
];

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DISPERSE HYPE TO NEW RELAYERS");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const safeRelayer = new ethers.Wallet(SAFE_RELAYER_KEY, provider);

  console.log(`Safe relayer: ${safeRelayer.address}`);
  
  const balance = await provider.getBalance(safeRelayer.address);
  console.log(`Balance: ${ethers.formatEther(balance)} HYPE\n`);

  // Reserve some for gas (safe relayer needs to keep operating)
  // Each transfer costs ~21000 gas * ~0.1 gwei = ~0.0000021 HYPE per tx
  // 12 transfers = ~0.000025 HYPE for gas
  // Keep 0.002 HYPE for safe relayer operations + buffer
  const reserveForSafeRelayer = ethers.parseEther("0.002");
  const reserveForGas = ethers.parseEther("0.0005"); // Buffer for 12 txs + wiggle room
  
  const distributable = balance - reserveForSafeRelayer - reserveForGas;
  
  if (distributable <= 0n) {
    console.log("❌ Not enough balance to distribute!");
    console.log(`   Need at least ${ethers.formatEther(reserveForSafeRelayer + reserveForGas)} HYPE, have ${ethers.formatEther(balance)}`);
    process.exit(1);
  }

  const amountPerRelayer = distributable / BigInt(NEW_RELAYERS.length);
  
  console.log(`Distributing ${ethers.formatEther(distributable)} HYPE to ${NEW_RELAYERS.length} relayers`);
  console.log(`Amount per relayer: ${ethers.formatEther(amountPerRelayer)} HYPE`);
  console.log(`Keeping ${ethers.formatEther(reserveForSafeRelayer)} HYPE for safe relayer operations\n`);

  const results: { address: string; txHash?: string; error?: string }[] = [];

  for (let i = 0; i < NEW_RELAYERS.length; i++) {
    const addr = NEW_RELAYERS[i];
    console.log(`[${i + 1}/${NEW_RELAYERS.length}] Sending to ${addr}...`);
    
    try {
      const tx = await safeRelayer.sendTransaction({
        to: addr,
        value: amountPerRelayer,
        gasLimit: 21000n,
      });
      
      console.log(`   TX: ${tx.hash}`);
      const receipt = await tx.wait();
      console.log(`   ✅ Confirmed in block ${receipt?.blockNumber}`);
      results.push({ address: addr, txHash: tx.hash });
    } catch (err: any) {
      console.log(`   ❌ Error: ${err.message}`);
      results.push({ address: addr, error: err.message });
    }
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("        SUMMARY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const successful = results.filter(r => r.txHash);
  const failed = results.filter(r => r.error);

  console.log(`✅ Successful: ${successful.length}/${NEW_RELAYERS.length}`);
  if (failed.length > 0) {
    console.log(`❌ Failed: ${failed.length}`);
    failed.forEach(f => console.log(`   - ${f.address}: ${f.error}`));
  }

  const finalBalance = await provider.getBalance(safeRelayer.address);
  console.log(`\nSafe relayer final balance: ${ethers.formatEther(finalBalance)} HYPE`);

  // Verify recipient balances
  console.log("\n📊 Recipient balances:");
  for (const addr of NEW_RELAYERS) {
    const bal = await provider.getBalance(addr);
    console.log(`   ${addr}: ${ethers.formatEther(bal)} HYPE`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
