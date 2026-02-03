// Deploy MarketBondManager and wire it into an existing FuturesMarketFactory + CoreVault.
//
// Env (repo root .env.local / .env):
// - CORE_VAULT_ADDRESS (required)
// - FUTURES_MARKET_FACTORY_ADDRESS (required)
// - BOND_MANAGER_OWNER (optional; defaults to deployer)
// - DEFAULT_BOND_AMOUNT (optional; defaults to 100e6)
// - MIN_BOND_AMOUNT (optional; defaults to 1e6)
// - MAX_BOND_AMOUNT (optional; defaults to 0 = no max)
//
// This script also grants CoreVault FACTORY_ROLE to the bond manager so it can
// call `deductFees` for bond posting/refunds.

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
  if (!v || !v.trim()) throw new Error(`Missing env ${name}`);
  return v.trim();
}

function numEnv(name, fallback) {
  const raw = process.env[name];
  if (!raw || !raw.trim()) return fallback;
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid numeric env ${name}`);
  return n;
}

async function main() {
  console.log("--- Deploy MarketBondManager ---");

  const coreVaultAddress = required("CORE_VAULT_ADDRESS");
  const factoryAddress = required("FUTURES_MARKET_FACTORY_ADDRESS");

  const [deployer] = await ethers.getSigners();
  const owner = process.env.BOND_MANAGER_OWNER?.trim() || deployer.address;

  const defaultBond = BigInt(numEnv("DEFAULT_BOND_AMOUNT", 100_000_000)); // 100 USDC (6 decimals)
  const minBond = BigInt(numEnv("MIN_BOND_AMOUNT", 1_000_000)); // 1 USDC
  const maxBond = BigInt(numEnv("MAX_BOND_AMOUNT", 0)); // 0 = no max

  console.log("Deployer:", deployer.address);
  console.log("CoreVault:", coreVaultAddress);
  console.log("Factory:", factoryAddress);
  console.log("Bond manager owner:", owner);
  console.log("defaultBond:", defaultBond.toString());
  console.log("minBond:", minBond.toString());
  console.log("maxBond:", maxBond.toString());

  const Manager = await ethers.getContractFactory("MarketBondManager");
  const manager = await Manager.deploy(
    coreVaultAddress,
    factoryAddress,
    owner,
    defaultBond,
    minBond,
    maxBond
  );
  await manager.waitForDeployment();
  const managerAddress = await manager.getAddress();
  console.log("MarketBondManager deployed:", managerAddress);

  // Grant FACTORY_ROLE to manager so it can call CoreVault.deductFees(...)
  const vault = await ethers.getContractAt("CoreVault", coreVaultAddress);
  const FACTORY_ROLE =
    (await vault.FACTORY_ROLE?.()) ||
    ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const tx1 = await vault.grantRole(FACTORY_ROLE, managerAddress);
  console.log("grantRole(FACTORY_ROLE, manager) tx:", tx1.hash);
  await tx1.wait();

  // Wire manager into factory
  const factory = await ethers.getContractAt("FuturesMarketFactory", factoryAddress);
  const tx2 = await factory.setBondManager(managerAddress);
  console.log("factory.setBondManager tx:", tx2.hash);
  await tx2.wait();

  console.log("Done.");
  console.log("MarketBondManager:", managerAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

