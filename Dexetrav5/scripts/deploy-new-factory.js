// Deploy a new FuturesMarketFactory pointing at an existing CoreVault.
// - Uses CORE_VAULT_ADDRESS from env (my.env / .env.local / .env).
// - Grants FACTORY_ROLE and SETTLEMENT_ROLE on CoreVault to the new factory.
// - Defaults admin/feeRecipient to the deployer unless env overrides are provided.

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

async function main() {
  console.log("--- Deploy FuturesMarketFactory (gasless-enabled) ---");

  const coreVaultAddress = required("CORE_VAULT_ADDRESS");
  const [deployer] = await ethers.getSigners();
  const factoryAdmin =
    process.env.FACTORY_ADMIN_ADDRESS?.trim() || deployer.address;
  const factoryFeeRecipient =
    process.env.FACTORY_FEE_RECIPIENT?.trim() || deployer.address;

  console.log("Deployer:", deployer.address);
  console.log("CoreVault:", coreVaultAddress);
  console.log("Factory admin:", factoryAdmin);
  console.log("Factory feeRecipient:", factoryFeeRecipient);

  // Deploy factory
  const Factory = await ethers.getContractFactory("FuturesMarketFactory");
  const factory = await Factory.deploy(
    coreVaultAddress,
    factoryAdmin,
    factoryFeeRecipient
  );
  await factory.waitForDeployment();
  console.log("FuturesMarketFactory deployed:", factory.target);

  // Grant roles on CoreVault to the new factory
  const vault = await ethers.getContractAt("CoreVault", coreVaultAddress);
  const FACTORY_ROLE = await vault.FACTORY_ROLE();
  const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();

  const txs = [];
  txs.push(await vault.grantRole(FACTORY_ROLE, factory.target));
  txs.push(await vault.grantRole(SETTLEMENT_ROLE, factory.target));
  for (const tx of txs) {
    await tx.wait();
    console.log("Granted role tx:", tx.hash);
  }

  console.log("Done.");
  console.log("Factory:", factory.target);
  console.log("CoreVault:", coreVaultAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

