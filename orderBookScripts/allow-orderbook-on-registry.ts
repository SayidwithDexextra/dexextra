#!/usr/bin/env tsx
/**
 * Whitelist an OrderBook or CoreVault (any caller of `chargeSession`) on the
 * GlobalSessionRegistry by sending:
 *
 *   setAllowedOrderbook(target, true)
 *
 * Target resolution (in order):
 *   --orderbook 0x...          explicit target
 *   --vault                    resolve target = process.env.CORE_VAULT_ADDRESS
 *
 * Registry resolution (in order):
 *   --registry 0x...           explicit registry
 *   --from-vault               read CoreVault.sessionRegistry() on-chain and
 *                              use that (most reliable — this is the registry
 *                              the vault will actually call). Uses
 *                              CORE_VAULT_ADDRESS env.
 *   SESSION_REGISTRY_ADDRESS env
 *
 * Signer resolution: scans a list of well-known PRIVATE_KEY-named env vars and
 * picks the one whose derived address matches `registry.owner()`. No keys are
 * ever embedded in this file. Set `--dry-run` to preview without sending.
 *
 * Examples:
 *   # Whitelist the CoreVault on the registry it actually points at:
 *   npx tsx orderBookScripts/allow-orderbook-on-registry.ts --vault --from-vault
 *
 *   # Or pass everything explicitly:
 *   npx tsx orderBookScripts/allow-orderbook-on-registry.ts \
 *     --orderbook 0x13C0EE284eF74E10A6442077718D57e2C50Ee88F \
 *     --registry  0xC547B198aFECd6BA4B30d639a045DB3cD30d8EF9
 */
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { ethers } from 'ethers';

function loadEnv() {
  const root = process.cwd();
  const envLocalPath = path.join(root, '.env.local');
  if (fs.existsSync(envLocalPath)) {
    dotenv.config({ path: envLocalPath });
  } else {
    dotenv.config();
  }
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

function isPrivateKey(v: string | undefined): v is string {
  if (!v) return false;
  const t = v.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(t) || /^[a-fA-F0-9]{64}$/.test(t);
}

function normalizePk(raw: string): string {
  const t = raw.trim();
  return t.startsWith('0x') ? t : `0x${t}`;
}

async function findOwnerSigner(
  provider: ethers.Provider,
  registry: string,
): Promise<{ owner: string; signer: ethers.Wallet; envName: string }> {
  const ro = new ethers.Contract(
    ethers.getAddress(registry),
    ['function owner() view returns (address)'],
    provider,
  );
  const owner = (await ro.owner()).toLowerCase();

  // Scan ALL env vars whose name matches PRIVATE_KEY and try each. This lets
  // the script work regardless of which named variable on a given machine
  // happens to hold the registry-owner key.
  const skip = (k: string) => /_JSON$/.test(k) || /PUBLIC_KEY/.test(k);
  const candidateNames = Object.keys(process.env).filter(
    (k) => /PRIVATE_KEY/.test(k) && !skip(k),
  );

  const tried: { envName: string; address: string }[] = [];
  for (const name of candidateNames) {
    const raw = process.env[name];
    if (!isPrivateKey(raw)) continue;
    const pk = normalizePk(raw!);
    let wallet: ethers.Wallet;
    try {
      wallet = new ethers.Wallet(pk, provider);
    } catch {
      continue;
    }
    const addr = (await wallet.getAddress()).toLowerCase();
    tried.push({ envName: name, address: addr });
    if (addr === owner) {
      return { owner, signer: wallet, envName: name };
    }
  }

  throw new Error(
    `No configured private key matches registry owner.\n` +
      `  registry=${registry}\n` +
      `  owner=${owner}\n` +
      `  scanned=${tried.map((t) => `${t.envName}->${t.address}`).join(', ')}`,
  );
}

async function main() {
  loadEnv();
  const argv = process.argv.slice(2);

  const rpcUrl =
    process.env.RPC_URL ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.HYPERLIQUID_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL;
  if (!rpcUrl) throw new Error('RPC_URL (or RPC_URL_HYPEREVM / HYPERLIQUID_RPC_URL) is required');
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  const useVault = hasFlag(argv, '--vault');
  const orderBookInput = getFlag(argv, '--orderbook', '-o') || (useVault ? process.env.CORE_VAULT_ADDRESS : undefined);
  if (!orderBookInput || !ethers.isAddress(orderBookInput)) {
    console.error('Usage: tsx orderBookScripts/allow-orderbook-on-registry.ts (--orderbook 0x... | --vault) [--registry 0x... | --from-vault] [--dry-run]');
    console.error('Error: missing/invalid target address (pass --orderbook 0x... or set CORE_VAULT_ADDRESS and use --vault)');
    process.exit(1);
  }
  const target = ethers.getAddress(orderBookInput);

  let registryAddress: string;
  const registryFlag = getFlag(argv, '--registry', '-r');
  const fromVault = hasFlag(argv, '--from-vault');
  if (registryFlag && ethers.isAddress(registryFlag)) {
    registryAddress = ethers.getAddress(registryFlag);
  } else if (fromVault) {
    const vaultAddr = ethers.getAddress(process.env.CORE_VAULT_ADDRESS || '');
    const vault = new ethers.Contract(
      vaultAddr,
      ['function sessionRegistry() view returns (address)'],
      provider,
    );
    const reg = await vault.sessionRegistry();
    if (!ethers.isAddress(reg) || reg === ethers.ZeroAddress) {
      throw new Error(`CoreVault ${vaultAddr} has no sessionRegistry set`);
    }
    registryAddress = ethers.getAddress(reg);
  } else if (process.env.SESSION_REGISTRY_ADDRESS && ethers.isAddress(process.env.SESSION_REGISTRY_ADDRESS)) {
    registryAddress = ethers.getAddress(process.env.SESSION_REGISTRY_ADDRESS);
  } else {
    throw new Error('Provide --registry, --from-vault, or set SESSION_REGISTRY_ADDRESS');
  }

  const REGISTRY_ABI = [
    'function owner() view returns (address)',
    'function allowedOrderbook(address) view returns (bool)',
    'function setAllowedOrderbook(address,bool) external',
  ];

  const picked = await findOwnerSigner(provider, registryAddress);
  const registry = new ethers.Contract(registryAddress, REGISTRY_ABI, picked.signer);

  const signerAddress = await picked.signer.getAddress();
  const owner = await registry.owner();

  const isAllowed: boolean = await registry.allowedOrderbook(target);
  console.log('[allow-orderbook]', {
    registry: registryAddress,
    target,
    isAllowed,
    owner,
    signer: signerAddress,
    signerEnv: picked.envName,
  });

  if (isAllowed) {
    console.log('[allow-orderbook] Already allowed. Nothing to do.');
    return;
  }
  if (hasFlag(argv, '--dry-run')) {
    console.log('[allow-orderbook] dry-run enabled; not sending tx.');
    return;
  }

  const tx = await registry.setAllowedOrderbook(target, true);
  console.log('[allow-orderbook] setAllowedOrderbook tx', tx.hash);
  const rc = await tx.wait();
  console.log('[allow-orderbook] mined', {
    blockNumber: rc?.blockNumber,
    gasUsed: rc?.gasUsed?.toString?.(),
  });

  const after: boolean = await registry.allowedOrderbook(target);
  console.log('[allow-orderbook] allowedOrderbook(target) after =', after);
}

main().catch((e) => {
  console.error('allow-orderbook-on-registry failed:', e?.stack || e?.message || String(e));
  process.exit(1);
});
