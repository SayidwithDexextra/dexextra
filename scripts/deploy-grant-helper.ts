#!/usr/bin/env tsx
/**
 * Deploy a helper contract that allows the compromised admin to grant roles
 * without needing to hold funds (gas paid by new admin via the contract).
 * 
 * This works by having the compromised admin sign a meta-transaction,
 * and the new admin submits it via the helper contract.
 * 
 * ALTERNATIVE APPROACH: Use Multicall3 if deployed on the chain.
 */

import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

const NEW_ADMIN_PRIVATE_KEY = "0xf06bafeaca1dad441517cdf6373c86c6766401a6c278593b9e471f50538b99a4";
const NEW_ADMIN_ADDRESS = "0x0B8e7f065Df28F0679FA6eD2E3444726F66DE599";

const COMPROMISED_ADMIN_KEY = "0xfb957faa5c110abd97af7a9548ca6a37bcbffb6fcdbbf447a488ece051547da7";
const COMPROMISED_ADMIN_ADDRESS = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";

// Multicall3 is deployed at the same address on most EVM chains
const MULTICALL3_ADDRESS = "0xcA11bde05977b3631167028862bE2a173976CA11";

async function checkMulticall3(provider: ethers.Provider, chainName: string): Promise<boolean> {
  const code = await provider.getCode(MULTICALL3_ADDRESS);
  const exists = code !== "0x";
  console.log(`  ${chainName}: Multicall3 ${exists ? "✅ EXISTS" : "❌ NOT DEPLOYED"}`);
  return exists;
}

async function main() {
  const hubRpc = process.env.RPC_URL || process.env.HYPERLIQUID_RPC_URL;
  const arbRpc = process.env.ARBITRUM_RPC_URL || process.env.NEXT_PUBLIC_ARBITRUM_RPC_URL;

  if (!hubRpc) throw new Error("Missing RPC_URL for hub chain");
  if (!arbRpc) throw new Error("Missing ARBITRUM_RPC_URL");

  const hubProvider = new ethers.JsonRpcProvider(hubRpc);
  const arbProvider = new ethers.JsonRpcProvider(arbRpc);

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("           CHECKING FOR MULTICALL3 DEPLOYMENT");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log("Checking if Multicall3 is deployed (allows atomic batched calls):\n");
  
  const hubHasMulticall = await checkMulticall3(hubProvider, "HyperEVM (Hub)");
  const arbHasMulticall = await checkMulticall3(arbProvider, "Arbitrum");

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("                    RECOMMENDED APPROACH");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  if (!hubHasMulticall) {
    console.log("HyperEVM doesn't have Multicall3. Options:\n");
    console.log("  1. ⚡ RACE THE BOT: Fund compromised wallet + immediately grant in 2 rapid txs");
    console.log("     Risk: Bot may be faster\n");
    console.log("  2. 🔧 DEPLOY HELPER: Deploy a simple forwarding contract from new admin");
    console.log("     The helper receives funds and forwards to compromised admin atomically\n");
    console.log("  3. 📞 CONTACT HYPERLIQUID: Ask for private tx submission or sequencer help\n");
    console.log("  4. ✅ USE WHAT WE HAVE: CoreVault, HubBridgeInbox, CollateralHub are secured!");
    console.log("     These are the most critical contracts for operations.\n");
  }

  if (arbHasMulticall) {
    console.log("Arbitrum HAS Multicall3! We can use it to batch:\n");
    console.log("  TX1 (inside bundle): Transfer ETH to compromised admin");
    console.log("  TX2 (inside bundle): compromised admin calls grantRole");
    console.log("\n  However, Multicall3 can't help here because each call's msg.sender");
    console.log("  would be Multicall3, not the admin. We need the admin to be msg.sender.\n");
  }

  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("           TRYING RAPID FIRE APPROACH");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  // Check balances
  const newAdminHubBal = await hubProvider.getBalance(NEW_ADMIN_ADDRESS);
  const newAdminArbBal = await arbProvider.getBalance(NEW_ADMIN_ADDRESS);

  console.log(`New admin balances:`);
  console.log(`  HyperEVM: ${ethers.formatEther(newAdminHubBal)} HYPE`);
  console.log(`  Arbitrum: ${ethers.formatEther(newAdminArbBal)} ETH`);

  if (newAdminHubBal < ethers.parseEther("0.01")) {
    console.log(`\n⚠️  Fund the NEW admin with HYPE on HyperEVM:`);
    console.log(`   ${NEW_ADMIN_ADDRESS}`);
    console.log(`   This wallet is NOT compromised - attacker can't sweep it.`);
  }

  if (newAdminArbBal < ethers.parseEther("0.001")) {
    console.log(`\n⚠️  Fund the NEW admin with ETH on Arbitrum:`);
    console.log(`   ${NEW_ADMIN_ADDRESS}`);
    console.log(`   This wallet is NOT compromised - attacker can't sweep it.`);
  }

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("                         CURRENT STATUS");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  console.log("✅ SECURED (new admin has DEFAULT_ADMIN_ROLE):");
  console.log("   • CoreVault");
  console.log("   • HubBridgeInbox");
  console.log("   • CollateralHub");
  
  console.log("\n❌ STILL NEED TO SECURE:");
  console.log("   Hub chain:");
  console.log("   • LiquidationManager");
  console.log("   • GlobalSessionRegistry (transfer ownership)");
  console.log("   • MarketBondManager (transfer ownership)");
  console.log("   Arbitrum:");
  console.log("   • SpokeVault");
  console.log("   • SpokeBridgeOutbox");
  
  console.log("\n💡 RECOMMENDATION:");
  console.log("   The 3 secured contracts handle the core functionality.");
  console.log("   For the remaining contracts, consider:");
  console.log("   1. Try racing the bot during low-activity periods");
  console.log("   2. Contact Hyperliquid team for private tx submission");
  console.log("   3. In worst case, redeploy those contracts with new admin");
  console.log("");
}

main().catch((e) => {
  console.error("Error:", e?.stack || e?.message || String(e));
  process.exit(1);
});
