const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FuturesMarketFactoryV2 with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Required addresses from environment
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;
  const bondManagerAddress = process.env.BOND_MANAGER_ADDRESS;
  const facetRegistryAddress = process.env.FACET_REGISTRY_ADDRESS;
  const initFacetAddress = process.env.ORDER_BOOK_INIT_FACET;

  console.log("\n📋 Configuration:");
  console.log("  CoreVault:", coreVaultAddress);
  console.log("  FeeRecipient:", feeRecipient);
  console.log("  BondManager:", bondManagerAddress);
  console.log("  FacetRegistry:", facetRegistryAddress);
  console.log("  InitFacet:", initFacetAddress);

  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
    throw new Error("CORE_VAULT_ADDRESS not configured");
  }
  if (!bondManagerAddress || !ethers.isAddress(bondManagerAddress)) {
    throw new Error("BOND_MANAGER_ADDRESS not configured");
  }
  if (!facetRegistryAddress || !ethers.isAddress(facetRegistryAddress)) {
    throw new Error("FACET_REGISTRY_ADDRESS not configured");
  }
  if (!initFacetAddress || !ethers.isAddress(initFacetAddress)) {
    throw new Error("ORDER_BOOK_INIT_FACET not configured");
  }

  // Deploy FuturesMarketFactoryV2
  console.log("\n🚀 Deploying FuturesMarketFactoryV2...");
  const Factory = await ethers.getContractFactory("FuturesMarketFactoryV2");
  const factory = await Factory.deploy(coreVaultAddress, deployer.address, feeRecipient);
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ FuturesMarketFactoryV2 deployed to:", factoryAddress);

  // Configure factory
  console.log("\n⚙️  Configuring factory...");
  
  console.log("  Setting BondManager...");
  let tx = await factory.setBondManager(bondManagerAddress);
  await tx.wait();
  console.log("  ✅ BondManager set");

  console.log("  Setting FacetRegistry...");
  tx = await factory.setFacetRegistry(facetRegistryAddress);
  await tx.wait();
  console.log("  ✅ FacetRegistry set");

  console.log("  Setting InitFacet...");
  tx = await factory.setInitFacet(initFacetAddress);
  await tx.wait();
  console.log("  ✅ InitFacet set");

  // Grant FACTORY_ROLE on CoreVault
  console.log("\n🔑 Granting FACTORY_ROLE on CoreVault...");
  const coreVaultAbi = [
    "function FACTORY_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)",
    "function grantRole(bytes32 role, address account)"
  ];
  const coreVault = new ethers.Contract(coreVaultAddress, coreVaultAbi, deployer);
  const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
  
  const hasRole = await coreVault.hasRole(FACTORY_ROLE, factoryAddress);
  if (!hasRole) {
    tx = await coreVault.grantRole(FACTORY_ROLE, factoryAddress);
    await tx.wait();
    console.log("✅ Granted FACTORY_ROLE to new factory");
  } else {
    console.log("✅ Factory already has FACTORY_ROLE");
  }

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("🎉 DEPLOYMENT COMPLETE");
  console.log("=".repeat(60));
  console.log("\nFuturesMarketFactoryV2:", factoryAddress);
  console.log("\nUpdate these environment variables:");
  console.log(`  FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`  NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log("\nFactory now supports:");
  console.log("  - metaCreateFuturesMarketV2 (gasless V2 - no facet cuts in signature)");
  console.log("  - createFuturesMarketV2 (direct V2)");
  console.log("  - metaCreateFuturesMarketDiamond (gasless V1 - legacy)");
  console.log("  - createFuturesMarketDiamond (direct V1 - legacy)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
