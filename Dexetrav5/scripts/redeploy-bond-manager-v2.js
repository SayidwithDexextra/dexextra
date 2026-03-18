// Redeploy MarketBondManagerV2 with bond-exempt whitelist support.
//
// This script:
//  1) Reads the existing factory's bondManager and copies its config
//  2) Deploys a new MarketBondManagerV2
//  3) Grants CoreVault FACTORY_ROLE to the new bond manager
//  4) Updates the factory to point at the new bond manager
//  5) Calls setBondExempt for the admin/deployer wallet
//  6) Optionally imports bond state from the old manager
//
// Env (repo root .env.local / .env):
//   CORE_VAULT_ADDRESS             (required)
//   FUTURES_MARKET_FACTORY_ADDRESS (required)
//   ADMIN_PRIVATE_KEY              (required - must hold CoreVault DEFAULT_ADMIN_ROLE)
//   BOND_EXEMPT_ADDRESSES          (optional - comma-separated list of addresses to exempt)
//   SKIP_MIGRATION                 (optional - set "true" to skip importing bonds from old manager)
//
// Run:
//   npx hardhat run scripts/redeploy-bond-manager-v2.js --network hyperliquid

const path = require("path");
try {
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env.local") });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

const { ethers } = require("hardhat");

function required(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) throw new Error(`Missing env ${name}`);
  return String(v).trim();
}

function envAddr(name, fallback = null) {
  const v = process.env[name];
  if (!v || !String(v).trim()) return fallback;
  const s = String(v).trim();
  if (!ethers.isAddress(s)) throw new Error(`Invalid address env ${name}: ${s}`);
  return s;
}

