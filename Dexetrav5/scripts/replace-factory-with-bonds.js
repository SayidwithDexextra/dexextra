/* eslint-disable no-console */
// Replace FuturesMarketFactory with bonded version (one-shot cutover).
//
// This script:
//  1) Deploys a NEW FuturesMarketFactory pointing at an EXISTING CoreVault
//  2) Grants CoreVault FACTORY_ROLE + SETTLEMENT_ROLE to the NEW factory
//  3) Deploys MarketBondManager (separately)
//  4) Grants CoreVault FACTORY_ROLE to MarketBondManager (so it can call CoreVault.deductFees)
//  5) Wires the bond manager into the factory via factory.setBondManager(...)
//  6) Configures bond + penalty on MarketBondManager
//  7) (Optional) Revokes roles from OLD factory address
//
// Run:
//   CORE_VAULT_ADDRESS=0x... \
//   npx hardhat run scripts/replace-factory-with-bonds.js --network <network>
//
// Required env:
//   CORE_VAULT_ADDRESS
//
// Optional env (factory):
//   FACTORY_ADMIN_ADDRESS        (default: signer running this script)
//   FACTORY_FEE_RECIPIENT        (default: FACTORY_ADMIN_ADDRESS)
//
// Optional env (bond manager):
//   MARKET_BOND_DEFAULT_AMOUNT   (default: 100000000 = 100 USDC, 6 decimals)
//   MARKET_BOND_MIN_AMOUNT       (default: 1000000 = 1 USDC)
//   MARKET_BOND_MAX_AMOUNT       (default: 0 = no max)
//   MARKET_BOND_PENALTY_BPS      (default: 0; 200 = 2%)
//   MARKET_BOND_PENALTY_RECIPIENT (default: FACTORY_FEE_RECIPIENT)
//   MARKET_BOND_MANAGER_OWNER    (default: FACTORY_ADMIN_ADDRESS)
//
// IMPORTANT: the signer running this script MUST have DEFAULT_ADMIN_ROLE on CoreVault.
// REQUIRED for role grants:
//   ADMIN_PRIVATE_KEY (must be a CoreVault DEFAULT_ADMIN_ROLE holder)

const path = require("path");
try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
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

function envBool(name, fallback = false) {
  const raw = process.env[name];
  if (raw == null || String(raw).trim() === "") return fallback;
  const s = String(raw).trim().toLowerCase();
  return s === "1" || s === "true" || s === "yes" || s === "y";
}

function envUInt(name, fallback) {
  const raw = process.env[name];
  const v = raw == null || String(raw).trim() === "" ? fallback : String(raw).trim();
  if (!String(v).match(/^\d+$/)) throw new Error(`Invalid ${name} (expected integer): ${v}`);
  return BigInt(v);
}

