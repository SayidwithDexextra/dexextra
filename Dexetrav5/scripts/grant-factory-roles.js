/* eslint-disable no-console */
// Grants FACTORY_ROLE and SETTLEMENT_ROLE on CoreVault to a given factory address.
// Usage:
//   CORE_VAULT_ADDRESS=0x... FACTORY_ADDRESS=0x... npx hardhat run scripts/grant-factory-roles.js --network hyperliquid
// You may also set FACTORY_ROLE_TARGET to override the factory address for grants.

const { ethers } = require("hardhat");

async function main() {
  const coreVault = process.env.CORE_VAULT_ADDRESS;
  const factoryAddress =
    process.env.FACTORY_ROLE_TARGET ||
    process.env.FUTURES_MARKET_FACTORY_ADDRESS;

  if (!coreVault) throw new Error("CORE_VAULT_ADDRESS env var is required");
  if (!factoryAddress)
    throw new Error(
      "FUTURES_MARKET_FACTORY_ADDRESS or FACTORY_ROLE_TARGET env var is required"
    );

  const [signer] = await ethers.getSigners();
  console.log("Signer (must be CoreVault admin):", signer.address);
  console.log("CoreVault:", coreVault);
  console.log("Granting to factory:", factoryAddress);

  const core = await ethers.getContractAt("CoreVault", coreVault);
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );

  const grantRole = async (role, label) => {
    try {
      const tx = await core.grantRole(role, factoryAddress);
      console.log(`  • grant ${label} → tx:`, tx.hash);
      await tx.wait();
      console.log(`  ✅ ${label} granted`);
    } catch (e) {
      console.log(`  ⚠️ grant ${label} failed:`, e?.message || e);
    }
  };

  await grantRole(FACTORY_ROLE, "FACTORY_ROLE");
  await grantRole(SETTLEMENT_ROLE, "SETTLEMENT_ROLE");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