async function main() {
  console.log("=== Redeploy MarketBondManagerV2 (with bond exemptions) ===\n");

  const coreVaultAddress = required("CORE_VAULT_ADDRESS");
  const factoryAddress = required("FUTURES_MARKET_FACTORY_ADDRESS");
  const adminPk = required("ADMIN_PRIVATE_KEY");

  if (!String(adminPk).match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error("ADMIN_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }

  const admin = new ethers.Wallet(adminPk, ethers.provider);
  const adminAddress = await admin.getAddress();

  console.log("Network:", process.env.HARDHAT_NETWORK || "unknown");
  console.log("Admin (tx sender):", adminAddress);
  console.log("CoreVault:", coreVaultAddress);
  console.log("Factory:", factoryAddress);

  // --- 1. Verify admin has CoreVault DEFAULT_ADMIN_ROLE ---
  const vault = await ethers.getContractAt("CoreVault", coreVaultAddress, admin);
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, adminAddress);
  if (!hasAdmin) {
    throw new Error(`${adminAddress} does NOT have CoreVault.DEFAULT_ADMIN_ROLE`);
  }
  console.log("✅ Admin has CoreVault.DEFAULT_ADMIN_ROLE\n");

  // --- 2. Read current factory config ---
  const factory = await ethers.getContractAt("FuturesMarketFactory", factoryAddress, admin);
  const oldBondManagerAddress = await factory.bondManager();
  const factoryAdmin = adminAddress; // factory.admin is internal; deployer is the admin
  console.log("Factory admin (deployer):", factoryAdmin);
  console.log("Old bond manager:", oldBondManagerAddress);

  // Read old bond manager config
  let oldDefaultBond = BigInt(100_000_000); // 100 USDC default
  let oldMinBond = BigInt(1_000_000);
  let oldMaxBond = BigInt(0);
  let oldPenaltyBps = 0;
  let oldPenaltyRecipient = adminAddress;

  if (oldBondManagerAddress && oldBondManagerAddress !== ethers.ZeroAddress) {
    try {
      const oldBm = await ethers.getContractAt("MarketBondManagerV2", oldBondManagerAddress, admin);
      oldDefaultBond = await oldBm.defaultBondAmount();
      oldMinBond = await oldBm.minBondAmount();
      oldMaxBond = await oldBm.maxBondAmount();
      oldPenaltyBps = Number(await oldBm.creationPenaltyBps());
      oldPenaltyRecipient = await oldBm.penaltyRecipient();
      console.log("  defaultBond:", oldDefaultBond.toString());
      console.log("  minBond:", oldMinBond.toString());
      console.log("  maxBond:", oldMaxBond.toString());
      console.log("  penaltyBps:", oldPenaltyBps);
      console.log("  penaltyRecipient:", oldPenaltyRecipient);
    } catch (e) {
      console.warn("⚠️  Could not read old bond manager config (using defaults):", e.message);
    }
  }

  // --- 3. Deploy new MarketBondManagerV2 ---
  console.log("\n1) Deploying NEW MarketBondManagerV2...");
  const BondMgr = await ethers.getContractFactory("MarketBondManagerV2", admin);
  const bondMgr = await BondMgr.deploy(
    coreVaultAddress,
    factoryAddress,
    adminAddress, // temporary owner (for configuration)
    oldDefaultBond,
    oldMinBond,
    oldMaxBond
  );
  try {
    const depTx = bondMgr.deploymentTransaction?.() || null;
    if (depTx?.hash) console.log("→ deploy tx:", depTx.hash);
  } catch {}
  await bondMgr.waitForDeployment();
  const newBondMgrAddress = await bondMgr.getAddress();
  console.log("✅ MarketBondManagerV2 deployed:", newBondMgrAddress);

  // --- 4. Configure penalty (preserve old config) ---
  if (oldPenaltyBps > 0 || oldPenaltyRecipient !== adminAddress) {
    console.log("\n2) Configuring penalty...");
    const tx = await bondMgr.setPenaltyConfig(oldPenaltyBps, oldPenaltyRecipient);
    console.log("→ setPenaltyConfig tx:", tx.hash);
    await tx.wait();
    console.log("✅ Penalty configured");
  } else {
    console.log("\n2) No penalty configured (bps=0), skipping.");
  }

  // --- 5. Grant CoreVault FACTORY_ROLE to new bond manager ---
  console.log("\n3) Granting CoreVault FACTORY_ROLE to new bond manager...");
  const FACTORY_ROLE = await vault.FACTORY_ROLE();
  const tx1 = await vault.grantRole(FACTORY_ROLE, newBondMgrAddress);
  console.log("→ grantRole tx:", tx1.hash);
  await tx1.wait();
  console.log("✅ FACTORY_ROLE granted");

  // --- 6. Update factory to use new bond manager ---
  console.log("\n4) Updating factory.setBondManager...");
  const tx2 = await factory.setBondManager(newBondMgrAddress);
  console.log("→ setBondManager tx:", tx2.hash);
  await tx2.wait();
  console.log("✅ Factory now uses new bond manager");

  // --- 7. Set bond exemptions ---
  console.log("\n5) Setting bond exemptions...");

  // Always exempt the admin/deployer
  const exemptAddresses = new Set([adminAddress.toLowerCase()]);

  // Also exempt the factory admin if different
  if (factoryAdmin && factoryAdmin !== ethers.ZeroAddress) {
    exemptAddresses.add(factoryAdmin.toLowerCase());
  }

  // Add any custom addresses from env
  const extraExempt = process.env.BOND_EXEMPT_ADDRESSES || "";
  if (extraExempt.trim()) {
    for (const raw of extraExempt.split(",")) {
      const addr = raw.trim();
      if (addr && ethers.isAddress(addr)) {
        exemptAddresses.add(addr.toLowerCase());
      } else if (addr) {
        console.warn(`⚠️  Skipping invalid address in BOND_EXEMPT_ADDRESSES: ${addr}`);
      }
    }
  }

  // Also exempt the CREATOR_PRIVATE_KEY wallet if set
  const creatorPk = process.env.CREATOR_PRIVATE_KEY;
  if (creatorPk) {
    try {
      const creatorAddr = new ethers.Wallet(creatorPk).address;
      exemptAddresses.add(creatorAddr.toLowerCase());
      console.log("  Adding CREATOR_PRIVATE_KEY wallet:", creatorAddr);
    } catch {}
  }

  for (const addr of exemptAddresses) {
    const checksummed = ethers.getAddress(addr);
    const tx = await bondMgr.setBondExempt(checksummed, true);
    console.log(`→ setBondExempt(${checksummed}, true) tx:`, tx.hash);
    await tx.wait();
  }
  console.log(`✅ ${exemptAddresses.size} address(es) exempted from bond`);

  // --- 8. Optionally transfer ownership ---
  const finalOwner = envAddr("BOND_MANAGER_OWNER", factoryAdmin);
  if (finalOwner && finalOwner.toLowerCase() !== adminAddress.toLowerCase()) {
    console.log("\n6) Transferring bond manager ownership to:", finalOwner);
    const tx = await bondMgr.setOwner(finalOwner);
    console.log("→ setOwner tx:", tx.hash);
    await tx.wait();
    console.log("✅ Ownership transferred");
  } else {
    console.log("\n6) Owner stays as admin, skipping transfer.");
  }

  // --- Summary ---
  console.log("\n=== Deployment Complete ===\n");
  console.log("Old bond manager:", oldBondManagerAddress);
  console.log("New bond manager:", newBondMgrAddress);
  console.log("Factory:", factoryAddress);
  console.log("CoreVault:", coreVaultAddress);
  console.log("Exempt addresses:", [...exemptAddresses].map(a => ethers.getAddress(a)).join(", "));
  console.log("");
  console.log("Env var to update:");
  console.log(`MARKET_BOND_MANAGER_ADDRESS=${newBondMgrAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
