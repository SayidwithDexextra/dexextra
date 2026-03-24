#!/usr/bin/env tsx
/**
 * Audit DEFAULT_ADMIN_ROLE holders on CoreVault and optionally grant it
 * to a target wallet.
 *
 * Phase 1 — Read: scans all known wallet keys in .env.local and reports
 *           which addresses currently hold DEFAULT_ADMIN_ROLE.
 * Phase 2 — Grant: if a --to address is supplied (or defaults to the
 *           address derived from ADMIN_PRIVATE_KEY), grants DEFAULT_ADMIN_ROLE
 *           using the first signer found that already holds it.
 *
 * Env (from .env.local):
 *   - RPC_URL (or HYPERLIQUID_RPC_URL)
 *   - CORE_VAULT_ADDRESS
 *   - ADMIN_PRIVATE_KEY, PRIVATE_KEY_USERD, PRIVATE_KEY, CREATOR_PRIVATE_KEY,
 *     RELAYER_PRIVATE_KEY, ADMIN_PRIVATE_KEY_2, ADMIN_PRIVATE_KEY_3,
 *     ADMIN_PRIVATE_KEY_4, SESSION_REGISTRY_OWNER_PRIVATE_KEY
 *
 * CLI:
 *   tsx accessControlScripts/check-and-grant-admin-role.ts                # audit only
 *   tsx accessControlScripts/check-and-grant-admin-role.ts --grant        # audit + grant to ADMIN_PRIVATE_KEY address
 *   tsx accessControlScripts/check-and-grant-admin-role.ts --grant --to 0x...  # audit + grant to explicit address
 *   tsx accessControlScripts/check-and-grant-admin-role.ts --grant --signer PRIVATE_KEY_USERD  # use specific signer
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

function loadEnv() {
  const local = path.join(process.cwd(), ".env.local");
  if (fs.existsSync(local)) dotenv.config({ path: local });
  else dotenv.config();
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

const PRIVATE_KEY_ENV_NAMES = [
  "ADMIN_PRIVATE_KEY",
  "PRIVATE_KEY_USERD",
  "PRIVATE_KEY",
  "CREATOR_PRIVATE_KEY",
  "RELAYER_PRIVATE_KEY",
  "SETTLEMENT_PRIVATE_KEY",
  "SECOND_PRIVATE_KEY",
  "ADMIN_PRIVATE_KEY_2",
  "ADMIN_PRIVATE_KEY_3",
  "ADMIN_PRIVATE_KEY_4",
  "SESSION_REGISTRY_OWNER_PRIVATE_KEY",
  "FUNDER_PRIVATE_KEY",
  "PRIVATE_KEY_DEPLOYER",
  "PRIVATE_KEY_USER2",
  "PRIVATE_KEY_USER3",
  "PRIVATE_KEY_USER4",
  "PRIVATE_KEY_USER5",
];

function normalizePk(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`;
}

function isValidPk(v: string | undefined): v is string {
  if (!v) return false;
  const n = normalizePk(v);
  return /^0x[a-fA-F0-9]{64}$/.test(n);
}

interface WalletEntry {
  envName: string;
  pk: string;
  address: string;
}

function collectWallets(): WalletEntry[] {
  const seen = new Set<string>();
  const wallets: WalletEntry[] = [];

  for (const name of PRIVATE_KEY_ENV_NAMES) {
    const raw = process.env[name];
    if (!isValidPk(raw)) continue;
    const pk = normalizePk(raw);
    const address = new ethers.Wallet(pk).address.toLowerCase();
    if (seen.has(address)) continue;
    seen.add(address);
    wallets.push({ envName: name, pk, address: new ethers.Wallet(pk).address });
  }

  return wallets;
}

async function main() {
  loadEnv();

  const rpcUrl =
    process.env.RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.HYPERLIQUID_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL is required");

  const coreVaultAddress =
    process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress))
    throw new Error("CORE_VAULT_ADDRESS is required");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();

  const vault = new ethers.Contract(
    coreVaultAddress,
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function getRoleAdmin(bytes32) view returns (bytes32)",
      "function grantRole(bytes32,address)",
    ],
    provider,
  );

  const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;

  console.log("═══════════════════════════════════════════════════════════");
  console.log("  CoreVault DEFAULT_ADMIN_ROLE Audit");
  console.log("═══════════════════════════════════════════════════════════");
  console.log(`  Chain ID     : ${net.chainId}`);
  console.log(`  CoreVault    : ${coreVaultAddress}`);
  console.log(`  Role (bytes32): ${DEFAULT_ADMIN_ROLE}`);
  console.log("───────────────────────────────────────────────────────────");

  const wallets = collectWallets();
  if (wallets.length === 0) throw new Error("No private keys found in env");

  const holders: WalletEntry[] = [];
  const nonHolders: WalletEntry[] = [];

  for (const w of wallets) {
    const has: boolean = await vault.hasRole(DEFAULT_ADMIN_ROLE, w.address);
    const status = has ? "✅ HAS ROLE" : "❌ no role";
    console.log(`  ${status}  ${w.address}  (${w.envName})`);
    if (has) holders.push(w);
    else nonHolders.push(w);
  }

  console.log("───────────────────────────────────────────────────────────");
  console.log(`  Total wallets scanned : ${wallets.length}`);
  console.log(`  Holders               : ${holders.length}`);
  console.log(`  Non-holders           : ${nonHolders.length}`);
  console.log("═══════════════════════════════════════════════════════════\n");

  // Also check DIAMOND_OWNER_ADDRESS if set (not derived from a key we have)
  const diamondOwner = process.env.DIAMOND_OWNER_ADDRESS;
  if (diamondOwner && ethers.isAddress(diamondOwner)) {
    const alreadyScanned = wallets.some(
      (w) => w.address.toLowerCase() === diamondOwner.toLowerCase(),
    );
    if (!alreadyScanned) {
      const has = await vault.hasRole(DEFAULT_ADMIN_ROLE, diamondOwner);
      console.log(
        `  DIAMOND_OWNER_ADDRESS ${diamondOwner}: ${has ? "✅ HAS ROLE" : "❌ no role"}\n`,
      );
    }
  }

  // ── Phase 2: Grant ──
  if (!hasFlag("--grant")) {
    console.log('  Pass --grant to grant DEFAULT_ADMIN_ROLE to a target address.');
    console.log('  Example: tsx accessControlScripts/check-and-grant-admin-role.ts --grant --to 0x...\n');
    return;
  }

  if (holders.length === 0) {
    throw new Error(
      "No env wallet currently holds DEFAULT_ADMIN_ROLE — cannot grant. " +
        "You need a signer that already has the role.",
    );
  }

  // Determine target
  let toAddress = getArg("--to");
  if (!toAddress) {
    const adminPk = process.env.ADMIN_PRIVATE_KEY;
    if (!isValidPk(adminPk))
      throw new Error("No --to provided and ADMIN_PRIVATE_KEY not set");
    toAddress = new ethers.Wallet(normalizePk(adminPk)).address;
    console.log(`  Target (from ADMIN_PRIVATE_KEY): ${toAddress}`);
  } else {
    if (!ethers.isAddress(toAddress)) throw new Error(`Invalid --to address: ${toAddress}`);
    toAddress = ethers.getAddress(toAddress);
    console.log(`  Target (from --to): ${toAddress}`);
  }

  // Check if target already has the role
  const targetHas = await vault.hasRole(DEFAULT_ADMIN_ROLE, toAddress);
  if (targetHas) {
    console.log(`\n  ✅ ${toAddress} already has DEFAULT_ADMIN_ROLE. Nothing to do.\n`);
    return;
  }

  // Pick signer
  const signerEnvOverride = getArg("--signer");
  let signer: WalletEntry;
  if (signerEnvOverride) {
    const match = holders.find(
      (h) => h.envName === signerEnvOverride,
    );
    if (!match) {
      throw new Error(
        `--signer ${signerEnvOverride} either not found in env or does not hold DEFAULT_ADMIN_ROLE`,
      );
    }
    signer = match;
  } else {
    signer = holders[0];
  }

  console.log(`  Signer: ${signer.address} (${signer.envName})`);
  console.log(`  Granting DEFAULT_ADMIN_ROLE to ${toAddress} ...`);

  const signerWallet = new ethers.Wallet(signer.pk, provider);
  const vaultRW = vault.connect(signerWallet);
  const tx = await vaultRW.grantRole(DEFAULT_ADMIN_ROLE, toAddress);
  console.log(`  tx hash: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`  Mined in block ${receipt?.blockNumber}`);

  // Verify
  const verified = await vault.hasRole(DEFAULT_ADMIN_ROLE, toAddress);
  console.log(
    `\n  ${verified ? "✅" : "❌"} ${toAddress} DEFAULT_ADMIN_ROLE: ${verified}\n`,
  );
}

main().catch((e) => {
  console.error("\ncheck-and-grant-admin-role failed:", e?.message || String(e));
  process.exit(1);
});
