/**
 * Deploys new SpokeVault + SpokeBridgeInbox on Arbitrum and configures them.
 * Then updates HubBridgeOutbox on HyperEVM to point to the new inbox.
 *
 * Phases 1-3 of the redeploy checklist.
 *
 * Usage:  node scripts/deploy-spoke-arbitrum-v2.js
 */
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
const { ethers } = require("ethers");
const fs = require("fs");

const ADMIN_ADDR = "0x25b67c3AcCdFd5F1865f7a8A206Bbfc15cBc2306";
const ADMIN_PK = process.env.RELAYER_PRIVATE_KEY;
const ARB_RPC = process.env.ARBITRUM_RPC_URL;
const HUB_RPC = process.env.RPC_URL;
const USDC_TOKEN = process.env.SPOKE_ARBITRUM_USDC_ADDRESS || "0x522DED024D4cC9dac6BC45E155709532A23AD4C8";
const HUB_OUTBOX = process.env.HUB_OUTBOX_ADDRESS || "0x4c32ff22b927a134a3286d5E33212debF951AcF5";
const HUB_DOMAIN = 999;
const ARB_DOMAIN = 42161;

if (!ADMIN_PK || !ARB_RPC || !HUB_RPC) {
  console.error("Missing RELAYER_PRIVATE_KEY / ARBITRUM_RPC_URL / RPC_URL");
  process.exit(1);
}

function loadArtifact(name) {
  const p = path.resolve(__dirname, `../artifacts/src/collateral/spokes/SpokeVault.sol/SpokeVault.json`);
  const p2 = path.resolve(__dirname, `../artifacts/src/collateral/bridge/wormhole/SpokeBridgeInboxWormhole.sol/SpokeBridgeInboxWormhole.json`);
  if (name === "SpokeVault") return JSON.parse(fs.readFileSync(p, "utf8"));
  if (name === "SpokeBridgeInboxWormhole") return JSON.parse(fs.readFileSync(p2, "utf8"));
  throw new Error("Unknown artifact: " + name);
}

function toBytes32Address(addr) {
  return "0x" + "0".repeat(24) + addr.toLowerCase().replace(/^0x/, "");
}

