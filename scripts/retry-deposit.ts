import "dotenv/config";
import { ethers } from "ethers";

const HYPEREVM_RPC = process.env.RPC_URL || "https://rpc.hyperliquid.xyz/evm";

// Safe relayer
const SAFE_RELAYER_KEY = "0x417c79de6a85136ca9b1665fd4a99d64e233dbb0c2549a1f8fe75fc568629319";

// Hub Bridge Inbox
const HUB_INBOX = process.env.HUB_INBOX_ADDRESS || "0xB373b0538079f3cB61971F26abB11a89817BF072";

// Failed deposit parameters (from error logs)
const DEPOSIT = {
  depositId: "0xa8637f931fd8df958f317d3ffbe85b18e01bbe90f47eccf1e17938e61f10fd14",
  user: "0xE75aa08bFCAFc20afeC73d22B24425abEED8E1Ec", // Safe relayer deposited to itself
  token: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", // Native USDC on Arbitrum
  amount: 100000n, // 0.1 USDC (6 decimals)
  chainId: 42161, // Arbitrum
};

// Domain and source app for Arbitrum
const SRC_DOMAIN = 42161;
const SPOKE_OUTBOX_ARBITRUM = "0xbBa864d7c5eA0c0fa7dd93C4A0a0d69D82345fF7";

function toBytes32Address(addr: string): string {
  return "0x" + "0".repeat(24) + addr.slice(2).toLowerCase();
}

const HUB_INBOX_ABI = [
  "function receiveMessage(uint64 srcDomain, bytes32 srcApp, bytes payload) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function processedIds(bytes32) view returns (bool)",
];

async function main() {
  console.log("═══════════════════════════════════════════════════════════════════════════════");
  console.log("        MANUAL DEPOSIT RETRY");
  console.log("═══════════════════════════════════════════════════════════════════════════════\n");

  const provider = new ethers.JsonRpcProvider(HYPEREVM_RPC);
  const wallet = new ethers.Wallet(SAFE_RELAYER_KEY, provider);

  console.log(`Relayer: ${wallet.address}`);
  const balance = await provider.getBalance(wallet.address);
  console.log(`Balance: ${ethers.formatEther(balance)} HYPE\n`);

  const hubInbox = new ethers.Contract(HUB_INBOX, HUB_INBOX_ABI, wallet);

  // Check if already processed
  console.log("Checking if deposit already processed...");
  try {
    const processed = await hubInbox.processedIds(DEPOSIT.depositId);
    if (processed) {
      console.log("✅ Deposit already processed on hub! Nothing to do.");
      return;
    }
    console.log("❌ Not yet processed - proceeding with retry\n");
  } catch (e: any) {
    console.log("⚠️  Could not check processedIds:", e.message?.slice(0, 50));
  }

  // Check role
  const BRIDGE_ENDPOINT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("BRIDGE_ENDPOINT_ROLE"));
  const hasRole = await hubInbox.hasRole(BRIDGE_ENDPOINT_ROLE, wallet.address);
  console.log(`BRIDGE_ENDPOINT_ROLE: ${hasRole ? "✅ Yes" : "❌ No"}`);
  if (!hasRole) {
    console.log("❌ Cannot proceed - relayer doesn't have BRIDGE_ENDPOINT_ROLE");
    process.exit(1);
  }

  // Build payload
  const TYPE_DEPOSIT = 1;
  const payload = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint8", "address", "address", "uint256", "bytes32"],
    [TYPE_DEPOSIT, DEPOSIT.user, DEPOSIT.token, DEPOSIT.amount, DEPOSIT.depositId]
  );

  const srcApp = toBytes32Address(SPOKE_OUTBOX_ARBITRUM);

  console.log("\nDeposit details:");
  console.log(`  User: ${DEPOSIT.user}`);
  console.log(`  Token: ${DEPOSIT.token}`);
  console.log(`  Amount: ${DEPOSIT.amount} (0.1 USDC)`);
  console.log(`  DepositId: ${DEPOSIT.depositId}`);
  console.log(`  SrcDomain: ${SRC_DOMAIN}`);
  console.log(`  SrcApp: ${srcApp}`);

  // Simulate first
  console.log("\nSimulating transaction...");
  try {
    await hubInbox.receiveMessage.staticCall(SRC_DOMAIN, srcApp, payload);
    console.log("✅ Simulation passed\n");
  } catch (e: any) {
    const msg = e.reason || e.shortMessage || e.message;
    console.log(`❌ Simulation failed: ${msg}`);
    if (msg?.toLowerCase().includes("processed")) {
      console.log("Deposit appears to be already processed!");
      return;
    }
    throw e;
  }

  // Send transaction
  console.log("Sending transaction...");
  const tx = await hubInbox.receiveMessage(SRC_DOMAIN, srcApp, payload, {
    gasLimit: 300000n,
  });
  console.log(`TX: ${tx.hash}`);

  const receipt = await tx.wait();
  console.log(`✅ Confirmed in block ${receipt?.blockNumber}`);

  console.log("\n═══════════════════════════════════════════════════════════════════════════════");
  console.log("        DEPOSIT RETRY SUCCESSFUL");
  console.log("═══════════════════════════════════════════════════════════════════════════════");
}

main().catch((e) => {
  console.error("Error:", e.message || e);
  process.exit(1);
});
