#!/usr/bin/env tsx
/**
 * One-shot script to:
 *  1) Transfer GlobalSessionRegistry ownership to a target wallet address
 *  2) Grant CoreVault roles to a target wallet address
 *
 * This intentionally requires explicit flags for the target address + roles to avoid
 * accidentally granting DEFAULT_ADMIN_ROLE to the wrong wallet.
 *
 * Reads from .env.local preferred (project root), falling back to .env:
 *   - RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) (required)
 *   - SESSION_REGISTRY_ADDRESS (required unless --registry)
 *   - CORE_VAULT_ADDRESS (required unless --corevault)
 *   - Signer keys:
 *       - REGISTRY_OWNER_PRIVATE_KEY / RELAYER_PRIVATE_KEY / ADMIN_PRIVATE_KEY / LEGACY_ADMIN / LEGACY_ADMIN_PRIVATE_KEY
 *         (must be the CURRENT owner of the registry to transfer ownership)
 *       - LEGACY_ADMIN (must have DEFAULT_ADMIN_ROLE on CoreVault to grant roles)
 *
 * Usage:
 *   npx --no-install tsx accessControlScripts/setup-access-control.ts --to 0x... --roles ORDERBOOK_ROLE,SETTLEMENT_ROLE
 *
 * Options:
 *   --to 0x...           Target address (required)
 *   --roles a,b,c        Comma-separated roles (required). Values can be:
 *                          - DEFAULT_ADMIN_ROLE
 *                          - A role name (hashed via keccak256(utf8))
 *                          - A raw bytes32 (0x + 64 hex chars)
 *   --registry 0x...     Override SESSION_REGISTRY_ADDRESS
 *   --corevault 0x...    Override CORE_VAULT_ADDRESS
 *   --skip-registry      Skip registry ownership transfer
 *   --skip-corevault     Skip corevault role granting
 *   --dry-run            Do reads + print intended actions, but do not send txs
 */
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { ethers } from "ethers";

function loadEnv() {
  const root = process.cwd();
  const envLocalPath = path.join(root, ".env.local");
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else {
    dotenv.config();
  }
}

function getArg(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag);
  if (idx === -1) return undefined;
  const v = argv[idx + 1];
  return v && !v.startsWith("--") ? v : undefined;
}

function hasFlag(argv: string[], flag: string): boolean {
  return argv.includes(flag);
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function pickFirstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

function isBytes32(v: string): boolean {
  return /^0x[a-fA-F0-9]{64}$/.test(v.trim());
}

function isPrivateKey(v: string | undefined): v is string {
  return !!v && /^0x[a-fA-F0-9]{64}$/.test(v.trim());
}

function parseRoles(input: string): { label: string; role: string }[] {
  const parts = input
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length === 0) return [];

  return parts.map((p) => {
    if (p === "DEFAULT_ADMIN_ROLE") return { label: p, role: ethers.ZeroHash };
    if (isBytes32(p)) return { label: p, role: p };
    return { label: p, role: ethers.keccak256(ethers.toUtf8Bytes(p)) };
  });
}

function uniqByRole(items: { label: string; role: string }[]): { label: string; role: string }[] {
  const seen = new Set<string>();
  const out: { label: string; role: string }[] = [];
  for (const it of items) {
    const k = it.role.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(it);
  }
  return out;
}

function detectRolesFromSolidityFile(solPath: string): { label: string; role: string }[] {
  const raw = fs.readFileSync(solPath, "utf8");

  // Capture patterns like:
  // bytes32 public constant ORDERBOOK_ROLE = keccak256("ORDERBOOK_ROLE");
  // bytes32 public constant SOME = 0x....
  const re = /bytes32\s+public\s+constant\s+([A-Za-z0-9_]+)\s*=\s*(keccak256\(\s*"([^"]+)"\s*\)|0x[a-fA-F0-9]{64})\s*;/g;
  const roles: { label: string; role: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw))) {
    const constName = m[1];
    const rhs = m[2];
    const strLiteral = m[3]; // only when keccak256("...")

    if (rhs.startsWith("0x") && isBytes32(rhs)) {
      roles.push({ label: constName, role: rhs });
      continue;
    }
    if (strLiteral) {
      roles.push({ label: constName, role: ethers.keccak256(ethers.toUtf8Bytes(strLiteral)) });
      continue;
    }
  }
  return roles;
}

function detectCoreVaultRoles(projectRoot: string): { label: string; role: string }[] {
  // Default source of truth: the CoreVault.sol in this repo.
  const candidates = [
    path.join(projectRoot, "Dexetrav5/src/CoreVault.sol"),
    path.join(projectRoot, "Dexetrav5/src/collateral/interfaces/ICoreVault.sol"),
  ];

  const found: { label: string; role: string }[] = [];
  for (const p of candidates) {
    if (!fs.existsSync(p)) continue;
    found.push(...detectRolesFromSolidityFile(p));
  }

  // Always include DEFAULT_ADMIN_ROLE as a named option (but still requires explicit intent via --roles all).
  found.push({ label: "DEFAULT_ADMIN_ROLE", role: ethers.ZeroHash });
  return uniqByRole(found);
}