async function main() {
  console.log("--- Replace Factory with Bonds ---");

  const coreVaultAddress = envAddr("CORE_VAULT_ADDRESS");
  if (!coreVaultAddress) throw new Error("CORE_VAULT_ADDRESS is required");

  const adminPk = required("ADMIN_PRIVATE_KEY");
  if (!String(adminPk).match(/^0x[0-9a-fA-F]{64}$/)) {
    throw new Error("ADMIN_PRIVATE_KEY must be a 0x-prefixed 32-byte hex private key");
  }
  const roleGranter = new ethers.Wallet(adminPk, ethers.provider);
  const roleGranterAddress = await roleGranter.getAddress();

  const factoryAdmin = envAddr("FACTORY_ADMIN_ADDRESS", roleGranterAddress);
  const feeRecipient = envAddr("FACTORY_FEE_RECIPIENT", factoryAdmin);

  console.log("Network:", process.env.HARDHAT_NETWORK || "unknown");
  console.log("Role granter (tx sender):", roleGranterAddress);
  console.log("CoreVault:", coreVaultAddress);
  console.log("Factory admin:", factoryAdmin);
  console.log("Factory feeRecipient:", feeRecipient);

  // Attach vault
  const vault = await ethers.getContractAt("CoreVault", coreVaultAddress, roleGranter);
  const DEFAULT_ADMIN_ROLE = await vault.DEFAULT_ADMIN_ROLE();
  const hasAdmin = await vault.hasRole(DEFAULT_ADMIN_ROLE, roleGranterAddress);
  if (!hasAdmin) {
    throw new Error(
      `Signer ${roleGranterAddress} does NOT have CoreVault.DEFAULT_ADMIN_ROLE. Use the CoreVault admin wallet.`
    );
  }
  console.log("✅ Signer has CoreVault.DEFAULT_ADMIN_ROLE");

  // Deploy new factory
  console.log("\n1) Deploying NEW FuturesMarketFactory...");
  const Factory = await ethers.getContractFactory("FuturesMarketFactory", roleGranter);
  const factory = await Factory.deploy(coreVaultAddress, factoryAdmin, feeRecipient);
  try {
    const depTx = factory.deploymentTransaction?.() || factory.deploymentTransaction || null;
    if (depTx?.hash) console.log("→ factory deploy tx:", depTx.hash);
  } catch {}
  await factory.waitForDeployment();
  const newFactoryAddress = await factory.getAddress();
  console.log("✅ NEW FuturesMarketFactory:", newFactoryAddress);

  // Grant roles to new factory
  console.log("\n2) Granting CoreVault roles to NEW factory...");
  const FACTORY_ROLE = await vault.FACTORY_ROLE();
  const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();

  const tx1 = await vault.grantRole(FACTORY_ROLE, newFactoryAddress);
  console.log("→ grantRole(FACTORY_ROLE, newFactory) tx:", tx1.hash);
  await tx1.wait();

  const tx2 = await vault.grantRole(SETTLEMENT_ROLE, newFactoryAddress);
  console.log("→ grantRole(SETTLEMENT_ROLE, newFactory) tx:", tx2.hash);
  await tx2.wait();

  // Deploy bond manager
  console.log("\n3) Deploying MarketBondManager...");
  const bondDefault = envUInt("MARKET_BOND_DEFAULT_AMOUNT", "100000000");
  const bondMin = envUInt("MARKET_BOND_MIN_AMOUNT", "1000000");
  const bondMax = envUInt("MARKET_BOND_MAX_AMOUNT", "0");
  const penaltyBps = Number(String(process.env.MARKET_BOND_PENALTY_BPS || "0").trim() || "0");
  if (!Number.isFinite(penaltyBps) || penaltyBps < 0 || penaltyBps > 10000) {
    throw new Error("Invalid MARKET_BOND_PENALTY_BPS (expected 0..10000)");
  }
  const penaltyRecipient = envAddr("MARKET_BOND_PENALTY_RECIPIENT", feeRecipient);
  const finalBondOwner = envAddr("MARKET_BOND_MANAGER_OWNER", factoryAdmin);

  console.log("Bond default (6d):", bondDefault.toString());
  console.log("Bond min (6d):", bondMin.toString());
  console.log("Bond max (6d):", bondMax.toString());
  console.log("Bond penalty bps:", penaltyBps);
  console.log("Bond penalty recipient:", penaltyRecipient);
  console.log("Bond manager final owner:", finalBondOwner);

  const BondMgr = await ethers.getContractFactory("MarketBondManager", roleGranter);
  const bondMgr = await BondMgr.deploy(
    coreVaultAddress,
    newFactoryAddress,
    roleGranterAddress, // temporary owner to configure
    bondDefault,
    bondMin,
    bondMax
  );
  try {
    const depTx = bondMgr.deploymentTransaction?.() || bondMgr.deploymentTransaction || null;
    if (depTx?.hash) console.log("→ bond manager deploy tx:", depTx.hash);
  } catch {}
  await bondMgr.waitForDeployment();
  const bondMgrAddress = await bondMgr.getAddress();
  console.log("✅ MarketBondManager:", bondMgrAddress);

  // Grant FACTORY_ROLE to bond manager so it can call CoreVault.deductFees(...)
  console.log("\n4) Granting CoreVault FACTORY_ROLE to MarketBondManager...");
  const tx3 = await vault.grantRole(FACTORY_ROLE, bondMgrAddress);
  console.log("→ grantRole(FACTORY_ROLE, bondMgr) tx:", tx3.hash);
  await tx3.wait();

  // Wire manager into factory
  console.log("\n5) Wiring bond manager into factory...");
  const tx4 = await factory.setBondManager(bondMgrAddress);
  console.log("→ factory.setBondManager tx:", tx4.hash);
  await tx4.wait();
  console.log("✅ Factory wired (bondManager set)");

  // Configure penalty (and set recipient even if bps=0 for clarity)
  console.log("\n6) Configuring bond penalty...");
  const tx5 = await bondMgr.setPenaltyConfig(penaltyBps, penaltyRecipient);
  console.log("→ bondMgr.setPenaltyConfig tx:", tx5.hash);
  await tx5.wait();

  // Ensure bond config is set as desired (constructor already does this, but keep explicit)
  console.log("\n7) Confirming bond config...");
  const tx6 = await bondMgr.setBondConfig(bondDefault, bondMin, bondMax);
  console.log("→ bondMgr.setBondConfig tx:", tx6.hash);
  await tx6.wait();

  // Transfer ownership to final owner if needed
  if (finalBondOwner && finalBondOwner !== roleGranterAddress) {
    console.log("\n8) Transferring MarketBondManager ownership...");
    const tx7 = await bondMgr.setOwner(finalBondOwner);
    console.log("→ bondMgr.setOwner tx:", tx7.hash);
    await tx7.wait();
  }

  console.log("\n--- Cutover complete ---\n");
  console.log("Deployment summary (newly created contracts):");
  console.log("  CORE_VAULT:", coreVaultAddress);
  console.log("  NEW_FACTORY_ADDRESS:", newFactoryAddress);
  console.log("  MARKET_BOND_MANAGER_ADDRESS:", bondMgrAddress);
  console.log("\nConfiguration summary:");
  console.log("  role_granter (tx sender):", roleGranterAddress);
  console.log("  factoryAdmin:", factoryAdmin);
  console.log("  feeRecipient:", feeRecipient);
  console.log("  bondDefault(6d):", bondDefault.toString());
  console.log("  bondMin(6d):", bondMin.toString());
  console.log("  bondMax(6d):", bondMax.toString());
  console.log("  penaltyBps:", penaltyBps);
  console.log("  penaltyRecipient:", penaltyRecipient);
  console.log("  bondManagerFinalOwner:", finalBondOwner);
  console.log("");

  console.log("Export these env vars:");
  console.log(`FUTURES_MARKET_FACTORY_ADDRESS=${newFactoryAddress}`);
  console.log(`NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${newFactoryAddress}`);
  console.log(`MARKET_BOND_MANAGER_ADDRESS=${bondMgrAddress}`);
  console.log("\nNext steps:");
  console.log("- Sync ABI: node scripts/sync-factory-abi.js");
  console.log("- Redeploy/restart your server + frontend with updated env vars");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

