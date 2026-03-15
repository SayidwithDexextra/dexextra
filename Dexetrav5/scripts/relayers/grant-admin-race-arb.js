/**
 * Race-condition grant: grants DEFAULT_ADMIN_ROLE on SpokeBridgeInbox (Arbitrum)
 * to the target address, using the compromised ADMIN_PRIVATE_KEY_3.
 *
 * Strategy: Pre-sign the grantRole at BOTH nonce N and N+1. Fund the admin,
 * then blast both. If the sweeper grabs nonce N, we try N+1. We also fund
 * enough for the sweeper's drain gas + our grantRole gas.
 *
 * Usage:  node scripts/relayers/grant-admin-race-arb.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
const { ethers } = require("ethers");

const ARB_RPC = process.env.ARBITRUM_RPC_URL;
const ADMIN_PK = process.env.ADMIN_PRIVATE_KEY_3;
const FUNDER_PK = process.env.RELAYER_PRIVATE_KEY;

const TARGET_ADDR = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";
const SPOKE_INBOX_ARB = process.env.SPOKE_INBOX_ADDRESS_ARBITRUM || "0x7c8E2f0496f7b36D638C5CeA32316D631CC44983";

if (!ARB_RPC || !ADMIN_PK || !FUNDER_PK) {
  console.error("Missing ARBITRUM_RPC_URL / ADMIN_PRIVATE_KEY_3 / PRIVATE_KEY_USERD");
  process.exit(1);
}

const ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
];

const MAX_ATTEMPTS = 5;

async function main() {
  const provider = new ethers.JsonRpcProvider(ARB_RPC);

  const adminNorm = ADMIN_PK.startsWith("0x") ? ADMIN_PK : "0x" + ADMIN_PK;
  const funderNorm = FUNDER_PK.startsWith("0x") ? FUNDER_PK : "0x" + FUNDER_PK;

  const adminWallet = new ethers.Wallet(adminNorm, provider);
  const funderWallet = new ethers.Wallet(funderNorm, provider);

  console.log("Chain: Arbitrum");
  console.log("Admin (compromised):", adminWallet.address);
  console.log("Funder:", funderWallet.address);
  console.log("Target:", TARGET_ADDR);

  const inbox = new ethers.Contract(SPOKE_INBOX_ARB, ABI, adminWallet);
  const adminRole = await inbox.DEFAULT_ADMIN_ROLE();

  const already = await inbox.hasRole(adminRole, TARGET_ADDR);
  if (already) {
    console.log("\nTarget already has DEFAULT_ADMIN_ROLE — nothing to do.");
    return;
  }

  const { chainId } = await provider.getNetwork();

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    console.log(`\n========== ATTEMPT ${attempt}/${MAX_ATTEMPTS} ==========`);

    const verified = await inbox.hasRole(adminRole, TARGET_ADDR);
    if (verified) {
      console.log("✓ SUCCESS — role already granted!");
      return;
    }

    const funderBal = await provider.getBalance(funderWallet.address);
    console.log("Funder ETH:", ethers.formatEther(funderBal));

    const nonce = await provider.getTransactionCount(adminWallet.address, "latest");
    const feeData = await provider.getFeeData();

    // Very aggressive gas: 10x priority, ensure maxFee >= priorityFee
    const basePriority = feeData.maxPriorityFeePerGas || ethers.parseUnits("0.01", "gwei");
    const baseMax = feeData.maxFeePerGas || ethers.parseUnits("0.1", "gwei");
    const maxPriorityFee = basePriority * 10n;
    const maxFee = (baseMax * 10n) > maxPriorityFee
      ? baseMax * 10n
      : maxPriorityFee + ethers.parseUnits("0.1", "gwei");

    const GAS_LIMIT = 80000n;
    const calldata = inbox.interface.encodeFunctionData("grantRole", [adminRole, TARGET_ADDR]);

    // Pre-sign at nonce N AND nonce N+1 (in case sweeper grabs N)
    const signedTxs = [];
    for (let i = 0; i < 3; i++) {
      const txObj = {
        to: SPOKE_INBOX_ARB,
        data: calldata,
        nonce: nonce + i,
        gasLimit: GAS_LIMIT,
        maxFeePerGas: maxFee,
        maxPriorityFeePerGas: maxPriorityFee,
        chainId,
        type: 2,
      };
      const signed = await adminWallet.signTransaction(txObj);
      signedTxs.push({ nonce: nonce + i, signed });
      console.log(`  Pre-signed grantRole at nonce ${nonce + i} ✓`);
    }

    // Fund: enough for 3 grantRole txs (sweeper may use some nonces)
    const fundAmount = GAS_LIMIT * maxFee * 4n;
    console.log("Fund amount:", ethers.formatEther(fundAmount), "ETH");

    if (funderBal < fundAmount) {
      console.error("Funder insufficient! Need", ethers.formatEther(fundAmount));
      process.exit(1);
    }

    // RACE: fund, then immediately blast all pre-signed txs
    console.log("Funding admin...");
    const fundTx = await funderWallet.sendTransaction({
      to: adminWallet.address,
      value: fundAmount,
    });
    console.log("  Fund tx:", fundTx.hash);
    await fundTx.wait();

    const t0 = Date.now();
    console.log("Blasting pre-signed txs...");

    const results = await Promise.allSettled(
      signedTxs.map(async ({ nonce: n, signed }) => {
        try {
          const resp = await provider.broadcastTransaction(signed);
          console.log(`  nonce ${n} broadcast: ${resp.hash} (${Date.now() - t0}ms)`);
          const receipt = await resp.wait();
          console.log(`  nonce ${n} confirmed block ${receipt.blockNumber} status=${receipt.status}`);
          return receipt;
        } catch (e) {
          console.log(`  nonce ${n} failed: ${e.shortMessage || e.message}`);
          throw e;
        }
      })
    );

    // Check if any succeeded
    const success = await inbox.hasRole(adminRole, TARGET_ADDR);
    if (success) {
      console.log("\n✓ SUCCESS — DEFAULT_ADMIN_ROLE granted on SpokeBridgeInbox (Arb)!");
      return;
    }
    console.log("  Sweeper won this round. Retrying...");
    await new Promise((r) => setTimeout(r, 500));
  }

  console.log("\n✗ FAILED after", MAX_ATTEMPTS, "attempts. The sweeper is too fast.");
  console.log("Consider deploying a new SpokeBridgeInbox contract as an alternative.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