function collectCandidatePks(names: string[]): { envName: string; pk: string }[] {
  const out: { envName: string; pk: string }[] = [];
  for (const n of names) {
    const v = process.env[n];
    if (!isPrivateKey(v)) continue;
    out.push({ envName: n, pk: v });
  }
  return out;
}

async function pickRegistryOwnerSigner(
  provider: ethers.Provider,
  registryAddress: string
): Promise<{ owner: string; signer: ethers.Wallet; signerEnv: string }> {
  const registryRO = new ethers.Contract(
    ethers.getAddress(registryAddress),
    ["function owner() view returns (address)"],
    provider
  );
  const owner = await registryRO.owner();

  const candidates = collectCandidatePks([
    "REGISTRY_OWNER_PRIVATE_KEY",
    "RELAYER_PRIVATE_KEY",
    "ADMIN_PRIVATE_KEY",
    "ROLE_ADMIN_PRIVATE_KEY",
    "LEGACY_ADMIN",
    "LEGACY_ADMIN_PRIVATE_KEY",
  ]);

  for (const c of candidates) {
    const w = new ethers.Wallet(c.pk, provider);
    const addr = await w.getAddress();
    if (addr.toLowerCase() === owner.toLowerCase()) {
      return { owner, signer: w, signerEnv: c.envName };
    }
  }

  const debug = await Promise.all(
    candidates.map(async (c) => {
      const addr = await new ethers.Wallet(c.pk, provider).getAddress();
      return `${c.envName}=${addr}`;
    })
  );
  throw new Error(
    `No configured private key matches registry owner. owner=${owner}. Candidates: ${debug.join(", ")}`
  );
}

