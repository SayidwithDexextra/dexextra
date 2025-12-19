#!/usr/bin/env tsx
/**
 * Transfer ownership of the GlobalSessionRegistry to a new owner.
 *
 * This script is designed for the common "rotate owner key" workflow:
 * - Signer (current owner) is derived from LEGACY_ADMIN_PRIVATE_KEY
 * - New owner address is derived from ADMIN_PRIVATE_KEY (no need to pass an address)
 *
 * Configuration is read from .env.local (project root), falling back to .env:
 *   - SESSION_REGISTRY_ADDRESS (required unless passed via --registry)
 *   - RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) (required)
 *   - One of the following MUST be set to sign as the current owner:
 *       - REGISTRY_OWNER_PRIVATE_KEY (preferred explicit)
 *       - RELAYER_PRIVATE_KEY (when relayer currently owns the registry)
 *       - ADMIN_PRIVATE_KEY (common after you rotate ownership to admin)
 *       - LEGACY_ADMIN (legacy name used elsewhere in this repo)
 *       - LEGACY_ADMIN_PRIVATE_KEY (compat)
 *   - New owner can be provided by:
 *       - --new-owner 0x...
 *       - DIAMOND_OWNER_ADDRESS (preferred default “admin/owner” address in this repo)
 *       - RELAYER_ADDRESS
 *       - ADMIN_PRIVATE_KEY (derived address fallback)
 *
 * Usage:
 *   npx --no-install tsx accessControlScripts/transfer-session-registry-ownership.ts
 *
 * Optional flags:
 *   --registry 0x...   Override SESSION_REGISTRY_ADDRESS
 *   --new-owner 0x...  Transfer ownership to this address (overrides RELAYER_ADDRESS)
 *   --dry-run          Only print what would happen; do not send a tx
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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

function getFlag(argv: string[], long: string, short?: string): string | undefined {
  const iLong = argv.indexOf(long);
  if (iLong >= 0) return argv[iLong + 1];
  if (short) {
    const iShort = argv.indexOf(short);
    if (iShort >= 0) return argv[iShort + 1];
  }
  return undefined;
}

function hasFlag(argv: string[], long: string, short?: string): boolean {
  if (argv.includes(long)) return true;
  if (short && argv.includes(short)) return true;
  return false;
}

function pickFirstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

function isPrivateKey(v: string | undefined): v is string {
  return !!v && /^0x[a-fA-F0-9]{64}$/.test(v.trim());
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
    "ADMIN_PRIVATE_KEY",
    "RELAYER_PRIVATE_KEY",
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

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);

  const rpcUrl =
    process.env.RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.NEXT_PUBLIC_RPC_URL_HYPEREVM ||
    process.env.HYPERLIQUID_RPC_URL;
  if (!rpcUrl) throw new Error("RPC_URL (or RPC_URL_HYPEREVM or HYPERLIQUID_RPC_URL) is required");

  const registryArg = getFlag(argv, "--registry", "-r");
  const registryAddress =
    registryArg ||
    pickFirstEnv("SESSION_REGISTRY_ADDRESS", "NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS") ||
    requireEnv("SESSION_REGISTRY_ADDRESS");
  if (!ethers.isAddress(registryAddress))
    throw new Error("SESSION_REGISTRY_ADDRESS (or --registry) is not a valid address");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const picked = await pickRegistryOwnerSigner(provider, registryAddress);
  const ownerSigner = picked.signer;

  const newOwnerArg = getFlag(argv, "--new-owner");
  const diamondOwnerAddress = process.env.DIAMOND_OWNER_ADDRESS;
  const relayerAddress = process.env.RELAYER_ADDRESS;
  const derivedFromAdminPk =
    process.env.ADMIN_PRIVATE_KEY && /^0x[a-fA-F0-9]{64}$/.test(process.env.ADMIN_PRIVATE_KEY)
      ? await new ethers.Wallet(process.env.ADMIN_PRIVATE_KEY).getAddress()
      : null;
  const newOwnerAddressRaw =
    (newOwnerArg && ethers.isAddress(newOwnerArg) ? newOwnerArg : null) ||
    (diamondOwnerAddress && ethers.isAddress(diamondOwnerAddress) ? diamondOwnerAddress : null) ||
    (relayerAddress && ethers.isAddress(relayerAddress) ? relayerAddress : null) ||
    derivedFromAdminPk;
  if (!newOwnerAddressRaw || !ethers.isAddress(newOwnerAddressRaw)) {
    throw new Error(
      "Missing new owner address. Provide --new-owner 0x..., or set DIAMOND_OWNER_ADDRESS / RELAYER_ADDRESS, or ensure ADMIN_PRIVATE_KEY is set so we can derive an address."
    );
  }

  const newOwnerAddress = ethers.getAddress(newOwnerAddressRaw);

  const registry = new ethers.Contract(
    ethers.getAddress(registryAddress),
    ["function owner() view returns (address)", "function transferOwnership(address newOwner) external"],
    ownerSigner
  );

  const signerAddress = await ownerSigner.getAddress();
  const owner = await registry.owner();

  console.log("[registry-ownership] registry", ethers.getAddress(registryAddress));
  console.log("[registry-ownership] current owner (on-chain)", owner);
  console.log("[registry-ownership] signer", signerAddress, `(from ${picked.signerEnv})`);
  console.log("[registry-ownership] new owner", newOwnerAddress);

  if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(`Signer is not current owner. owner=${owner}, signer=${signerAddress}`);
  }

  if (owner.toLowerCase() === newOwnerAddress.toLowerCase()) {
    console.log("[registry-ownership] Registry already owned by the new owner. Nothing to do.");
    return;
  }

  const dryRun = hasFlag(argv, "--dry-run");
  if (dryRun) {
    console.log("[registry-ownership] dry-run enabled; not sending tx.");
    return;
  }

  const tx = await registry.transferOwnership(newOwnerAddress);
  console.log("[registry-ownership] transferOwnership tx", tx.hash);
  const rc = await tx.wait();
  console.log("[registry-ownership] mined", {
    blockNumber: rc?.blockNumber,
    gasUsed: rc?.gasUsed?.toString?.(),
  });
  const ownerAfter = await registry.owner();
  console.log("[registry-ownership] owner after", ownerAfter);
}

main().catch((e) => {
  console.error("transfer-session-registry-ownership failed:", e?.stack || e?.message || String(e));
  process.exit(1);
});


