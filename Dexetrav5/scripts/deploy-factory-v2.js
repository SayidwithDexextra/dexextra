const { ethers } = require("hardhat");

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FuturesMarketFactory V2 with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Required addresses from environment
  const coreVaultAddress = process.env.CORE_VAULT_ADDRESS;
  const bondManagerAddress = process.env.MARKET_BOND_MANAGER_ADDRESS;
  const facetRegistryAddress = process.env.FACET_REGISTRY_ADDRESS;
  const initFacetAddress = process.env.ORDER_BOOK_INIT_FACET;
  const feeRecipient = process.env.RELAYER_ADDRESS || deployer.address;

  console.log("\n📋 Configuration:");
  console.log("  CoreVault:", coreVaultAddress);
  console.log("  BondManager:", bondManagerAddress);
  console.log("  FacetRegistry:", facetRegistryAddress);
  console.log("  InitFacet:", initFacetAddress);
  console.log("  FeeRecipient:", feeRecipient);
  console.log("  Admin:", deployer.address);

  // Validate addresses
  if (!coreVaultAddress || !ethers.isAddress(coreVaultAddress)) {
    console.error("❌ CORE_VAULT_ADDRESS not set or invalid");
    process.exit(1);
  }
  if (!facetRegistryAddress || !ethers.isAddress(facetRegistryAddress)) {
    console.error("❌ FACET_REGISTRY_ADDRESS not set or invalid");
    process.exit(1);
  }
  if (!initFacetAddress || !ethers.isAddress(initFacetAddress)) {
    console.error("❌ ORDER_BOOK_INIT_FACET not set or invalid");
    process.exit(1);
  }

  // Deploy FuturesMarketFactoryV2 (streamlined, under 24KB limit)
  console.log("\n🚀 Deploying FuturesMarketFactoryV2...");
  const Factory = await ethers.getContractFactory("FuturesMarketFactoryV2");
  const factory = await Factory.deploy(
    coreVaultAddress,
    deployer.address,  // admin
    feeRecipient
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ FuturesMarketFactory deployed to:", factoryAddress);

  // Configure BondManager
  if (bondManagerAddress && ethers.isAddress(bondManagerAddress)) {
    console.log("\n⚙️  Setting BondManager...");
    const tx1 = await factory.setBondManager(bondManagerAddress);
    await tx1.wait();
    console.log("✅ BondManager set to:", bondManagerAddress);
  } else {
    console.log("⚠️  No BondManager configured (MARKET_BOND_MANAGER_ADDRESS not set)");
  }

  // Configure FacetRegistry for V2 markets
  console.log("\n⚙️  Setting FacetRegistry...");
  const tx2 = await factory.setFacetRegistry(facetRegistryAddress);
  await tx2.wait();
  console.log("✅ FacetRegistry set to:", facetRegistryAddress);

  // Configure InitFacet for V2 markets
  console.log("\n⚙️  Setting InitFacet...");
  const tx3 = await factory.setInitFacet(initFacetAddress);
  await tx3.wait();
  console.log("✅ InitFacet set to:", initFacetAddress);

  // Register factory with CoreVault
  console.log("\n⚙️  Registering factory with CoreVault...");
  const coreVaultAbi = [
    "function grantRole(bytes32 role, address account) external",
    "function FACTORY_ROLE() view returns (bytes32)",
    "function hasRole(bytes32 role, address account) view returns (bool)"
  ];
  const coreVault = new ethers.Contract(coreVaultAddress, coreVaultAbi, deployer);
  
  try {
    const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
    const hasRole = await coreVault.hasRole(FACTORY_ROLE, factoryAddress);
    if (!hasRole) {
      const tx4 = await coreVault.grantRole(FACTORY_ROLE, factoryAddress);
      await tx4.wait();
      console.log("✅ Granted FACTORY_ROLE to new factory");
    } else {
      console.log("ℹ️  Factory already has FACTORY_ROLE");
    }
  } catch (e) {
    console.log("⚠️  Could not grant FACTORY_ROLE:", e.message);
    console.log("   You may need to grant this manually.");
  }

  // Verify configuration
  console.log("\n🔍 Verifying configuration...");
  const configuredRegistry = await factory.facetRegistry();
  const configuredInit = await factory.initFacetAddress();
  const configuredBond = await factory.bondManager();
  const configuredVault = await factory.vault();
  
  console.log("  vault:", configuredVault);
  console.log("  bondManager:", configuredBond);
  console.log("  facetRegistry:", configuredRegistry);
  console.log("  initFacetAddress:", configuredInit);

  // Summary
  console.log("\n═══════════════════════════════════════════════════════════════");
  console.log("FuturesMarketFactory V2 Deployment Summary:");
  console.log("═══════════════════════════════════════════════════════════════");
  console.log("  Factory Address:", factoryAddress);
  console.log("  CoreVault:", configuredVault);
  console.log("  BondManager:", configuredBond);
  console.log("  FacetRegistry:", configuredRegistry);
  console.log("  InitFacet:", configuredInit);
  console.log("═══════════════════════════════════════════════════════════════");

  console.log("\n📋 Update your .env.local with:");
  console.log(`FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);
  console.log(`NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${factoryAddress}`);

  console.log("\n📋 The factory supports both:");
  console.log("  - createFuturesMarketDiamond() - existing flow with facet cuts");
  console.log("  - createFuturesMarketV2() - new flow using FacetRegistry (simpler, auto-upgrades)");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
