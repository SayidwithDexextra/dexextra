/**
 * Grants WITHDRAW_REQUESTER_ROLE (CollateralHub) and WITHDRAW_SENDER_ROLE
 * (HubBridgeOutbox) to all relayer addresses in RELAYER_PRIVATE_KEYS_JSON.
 *
 * Signer: RELAYER_PRIVATE_KEY (0x25b67c3...) which has DEFAULT_ADMIN_ROLE
 * on both contracts.
 *
 * Usage:  node scripts/relayers/grant-withdraw-roles.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env.local") });
const { ethers } = require("ethers");

const HUB_RPC = process.env.RPC_URL;
const SIGNER_PK = process.env.RELAYER_PRIVATE_KEY;

const COLLATERAL_HUB = "0x6bD4D6A4C19c85A5C37AA02b3F0421e623D7d0Ff";
const HUB_BRIDGE_OUTBOX = "0x4c32ff22b927a134a3286d5E33212debF951AcF5";

if (!HUB_RPC || !SIGNER_PK) {
  console.error("Missing RPC_URL / RELAYER_PRIVATE_KEY");
  process.exit(1);
}

const HUB_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function WITHDRAW_REQUESTER_ROLE() view returns (bytes32)",
];

const OUTBOX_ABI = [
  "function grantRole(bytes32 role, address account) external",
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  "function WITHDRAW_SENDER_ROLE() view returns (bytes32)",
];

async function main() {
  const provider = new ethers.JsonRpcProvider(HUB_RPC);
  const signerNorm = SIGNER_PK.startsWith("0x") ? SIGNER_PK : "0x" + SIGNER_PK;
  const signer = new ethers.Wallet(signerNorm, provider);

  console.log("Signer:", signer.address);
  const bal = await provider.getBalance(signer.address);
  console.log("Signer balance:", ethers.formatEther(bal), "HYPE\n");

  const hub = new ethers.Contract(COLLATERAL_HUB, HUB_ABI, signer);
  const outbox = new ethers.Contract(HUB_BRIDGE_OUTBOX, OUTBOX_ABI, signer);

  // Verify admin
  const adminRole = await hub.DEFAULT_ADMIN_ROLE();
  const isHubAdmin = await hub.hasRole(adminRole, signer.address);
  const isOutboxAdmin = await outbox.hasRole(adminRole, signer.address);
  console.log("Has admin on CollateralHub:", isHubAdmin);
  console.log("Has admin on HubBridgeOutbox:", isOutboxAdmin);
  if (!isHubAdmin || !isOutboxAdmin) {
    console.error("Signer does not have admin on both contracts!");
    process.exit(1);
  }

  const withdrawRequesterRole = await hub.WITHDRAW_REQUESTER_ROLE();
  const withdrawSenderRole = await outbox.WITHDRAW_SENDER_ROLE();

  // Collect all relayer addresses
  const relayerAddresses = new Set();
  const relayerKeysJson = process.env.RELAYER_PRIVATE_KEYS_JSON;
  if (relayerKeysJson) {
    const keys = JSON.parse(relayerKeysJson);
    for (const pk of keys) {
      const w = new ethers.Wallet(pk);
      relayerAddresses.add(w.address);
    }
  }
  if (SIGNER_PK) {
    relayerAddresses.add(signer.address);
  }

  console.log(`\nGranting roles to ${relayerAddresses.size} relayer addresses...\n`);

  // Grant WITHDRAW_REQUESTER_ROLE on CollateralHub
  console.log("=== CollateralHub: WITHDRAW_REQUESTER_ROLE ===");
  for (const addr of relayerAddresses) {
    const has = await hub.hasRole(withdrawRequesterRole, addr);
    if (has) {
      console.log(`  ${addr} — already has role, skipping`);
      continue;
    }
    console.log(`  ${addr} — granting...`);
    const tx = await hub.grantRole(withdrawRequesterRole, addr);
    const receipt = await tx.wait();
    console.log(`    tx: ${tx.hash} block: ${receipt.blockNumber}`);
  }

  // Grant WITHDRAW_SENDER_ROLE on HubBridgeOutbox
  console.log("\n=== HubBridgeOutbox: WITHDRAW_SENDER_ROLE ===");
  for (const addr of relayerAddresses) {
    const has = await outbox.hasRole(withdrawSenderRole, addr);
    if (has) {
      console.log(`  ${addr} — already has role, skipping`);
      continue;
    }
    console.log(`  ${addr} — granting...`);
    const tx = await outbox.grantRole(withdrawSenderRole, addr);
    const receipt = await tx.wait();
    console.log(`    tx: ${tx.hash} block: ${receipt.blockNumber}`);
  }

  // Final verification
  console.log("\n=== VERIFICATION ===");
  for (const addr of relayerAddresses) {
    const hasWR = await hub.hasRole(withdrawRequesterRole, addr);
    const hasWS = await outbox.hasRole(withdrawSenderRole, addr);
    const status = hasWR && hasWS ? "✓" : "✗";
    console.log(`  ${status} ${addr} — WITHDRAW_REQUESTER: ${hasWR}, WITHDRAW_SENDER: ${hasWS}`);
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