async function main() {
  const arbProvider = new ethers.JsonRpcProvider(ARB_RPC);
  const hubProvider = new ethers.JsonRpcProvider(HUB_RPC);

  const adminNorm = ADMIN_PK.startsWith("0x") ? ADMIN_PK : "0x" + ADMIN_PK;
  const arbSigner = new ethers.Wallet(adminNorm, arbProvider);
  const hubSigner = new ethers.Wallet(adminNorm, hubProvider);

  console.log("Deployer/Admin:", arbSigner.address);
  const arbBal = await arbProvider.getBalance(arbSigner.address);
  const hubBal = await hubProvider.getBalance(hubSigner.address);
  console.log("Arbitrum ETH:", ethers.formatEther(arbBal));
  console.log("HyperEVM HYPE:", ethers.formatEther(hubBal));
  console.log("");

  // Load relayer addresses
  const relayerAddresses = new Set();
  try {
    const keys = JSON.parse(process.env.RELAYER_PRIVATE_KEYS_JSON || "[]");
    for (const pk of keys) relayerAddresses.add(new ethers.Wallet(pk).address);
  } catch {}
  relayerAddresses.add(ADMIN_ADDR);
  console.log(`Will grant BRIDGE_ENDPOINT_ROLE to ${relayerAddresses.size} relayers\n`);

  // ========== PHASE 1: Deploy ==========
  console.log("═══════════════════════════════════════════");
  console.log("  PHASE 1: Deploy contracts on Arbitrum");
  console.log("═══════════════════════════════════════════\n");

  const vaultArtifact = loadArtifact("SpokeVault");
  const inboxArtifact = loadArtifact("SpokeBridgeInboxWormhole");

  // Deploy SpokeVault
  console.log("Deploying SpokeVault...");
  console.log("  allowedTokens:", [USDC_TOKEN]);
  console.log("  admin:", ADMIN_ADDR);
  console.log("  bridgeInbox: address(0) (set later)");

  const VaultFactory = new ethers.ContractFactory(vaultArtifact.abi, vaultArtifact.bytecode, arbSigner);
  const vault = await VaultFactory.deploy([USDC_TOKEN], ADMIN_ADDR, ethers.ZeroAddress);
  const vaultReceipt = await vault.deploymentTransaction().wait();
  const newVaultAddr = await vault.getAddress();
  console.log(`  ✓ SpokeVault deployed: ${newVaultAddr}`);
  console.log(`    tx: ${vault.deploymentTransaction().hash}`);
  console.log(`    block: ${vaultReceipt.blockNumber}\n`);

  // Deploy SpokeBridgeInboxWormhole
  console.log("Deploying SpokeBridgeInboxWormhole...");
  console.log("  spokeVault:", newVaultAddr);
  console.log("  admin:", ADMIN_ADDR);

  const InboxFactory = new ethers.ContractFactory(inboxArtifact.abi, inboxArtifact.bytecode, arbSigner);
  const inbox = await InboxFactory.deploy(newVaultAddr, ADMIN_ADDR);
  const inboxReceipt = await inbox.deploymentTransaction().wait();
  const newInboxAddr = await inbox.getAddress();
  console.log(`  ✓ SpokeBridgeInboxWormhole deployed: ${newInboxAddr}`);
  console.log(`    tx: ${inbox.deploymentTransaction().hash}`);
  console.log(`    block: ${inboxReceipt.blockNumber}\n`);

  console.log("Phase 1 COMPLETE ✓\n");

  // ========== PHASE 2: Configure new contracts ==========
  console.log("═══════════════════════════════════════════");
  console.log("  PHASE 2: Configure new contracts");
  console.log("═══════════════════════════════════════════\n");

  // 2a: SpokeVault.setBridgeInbox
  console.log("2a: SpokeVault.setBridgeInbox →", newInboxAddr);
  const vaultContract = new ethers.Contract(newVaultAddr, vaultArtifact.abi, arbSigner);
  const tx1 = await vaultContract.setBridgeInbox(newInboxAddr);
  await tx1.wait();
  console.log("  ✓ setBridgeInbox confirmed\n");

  // 2b: SpokeBridgeInbox.setRemoteApp(999, HubBridgeOutbox padded)
  const hubOutboxPadded = toBytes32Address(HUB_OUTBOX);
  console.log(`2b: SpokeBridgeInbox.setRemoteApp(${HUB_DOMAIN}, ${hubOutboxPadded})`);
  const inboxContract = new ethers.Contract(newInboxAddr, inboxArtifact.abi, arbSigner);
  const tx2 = await inboxContract.setRemoteApp(HUB_DOMAIN, hubOutboxPadded);
  await tx2.wait();
  console.log("  ✓ setRemoteApp confirmed\n");

  // 2c: Grant BRIDGE_ENDPOINT_ROLE to all relayers
  console.log("2c: Granting BRIDGE_ENDPOINT_ROLE to relayers...");
  const BRIDGE_ENDPOINT_ROLE = await inboxContract.BRIDGE_ENDPOINT_ROLE();
  for (const addr of relayerAddresses) {
    const has = await inboxContract.hasRole(BRIDGE_ENDPOINT_ROLE, addr);
    if (has) {
      console.log(`  ${addr} — already has role`);
      continue;
    }
    const tx = await inboxContract.grantRole(BRIDGE_ENDPOINT_ROLE, addr);
    await tx.wait();
    console.log(`  ${addr} — granted ✓`);
  }
  console.log("\nPhase 2 COMPLETE ✓\n");

  // ========== PHASE 3: Update HubBridgeOutbox ==========
  console.log("═══════════════════════════════════════════");
  console.log("  PHASE 3: Update HubBridgeOutbox on HyperEVM");
  console.log("═══════════════════════════════════════════\n");

  const outboxAbi = [
    "function setRemoteApp(uint64 domain, bytes32 remoteApp) external",
    "function remoteAppByDomain(uint64) view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
  ];
  const outbox = new ethers.Contract(HUB_OUTBOX, outboxAbi, hubSigner);

  // Verify admin
  const adminRole = await outbox.DEFAULT_ADMIN_ROLE();
  const isAdmin = await outbox.hasRole(adminRole, hubSigner.address);
  console.log("Signer has admin on HubBridgeOutbox:", isAdmin);
  if (!isAdmin) {
    console.error("ERROR: Signer does not have admin on HubBridgeOutbox!");
    process.exit(1);
  }

  const newInboxPadded = toBytes32Address(newInboxAddr);
  const oldRemote = await outbox.remoteAppByDomain(ARB_DOMAIN);
  console.log(`Old remoteApp(${ARB_DOMAIN}):`, oldRemote);
  console.log(`New remoteApp(${ARB_DOMAIN}):`, newInboxPadded);

  const tx3 = await outbox.setRemoteApp(ARB_DOMAIN, newInboxPadded);
  await tx3.wait();
  console.log("  ✓ setRemoteApp confirmed");

  // Verify
  const updatedRemote = await outbox.remoteAppByDomain(ARB_DOMAIN);
  console.log("  Verified:", updatedRemote === newInboxPadded ? "MATCH ✓" : "MISMATCH ✗");
  console.log("\nPhase 3 COMPLETE ✓\n");

  // ========== Summary ==========
  console.log("═══════════════════════════════════════════");
  console.log("  DEPLOYMENT COMPLETE — Summary");
  console.log("═══════════════════════════════════════════\n");
  console.log("New SpokeVault:", newVaultAddr);
  console.log("New SpokeBridgeInbox:", newInboxAddr);
  console.log("");
  console.log("--- .env.local updates (Phase 4) ---");
  console.log(`NEXT_PUBLIC_SPOKE_ARBITRUM_VAULT_ADDRESS=${newVaultAddr}`);
  console.log(`SPOKE_ARBITRUM_VAULT_ADDRESS=${newVaultAddr}`);
  console.log(`SPOKE_INBOX_ADDRESS_ARBITRUM=${newInboxAddr}`);
  console.log("");
  console.log("--- Alchemy webhook filter update (Phase 5) ---");
  console.log("Update topics[2] to:");
  console.log(`  ${toBytes32Address(newVaultAddr)}`);
  console.log("");
  console.log("Full updated GraphQL filter:");
  console.log(`{
  block {
    logs(
      filter: {
        addresses: ["${USDC_TOKEN}"]
        topics: [
          ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x8752a472e571a816aea92eec8dae9baf628e840f4929fbcc2d155e6233ff68a7"],
          [],
          ["${toBytes32Address(newVaultAddr)}"]
        ]
      }
    ) {
      account { address }
      topics
      transaction {
        hash
        from { address }
        to { address }
        status
      }
    }
  }
}`);

  // Save deployment record
  const record = {
    timestamp: new Date().toISOString(),
    network: "arbitrum",
    chainId: ARB_DOMAIN,
    admin: ADMIN_ADDR,
    spokeVault: newVaultAddr,
    spokeBridgeInbox: newInboxAddr,
    usdcToken: USDC_TOKEN,
    hubOutbox: HUB_OUTBOX,
    relayersGranted: [...relayerAddresses],
  };
  const recordPath = path.resolve(__dirname, "../deployments/arbitrum-spoke-v2-deployment.json");
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(record, null, 2));
  console.log("\nDeployment record saved to:", recordPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
