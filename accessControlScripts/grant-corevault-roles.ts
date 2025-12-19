#!/usr/bin/env tsx
/**
 * Grant CoreVault roles to a target wallet address (idempotent).
 *
 * Defaults to granting DEFAULT_ADMIN_ROLE to DIAMOND_OWNER_ADDRESS using LEGACY_ADMIN.
 *
 * Env (from .env.local preferred):
 *   - RPC_URL (or RPC_URL_HYPEREVM)
 *   - CORE_VAULT_ADDRESS
 *   - LEGACY_ADMIN (private key of an address that already has DEFAULT_ADMIN_ROLE)
 *   - RELAYER_ADDRESS (optional; default target if set)
 *   - DIAMOND_OWNER_ADDRESS (optional fallback target if RELAYER_ADDRESS is not set)
 *
 * Optional:
 *   - GRANT_ROLES: comma-separated role names or hex bytes32 values.
 *       Examples:
 *         GRANT_ROLES=DEFAULT_ADMIN_ROLE
 *         GRANT_ROLES=ORDERBOOK_ROLE,SETTLEMENT_ROLE
 *         GRANT_ROLES=0xabc... (bytes32)
 *
 * CLI overrides:
 *   --rpc <url>
 *   --corevault <address>
 *   --to <address>
 *   --roles <comma-separated roles>
 *
 * Usage:
 *   tsx accessControlScripts/grant-corevault-roles.ts
 *   tsx accessControlScripts/grant-corevault-roles.ts --roles DEFAULT_ADMIN_ROLE
 *   tsx accessControlScripts/grant-corevault-roles.ts --to 0x... --roles ORDERBOOK_ROLE,SETTLEMENT_ROLE
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

function loadEnv() {
  const root = process.cwd();
  const local = path.join(root, ".env.local");
  if (fs.existsSync(local)) {
    dotenv.config({ path: local });
  } else {
    dotenv.config();
  }
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = process.argv[idx + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function isBytes32(v: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(v.trim());
}

function parseRoles(input: string): { label: string; role: string }[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];

  return parts.map((p) => {
    if (p === "DEFAULT_ADMIN_ROLE") {
      return { label: p, role: ethers.ZeroHash };
    }
    if (isBytes32(p)) {
      return { label: p, role: p };
    }
    // treat as role name to keccak256, e.g. "ORDERBOOK_ROLE"
    return { label: p, role: ethers.keccak256(ethers.toUtf8Bytes(p)) };
  });
}

async function main() {
  loadEnv();

  const rpcUrl =
    getArg("--rpc") ||
    process.env.RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.NEXT_PUBLIC_RPC_URL_HYPEREVM ||
    process.env.HYPERLIQUID_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) is required");

  const coreVaultAddress =
    getArg("--corevault") || process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
  if (!coreVaultAddress) throw new Error("CORE_VAULT_ADDRESS is required (or pass --corevault)");

  const to = getArg("--to") || process.env.RELAYER_ADDRESS || process.env.DIAMOND_OWNER_ADDRESS;
  if (!to) throw new Error("RELAYER_ADDRESS (or DIAMOND_OWNER_ADDRESS) is required (or pass --to)");

  const pk = process.env.LEGACY_ADMIN;
  if (!pk) throw new Error("LEGACY_ADMIN is required (private key with DEFAULT_ADMIN_ROLE on CoreVault)");

  const rolesInput = getArg("--roles") || process.env.GRANT_ROLES || "DEFAULT_ADMIN_ROLE";
  const roles = parseRoles(rolesInput);
  if (roles.length === 0) throw new Error("No roles provided (use --roles or GRANT_ROLES)");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  const vault = new ethers.Contract(
    coreVaultAddress,
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function getRoleAdmin(bytes32) view returns (bytes32)",
      "function grantRole(bytes32,address)",
    ],
    wallet
  );

  console.log("[grant-corevault-roles] coreVault", coreVaultAddress);
  console.log("[grant-corevault-roles] to", to);
  console.log("[grant-corevault-roles] signer", wallet.address);
  console.log("[grant-corevault-roles] roles", roles.map((r) => r.label).join(", "));

  // Preflight: ensure signer is admin for the requested roles (best-effort check).
  for (const { label, role } of roles) {
    let adminRole: string | undefined;
    try {
      adminRole = await vault.getRoleAdmin(role);
    } catch {
      // ignore; some deployments might not expose it in ABI, though AccessControl does.
    }
    if (adminRole) {
      const ok = await vault.hasRole(adminRole, wallet.address);
      if (!ok) {
        throw new Error(
          `Signer ${wallet.address} is missing admin role ${adminRole} required to grant ${label} (${role}).`
        );
      }
    }
  }

  for (const { label, role } of roles) {
    const has = await vault.hasRole(role, to);
    console.log(`[check] ${label} currently ${has ? "✅" : "❌"}`);
    if (!has) {
      console.log(`[tx] granting ${label} ...`);
      const tx = await vault.grantRole(role, to);
      console.log(`[tx] hash ${tx.hash}`);
      const rcpt = await tx.wait();
      console.log(`[tx] ${label} granted in block ${rcpt?.blockNumber}`);
    }
  }

  // Final verify
  for (const { label, role } of roles) {
    const has = await vault.hasRole(role, to);
    console.log(`[final] ${label} ${has ? "✅" : "❌"}`);
  }
}

main().catch((e) => {
  console.error("grant-corevault-roles failed:", e?.stack || e?.message || String(e));
  process.exit(1);
});


