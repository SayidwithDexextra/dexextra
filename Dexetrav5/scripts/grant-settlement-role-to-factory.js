#!/usr/bin/env node
/**
 * Grants CoreVault SETTLEMENT_ROLE to FuturesMarketFactory so create / metaCreate
 * can call updateMarkPrice (see AccessControlUnauthorizedAccount otherwise).
 *
 * Env: RPC_URL (or NEXT_PUBLIC_RPC_URL), CORE_VAULT_ADDRESS (or NEXT_PUBLIC_CORE_VAULT_ADDRESS),
 *      FUTURES_MARKET_FACTORY_ADDRESS (or NEXT_PUBLIC_*).
 * Admin: a key in env that holds DEFAULT_ADMIN_ROLE on the vault (same candidates as grant-admin-to-relayers.js).
 */
const { ethers } = require("ethers");
const path = require("path");

try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}

const CORE_VAULT_ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
];

const DEFAULT_ADMIN_ROLE = ethers.ZeroHash;
const SETTLEMENT_ROLE = ethers.keccak256(ethers.toUtf8Bytes("SETTLEMENT_ROLE"));

async function findAdminWallet(provider, vault) {
  const adminCandidates = [
    process.env.PRIVATE_KEY,
    process.env.ADMIN_PRIVATE_KEY,
    process.env.ADMIN_PRIVATE_KEY_2,
    process.env.ADMIN_PRIVATE_KEY_3,
    process.env.ADMIN_PRIVATE_KEY_4,
    process.env.SETTLEMENT_PRIVATE_KEY,
    process.env.SECOND_PRIVATE_KEY,
  ].filter(Boolean);

  for (const pk of adminCandidates) {
    try {
      const normalized = pk.startsWith("0x") ? pk : `0x${pk}`;
      const w = new ethers.Wallet(normalized, provider);
      if (await vault.hasRole(DEFAULT_ADMIN_ROLE, w.address)) return w;
    } catch (_) {}
  }
  return null;
}

async function main() {
  const rpc =
    process.env.RPC_URL ||
    process.env.JSON_RPC_URL ||
    process.env.ALCHEMY_RPC_URL ||
    process.env.NEXT_PUBLIC_RPC_URL;
  const coreVaultAddr =
    process.env.CORE_VAULT_ADDRESS || process.env.NEXT_PUBLIC_CORE_VAULT_ADDRESS;
  const factoryAddr =
    process.env.FUTURES_MARKET_FACTORY_ADDRESS ||
    process.env.NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS;

  if (!rpc) throw new Error("Missing RPC_URL (or JSON_RPC_URL / ALCHEMY_RPC_URL / NEXT_PUBLIC_RPC_URL)");
  if (!coreVaultAddr) throw new Error("Missing CORE_VAULT_ADDRESS or NEXT_PUBLIC_CORE_VAULT_ADDRESS");
  if (!factoryAddr) throw new Error("Missing FUTURES_MARKET_FACTORY_ADDRESS or NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS");

  const provider = new ethers.JsonRpcProvider(rpc);
  const net = await provider.getNetwork();
  console.log(`Chain ${net.chainId}`);
  console.log(`CoreVault: ${coreVaultAddr}`);
  console.log(`Factory:   ${factoryAddr}`);

  const vault = new ethers.Contract(coreVaultAddr, CORE_VAULT_ABI, provider);

  const already = await vault.hasRole(SETTLEMENT_ROLE, factoryAddr);
  if (already) {
    console.log("\n✅ FuturesMarketFactory already has SETTLEMENT_ROLE on CoreVault. Nothing to do.");
    return;
  }

  const admin = await findAdminWallet(provider, vault);
  if (!admin) {
    throw new Error(
      "No env private key has DEFAULT_ADMIN_ROLE on CoreVault. Set ADMIN_PRIVATE_KEY (or another admin key from grant-admin-to-relayers.js list).",
    );
  }

  console.log(`\nAdmin signer: ${admin.address}`);
  const dry = String(process.env.DRY_RUN || "").toLowerCase() === "1" || process.env.DRY_RUN === "true";
  if (dry) {
    console.log("DRY_RUN=1 — would call grantRole(SETTLEMENT_ROLE, factory)");
    return;
  }

  const vaultS = vault.connect(admin);
  console.log("Sending grantRole(SETTLEMENT_ROLE, factory)…");
  const tx = await vaultS.grantRole(SETTLEMENT_ROLE, factoryAddr);
  const receipt = await tx.wait();
  console.log(`✅ Mined: ${receipt.hash}`);

  const ok = await vault.hasRole(SETTLEMENT_ROLE, factoryAddr);
  if (!ok) throw new Error("grantRole tx succeeded but hasRole still false");
  console.log("✅ Verified: factory has SETTLEMENT_ROLE");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
