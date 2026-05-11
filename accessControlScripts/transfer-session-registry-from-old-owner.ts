#!/usr/bin/env tsx
/**
 * One-shot rotate-the-old-owner script for GlobalSessionRegistry.
 *
 * USE WHEN the current on-chain `owner()` of GlobalSessionRegistry is a wallet
 * you no longer want to use (e.g. flagged in `relayers.generated.v2.json`'s
 * `_compromised_do_not_use`) and you want to fund that wallet *just enough* to
 * send a single `transferOwnership(newOwner)` tx, then never touch it again.
 *
 * SECURITY (per .cursor/rules/no-private-keys.mdc):
 *   - The old owner's private key is read from env, NEVER hardcoded.
 *   - Pass it on the command line:
 *
 *       OLD_REGISTRY_OWNER_PRIVATE_KEY=0x... \
 *         npx --no-install tsx \
 *         accessControlScripts/transfer-session-registry-from-old-owner.ts \
 *         --wait-for-funds
 *
 *   - The private key is never logged.
 *
 * Defaults (all overridable):
 *   - Registry      : SESSION_REGISTRY_ADDRESS / NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS
 *   - RPC           : RPC_URL (or RPC_URL_HYPEREVM / HYPERLIQUID_RPC_URL)
 *   - New owner     : derived from ADMIN_PRIVATE_KEY in .env.local
 *                     (override with --new-owner 0x...)
 *
 * Flags:
 *   --new-owner 0x...     Override new owner address.
 *   --registry 0x...      Override registry address.
 *   --wait-for-funds      Poll old-owner balance until sufficient, then send.
 *   --poll-ms 5000        Poll interval when waiting for funds (default 5s).
 *   --timeout-ms 600000   Give up waiting after N ms (default 10 min).
 *   --gas-buffer 130      Gas estimate buffer percent (default 130 → +30%).
 *   --dry-run             Print plan only; never send.
 *
 * Typical flow:
 *   1. Run with --dry-run to see exactly how much native gas to send.
 *   2. Send that amount (+ small buffer) to the old owner from any wallet.
 *   3. Re-run with --wait-for-funds (no --dry-run) — script sends the tx
 *      as soon as the balance crosses the threshold.
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

function isPrivateKey(v: string | undefined): v is string {
  return !!v && /^0x[a-fA-F0-9]{64}$/.test(v.trim());
}

function pickFirstEnv(...names: string[]): string | undefined {
  for (const n of names) {
    const v = process.env[n];
    if (v) return v;
  }
  return undefined;
}

async function resolveNewOwner(): Promise<string> {
  const override = getArg("--new-owner");
  if (override) {
    if (!ethers.isAddress(override)) throw new Error("--new-owner is not a valid address");
    return ethers.getAddress(override);
  }
  const adminPk = process.env.ADMIN_PRIVATE_KEY;
  if (!isPrivateKey(adminPk)) {
    throw new Error(
      "Cannot derive new owner: ADMIN_PRIVATE_KEY missing/invalid. Pass --new-owner 0x... instead."
    );
  }
  return new ethers.Wallet(adminPk).address;
}

function fmtNative(wei: bigint): string {
  return `${ethers.formatEther(wei)} (native)`;
}

async function main() {
  loadEnv();

  const oldOwnerPk = process.env.OLD_REGISTRY_OWNER_PRIVATE_KEY;
  if (!isPrivateKey(oldOwnerPk)) {
    throw new Error(
      "OLD_REGISTRY_OWNER_PRIVATE_KEY must be set on the command line, e.g.\n" +
        "  OLD_REGISTRY_OWNER_PRIVATE_KEY=0x... npx tsx accessControlScripts/transfer-session-registry-from-old-owner.ts --wait-for-funds"
    );
  }

  const rpcUrl =
    pickFirstEnv("RPC_URL", "NEXT_PUBLIC_RPC_URL", "RPC_URL_HYPEREVM", "HYPERLIQUID_RPC_URL");
  if (!rpcUrl) throw new Error("RPC_URL is required");

  const registryAddress =
    getArg("--registry") ||
    pickFirstEnv("SESSION_REGISTRY_ADDRESS", "NEXT_PUBLIC_SESSION_REGISTRY_ADDRESS");
  if (!registryAddress || !ethers.isAddress(registryAddress)) {
    throw new Error("SESSION_REGISTRY_ADDRESS (or --registry) is required");
  }

  const newOwner = await resolveNewOwner();

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const signer = new ethers.Wallet(oldOwnerPk, provider);
  const signerAddress = await signer.getAddress();

  const registry = new ethers.Contract(
    ethers.getAddress(registryAddress),
    [
      "function owner() view returns (address)",
      "function transferOwnership(address newOwner) external",
    ],
    signer
  );

  const onchainOwner: string = await registry.owner();

  console.log("[rotate] registry        ", ethers.getAddress(registryAddress));
  console.log("[rotate] onchain owner   ", onchainOwner);
  console.log("[rotate] signer (old)    ", signerAddress, "(from OLD_REGISTRY_OWNER_PRIVATE_KEY)");
  console.log("[rotate] new owner       ", newOwner);

  if (onchainOwner.toLowerCase() !== signerAddress.toLowerCase()) {
    throw new Error(
      `OLD_REGISTRY_OWNER_PRIVATE_KEY (=${signerAddress}) does not match on-chain owner (=${onchainOwner}). ` +
        `Aborting before sending a tx that would revert.`
    );
  }
  if (onchainOwner.toLowerCase() === newOwner.toLowerCase()) {
    console.log("[rotate] already owned by new owner; nothing to do.");
    return;
  }

  const gasBufferPct = BigInt(getArg("--gas-buffer") || "130");
  let estimated: bigint;
  try {
    estimated = await registry.transferOwnership.estimateGas(newOwner);
  } catch (e: any) {
    throw new Error(`gas estimation failed: ${e?.shortMessage || e?.message || String(e)}`);
  }
  const gasLimit = (estimated * gasBufferPct) / 100n;

  const fee = await provider.getFeeData();
  const gasPrice =
    fee.maxFeePerGas ?? fee.gasPrice ?? ethers.parseUnits("1", "gwei");
  const required = gasLimit * gasPrice;

  console.log("[rotate] estimated gas   ", estimated.toString());
  console.log("[rotate] gasLimit (+buf) ", gasLimit.toString(), `(${gasBufferPct}%)`);
  console.log(
    "[rotate] gas price       ",
    fee.maxFeePerGas
      ? `EIP-1559 maxFeePerGas=${ethers.formatUnits(fee.maxFeePerGas, "gwei")} gwei`
      : `legacy gasPrice=${ethers.formatUnits(gasPrice, "gwei")} gwei`
  );
  console.log("[rotate] FUND with at least", fmtNative(required), "→", signerAddress);

  if (hasFlag("--dry-run")) {
    console.log("[rotate] dry-run — exiting without sending.");
    return;
  }

  const pollMs = Math.max(1000, Number(getArg("--poll-ms") || "5000"));
  const timeoutMs = Math.max(pollMs, Number(getArg("--timeout-ms") || "600000"));
  const waitForFunds = hasFlag("--wait-for-funds");

  const start = Date.now();
  while (true) {
    const bal = await provider.getBalance(signerAddress);
    if (bal >= required) {
      console.log("[rotate] balance OK      ", fmtNative(bal), "≥ required", fmtNative(required));
      break;
    }
    const shortBy = required - bal;
    if (!waitForFunds) {
      throw new Error(
        `Insufficient balance: have ${fmtNative(bal)}, need ${fmtNative(required)} ` +
          `(short by ${fmtNative(shortBy)}). Fund ${signerAddress} or rerun with --wait-for-funds.`
      );
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `Timed out after ${Math.round((Date.now() - start) / 1000)}s waiting for funds. ` +
          `Last balance ${fmtNative(bal)}, need ${fmtNative(required)}.`
      );
    }
    process.stdout.write(
      `[rotate] waiting for funds… balance=${ethers.formatEther(bal)} need=${ethers.formatEther(required)} ` +
        `(short ${ethers.formatEther(shortBy)})\r`
    );
    await new Promise((r) => setTimeout(r, pollMs));
  }
  process.stdout.write("\n");

  const tx = await registry.transferOwnership(newOwner, { gasLimit });
  console.log("[rotate] tx sent         ", tx.hash);
  const rc = await tx.wait();
  console.log("[rotate] mined           ", {
    blockNumber: rc?.blockNumber,
    gasUsed: rc?.gasUsed?.toString?.(),
  });

  const ownerAfter: string = await registry.owner();
  console.log("[rotate] owner after     ", ownerAfter);
  if (ownerAfter.toLowerCase() !== newOwner.toLowerCase()) {
    throw new Error(
      `Post-tx owner mismatch: expected ${newOwner}, got ${ownerAfter}. Investigate before relying on this.`
    );
  }
  console.log("[rotate] ✅ ownership transferred successfully");
}

main().catch((e) => {
  console.error("transfer-session-registry-from-old-owner failed:", e?.stack || e?.message || String(e));
  process.exit(1);
});
