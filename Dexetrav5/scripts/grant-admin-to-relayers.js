#!/usr/bin/env node
const { ethers } = require("ethers");
const path = require("path");

try { require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") }); } catch (_) {}

const CORE_VAULT_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function getRoleAdmin(bytes32 role) view returns (bytes32)",
  "function grantRole(bytes32 role, address account)",
  "function getRoleMemberCount(bytes32 role) view returns (uint256)",
  "function getRoleMember(bytes32 role, uint256 index) view returns (address)",
];

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

async function main() {
  const rpc = process.env.RPC_URL || process.env.NEXT_PUBLIC_RPC_URL;
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
  if (!rpc || !coreVaultAddr) throw new Error("Missing RPC_URL or CORE_VAULT_ADDRESS");

  const provider = new ethers.JsonRpcProvider(rpc);
  const network = await provider.getNetwork();
  console.log(`Chain: ${network.chainId}  RPC: ${rpc.slice(0, 50)}…`);
  console.log(`CoreVault: ${coreVaultAddr}\n`);

  const vault = new ethers.Contract(coreVaultAddr, CORE_VAULT_ABI, provider);

  // Enumerate current DEFAULT_ADMIN_ROLE holders
  console.log("═══ Current DEFAULT_ADMIN_ROLE holders ═══");
  let memberCount = 0;
  try {
    memberCount = Number(await vault.getRoleMemberCount(DEFAULT_ADMIN_ROLE));
  } catch {
    console.log("  (getRoleMemberCount not available — AccessControl without Enumerable)");
  }
  const existingAdmins = new Set();
  if (memberCount > 0) {
    for (let i = 0; i < memberCount; i++) {
      const addr = await vault.getRoleMember(DEFAULT_ADMIN_ROLE, i);
      existingAdmins.add(addr.toLowerCase());
      console.log(`  [${i}] ${addr}`);
    }
  }
  console.log(`  Total: ${memberCount}\n`);

  // Gather all relayer private keys
  const relayerKeys = [];
  const seen = new Set();

  function addKey(pk, label) {
    if (!pk || typeof pk !== "string") return;
    const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
    if (!/^0x[a-fA-F0-9]{64}$/.test(normalized)) return;
    if (seen.has(normalized.toLowerCase())) return;
    seen.add(normalized.toLowerCase());
    const w = new ethers.Wallet(normalized);
    relayerKeys.push({ key: normalized, address: w.address, label });
  }

  addKey(process.env.RELAYER_PRIVATE_KEY, "RELAYER_PRIVATE_KEY");
  addKey(process.env.ROLE_GRANTER_PRIVATE_KEY, "ROLE_GRANTER_PRIVATE_KEY");

  // Parse JSON arrays of relayer keys
  for (const envVar of [
    "RELAYER_PRIVATE_KEYS_JSON",
    "RELAYER_PRIVATE_KEYS_HUB_TRADE_SMALL_JSON",
    "RELAYER_PRIVATE_KEYS_HUB_TRADE_BIG_JSON",
  ]) {
    try {
      const arr = JSON.parse(process.env[envVar] || "[]");
      arr.forEach((k, i) => addKey(k, `${envVar}[${i}]`));
    } catch {}
  }

  console.log(`═══ Relayer addresses (${relayerKeys.length} unique) ═══`);
  for (const r of relayerKeys) {
    const has = existingAdmins.has(r.address.toLowerCase())
      || await vault.hasRole(DEFAULT_ADMIN_ROLE, r.address);
    console.log(`  ${r.address}  ${has ? "✅ has role" : "❌ MISSING"}  (${r.label})`);
  }

  // Find the admin signer key (try PRIVATE_KEY, ADMIN_PRIVATE_KEY_*, etc.)
  const adminCandidates = [
    process.env.PRIVATE_KEY,
    process.env.ADMIN_PRIVATE_KEY,
    process.env.ADMIN_PRIVATE_KEY_2,
    process.env.ADMIN_PRIVATE_KEY_3,
    process.env.ADMIN_PRIVATE_KEY_4,
    process.env.SETTLEMENT_PRIVATE_KEY,
    process.env.SECOND_PRIVATE_KEY,
  ].filter(Boolean);

  let adminWallet = null;
  for (const pk of adminCandidates) {
    try {
      const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
      const w = new ethers.Wallet(normalized, provider);
      const has = await vault.hasRole(DEFAULT_ADMIN_ROLE, w.address);
      if (has) {
        adminWallet = w;
        console.log(`\n🔑 Admin signer found: ${w.address}`);
        break;
      }
    } catch {}
  }

  if (!adminWallet) {
    console.error("\n❌ No signer with DEFAULT_ADMIN_ROLE found in env. Cannot grant roles.");
    process.exit(1);
  }

  const vaultWithSigner = vault.connect(adminWallet);

  // Grant DEFAULT_ADMIN_ROLE to each relayer that doesn't have it
  console.log("\n═══ Granting DEFAULT_ADMIN_ROLE ═══");
  let granted = 0, skipped = 0, failed = 0;
  for (const r of relayerKeys) {
    const has = await vault.hasRole(DEFAULT_ADMIN_ROLE, r.address);
    if (has) {
      console.log(`  ${r.address} — already has role (skip)`);
      skipped++;
      continue;
    }
    try {
      const tx = await vaultWithSigner.grantRole(DEFAULT_ADMIN_ROLE, r.address);
      const receipt = await tx.wait();
      console.log(`  ${r.address} — granted ✅  (tx: ${receipt.hash})`);
      granted++;
    } catch (err) {
      console.log(`  ${r.address} — FAILED ❌  ${err.message?.slice(0, 120)}`);
      failed++;
    }
  }

  console.log(`\n════════════════════════════════════`);
  console.log(`Granted: ${granted}  Skipped: ${skipped}  Failed: ${failed}  Total: ${relayerKeys.length}`);

  // Also grant ORDERBOOK_ROLE and SETTLEMENT_ROLE descriptions for reference
  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));
  console.log(`\nℹ️  Reference role hashes:`);
  console.log(`  DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
  console.log(`  ORDERBOOK_ROLE:     ${ORDERBOOK_ROLE}`);
  console.log(`  SETTLEMENT_ROLE:    ${SETTLEMENT_ROLE}`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
