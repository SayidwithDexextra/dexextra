/* eslint-disable no-console */
const { ethers } = require("hardhat");

async function main() {
  console.log(
    "\n🚀 Deploying FuturesMarketFactory with EIP-712 meta-create enabled...\n"
  );

  // Read required env
  const coreVault = process.env.CORE_VAULT_ADDRESS;
  if (!coreVault) {
    throw new Error("CORE_VAULT_ADDRESS env var is required");
  }
  const adminEnv = process.env.FACTORY_ADMIN || null;
  const feeRecipientEnv = process.env.FACTORY_FEE_RECIPIENT || null;

  const [deployer] = await ethers.getSigners();
  console.log("Deployer:", deployer.address);

  const admin =
    adminEnv && ethers.isAddress(adminEnv) ? adminEnv : deployer.address;
  const feeRecipient =
    feeRecipientEnv && ethers.isAddress(feeRecipientEnv)
      ? feeRecipientEnv
      : admin;

  console.log("CoreVault:", coreVault);
  console.log("Admin:", admin);
  console.log("Fee Recipient:", feeRecipient);

  // Deploy
  const Factory = await ethers.getContractFactory("FuturesMarketFactory");
  const factory = await Factory.deploy(coreVault, admin, feeRecipient);
  const depTx =
    factory.deploymentTransaction?.() || factory.deploymentTransaction || null;
  if (depTx?.hash) {
    console.log("  • tx:", depTx.hash);
  }
  console.log("  • waiting for deployment...");
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("\n✅ FuturesMarketFactory deployed at:", factoryAddress);

  // Grant roles on CoreVault
  console.log("\n🔒 Granting roles on CoreVault...");
  const core = await ethers.getContractAt("CoreVault", coreVault);
  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );

  try {
    const tx1 = await core.grantRole(FACTORY_ROLE, factoryAddress);
    console.log("  • grant FACTORY_ROLE → tx:", tx1.hash);
    await tx1.wait();
    console.log("  ✅ FACTORY_ROLE granted");
  } catch (e) {
    console.log("  ⚠️ grant FACTORY_ROLE failed:", e?.message || e);
  }

  try {
    const tx2 = await core.grantRole(SETTLEMENT_ROLE, factoryAddress);
    console.log("  • grant SETTLEMENT_ROLE → tx:", tx2.hash);
    await tx2.wait();
    console.log("  ✅ SETTLEMENT_ROLE granted");
  } catch (e) {
    console.log("  ⚠️ grant SETTLEMENT_ROLE failed:", e?.message || e);
  }

  // Output env snippet for frontend/backend
  console.log("\n📦 Environment snippet (copy/paste):\n");
  console.log(`FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`GASLESS_CREATE_ENABLED=true`);
  console.log(`NEXT_PUBLIC_GASLESS_CREATE_ENABLED=true`);
  console.log(`EIP712_FACTORY_DOMAIN_NAME=DexeteraFactory`);
  console.log(`EIP712_FACTORY_DOMAIN_VERSION=1`);

  console.log(
    "\nℹ️  Next step: run `node scripts/sync-factory-abi.js` to update frontend ABI."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