async function pickCoreVaultGrantSigner(
  provider: ethers.Provider,
  coreVaultAddress: string,
  roles: { label: string; role: string }[]
): Promise<{ signer: ethers.Wallet; signerEnv: string }> {
  const vaultRO = new ethers.Contract(
    ethers.getAddress(coreVaultAddress),
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function getRoleAdmin(bytes32) view returns (bytes32)",
    ],
    provider
  );

  // Determine required admin roles for each role (dedupe).
  const requiredAdminRoles = new Set<string>();
  for (const r of roles) {
    try {
      const adminRole = (await vaultRO.getRoleAdmin(r.role)) as string;
      requiredAdminRoles.add(adminRole.toLowerCase());
    } catch {
      // If getRoleAdmin isn't available, we can't reliably auto-pick. Fall back to LEGACY_ADMIN.
      requiredAdminRoles.clear();
      break;
    }
  }

  const candidates = collectCandidatePks([
    "LEGACY_ADMIN",
    "ROLE_ADMIN_PRIVATE_KEY",
    "ADMIN_PRIVATE_KEY",
    "LEGACY_ADMIN_PRIVATE_KEY",
  ]);

  if (requiredAdminRoles.size === 0) {
    const fallback = candidates.find((c) => c.envName === "LEGACY_ADMIN");
    if (!fallback) throw new Error("LEGACY_ADMIN is required (private key with DEFAULT_ADMIN_ROLE on CoreVault)");
    return { signer: new ethers.Wallet(fallback.pk, provider), signerEnv: fallback.envName };
  }

  for (const c of candidates) {
    const w = new ethers.Wallet(c.pk, provider);
    let ok = true;
    for (const adminRoleLower of requiredAdminRoles) {
      const has = (await vaultRO.hasRole(adminRoleLower as any, w.address)) as boolean;
      if (!has) {
        ok = false;
        break;
      }
    }
    if (ok) return { signer: w, signerEnv: c.envName };
  }

  const debug = await Promise.all(
    candidates.map(async (c) => {
      const addr = await new ethers.Wallet(c.pk, provider).getAddress();
      return `${c.envName}=${addr}`;
    })
  );
  throw new Error(
    `No configured private key appears able to grant requested roles on CoreVault. Candidates: ${debug.join(", ")}`
  );
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);

  const toArg = getArg(argv, "--to");
  if (!toArg || !ethers.isAddress(toArg)) {
    throw new Error("Missing/invalid --to. Example: --to 0x428d7cbd7feccf01a80dace3d70b8ecf06451500");
  }
  const to = ethers.getAddress(toArg);

  const rolesArg = getArg(argv, "--roles");
  if (!rolesArg) throw new Error("Missing --roles. Example: --roles ORDERBOOK_ROLE,SETTLEMENT_ROLE (or --roles all)");

  const projectRoot = process.cwd();
  const roles =
    rolesArg.trim().toLowerCase() === "all" ? detectCoreVaultRoles(projectRoot) : parseRoles(rolesArg);
  if (roles.length === 0) throw new Error("No roles parsed from --roles");

  const rpcUrl =
    process.env.RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.NEXT_PUBLIC_RPC_URL_HYPEREVM ||
    process.env.HYPERLIQUID_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) is required");

  const dryRun = hasFlag(argv, "--dry-run");
  const skipRegistry = hasFlag(argv, "--skip-registry");
  const skipCoreVault = hasFlag(argv, "--skip-corevault");

  const registryOverride = getArg(argv, "--registry");
  const coreVaultOverride = getArg(argv, "--corevault");

  const registryAddress =
    registryOverride || process.env.SESSION_REGISTRY_ADDRESS || process.env.NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS;
  const coreVaultAddress =
    coreVaultOverride || process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const net = await provider.getNetwork();
  console.log("[setup-access-control] network", { chainId: String(net.chainId) });
  console.log("[setup-access-control] to", to);
  console.log("[setup-access-control] roles", roles.map((r) => r.label).join(", "));
  console.log("[setup-access-control] dryRun", dryRun);

  if (!skipRegistry) {
    if (!registryAddress) throw new Error("SESSION_REGISTRY_ADDRESS is required (or pass --registry)");
    if (!ethers.isAddress(registryAddress)) throw new Error("SESSION_REGISTRY_ADDRESS (or --registry) is not a valid address");

    const picked = await pickRegistryOwnerSigner(provider, registryAddress);
    const ownerSigner = picked.signer;
    const registry = new ethers.Contract(
      ethers.getAddress(registryAddress),
      ["function owner() view returns (address)", "function transferOwnership(address newOwner) external"],
      ownerSigner
    );

    const signerAddress = await ownerSigner.getAddress();
    const owner = await registry.owner();
    console.log("[registry] address", ethers.getAddress(registryAddress));
    console.log("[registry] owner (on-chain)", owner);
    console.log("[registry] signer", signerAddress, `(from ${picked.signerEnv})`);
    console.log("[registry] new owner", to);

    if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
      throw new Error(`Registry signer is not current owner. owner=${owner}, signer=${signerAddress}`);
    }

    if (owner.toLowerCase() === to.toLowerCase()) {
      console.log("[registry] already owned by target; skipping transfer");
    } else if (dryRun) {
      console.log("[registry] dry-run; would call transferOwnership(to)");
    } else {
      const tx = await registry.transferOwnership(to);
      console.log("[registry] transferOwnership tx", tx.hash);
      await tx.wait();
      console.log("[registry] transferOwnership mined");
    }
  } else {
    console.log("[registry] skipped");
  }

  if (!skipCoreVault) {
    if (!coreVaultAddress) throw new Error("CORE_VAULT_ADDRESS is required (or pass --corevault)");
    if (!ethers.isAddress(coreVaultAddress)) throw new Error("CORE_VAULT_ADDRESS (or --corevault) is not a valid address");

    const picked = await pickCoreVaultGrantSigner(provider, coreVaultAddress, roles);
    const adminWallet = picked.signer;
    const vault = new ethers.Contract(
      ethers.getAddress(coreVaultAddress),
      [
        "function hasRole(bytes32,address) view returns (bool)",
        "function getRoleAdmin(bytes32) view returns (bytes32)",
        "function grantRole(bytes32,address)",
      ],
      adminWallet
    );

    console.log("[corevault] address", ethers.getAddress(coreVaultAddress));
    console.log("[corevault] signer", adminWallet.address, `(from ${picked.signerEnv})`);

    // Preflight: ensure signer is admin for each requested role (best-effort).
    for (const { label, role } of roles) {
      let adminRole: string | undefined;
      try {
        adminRole = await vault.getRoleAdmin(role);
      } catch {}
      if (adminRole) {
        const ok = await vault.hasRole(adminRole, adminWallet.address);
        if (!ok) {
          throw new Error(
            `CoreVault signer ${adminWallet.address} missing admin role ${adminRole} required to grant ${label} (${role}).`
          );
        }
      }
    }

    for (const { label, role } of roles) {
      const has = await vault.hasRole(role, to);
      console.log(`[corevault][check] ${label} currently ${has ? "✅" : "❌"}`);
      if (!has) {
        if (dryRun) {
          console.log(`[corevault][dry-run] would grant ${label}`);
          continue;
        }
        const tx = await vault.grantRole(role, to);
        console.log(`[corevault][tx] grant ${label} hash ${tx.hash}`);
        await tx.wait();
        console.log(`[corevault][tx] ${label} mined`);
      }
    }
  } else {
    console.log("[corevault] skipped");
  }
}

main().catch((e) => {
  console.error("setup-access-control failed:", e?.stack || e?.message || String(e));
  process.exit(1);
});


