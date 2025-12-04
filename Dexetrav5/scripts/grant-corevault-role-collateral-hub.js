/* eslint-disable no-console */
const { ethers, network } = require("hardhat");

async function main() {
  const [admin] = await ethers.getSigners();
  console.log(`\n🔐 Granting CoreVault role on ${network.name} with ${admin.address}`);

  const coreVault = process.env.CORE_VAULT_ADDRESS;
  const hub = process.env.COLLATERAL_HUB_ADDRESS;
  if (!coreVault || !hub) throw new Error("CORE_VAULT_ADDRESS and COLLATERAL_HUB_ADDRESS are required");

  const ORDERBOOK_ROLE = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  const EXTERNAL_CREDITOR_ROLE = ethers.keccak256(ethers.toUtf8Bytes("EXTERNAL_CREDITOR_ROLE"));
  const coreVaultContract = await ethers.getContractAt(
    [
      "function grantRole(bytes32,address)",
      "function hasRole(bytes32,address) view returns (bool)"
    ],
    coreVault
  );

  const already = await coreVaultContract.hasRole(ORDERBOOK_ROLE, hub);
  if (already) {
    console.log("ℹ️ CollateralHub already has ORDERBOOK_ROLE");
  }
  if (!already) {
    const tx = await coreVaultContract.grantRole(ORDERBOOK_ROLE, hub);
    const receipt = await tx.wait();
    console.log(`✅ Granted ORDERBOOK_ROLE to CollateralHub at ${hub} (tx ${receipt.hash})`);
  }

  const alreadyExt = await coreVaultContract.hasRole(EXTERNAL_CREDITOR_ROLE, hub);
  if (alreadyExt) {
    console.log("ℹ️ CollateralHub already has EXTERNAL_CREDITOR_ROLE");
  } else {
    const tx2 = await coreVaultContract.grantRole(EXTERNAL_CREDITOR_ROLE, hub);
    const receipt2 = await tx2.wait();
    console.log(`✅ Granted EXTERNAL_CREDITOR_ROLE to CollateralHub at ${hub} (tx ${receipt2.hash})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


