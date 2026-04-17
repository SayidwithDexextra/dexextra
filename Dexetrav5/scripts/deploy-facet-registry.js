const { ethers } = require("hardhat");

function getSelectorsFromAbi(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter(f => f.type === 'function')
    .map(f => iface.getFunction(f.name).selector);
}

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying FacetRegistry with account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

  // Deploy FacetRegistry
  const FacetRegistry = await ethers.getContractFactory("FacetRegistry");
  const registry = await FacetRegistry.deploy(deployer.address);
  await registry.waitForDeployment();
  const registryAddress = await registry.getAddress();
  
  console.log("\n✅ FacetRegistry deployed to:", registryAddress);

  // Load facet addresses from env
  const facets = [
    { name: "OBAdminFacet", address: process.env.OB_ADMIN_FACET },
    { name: "OBPricingFacet", address: process.env.OB_PRICING_FACET },
    { name: "OBOrderPlacementFacet", address: process.env.OB_ORDER_PLACEMENT_FACET },
    { name: "OBTradeExecutionFacet", address: process.env.OB_TRADE_EXECUTION_FACET },
    { name: "OBLiquidationFacet", address: process.env.OB_LIQUIDATION_FACET },
    { name: "OBViewFacet", address: process.env.OB_VIEW_FACET },
    { name: "OBSettlementFacet", address: process.env.OB_SETTLEMENT_FACET },
    { name: "OrderBookVaultAdminFacet", address: process.env.ORDERBOOK_VAULT_FACET },
    { name: "MarketLifecycleFacet", address: process.env.MARKET_LIFECYCLE_FACET },
    { name: "MetaTradeFacet", address: process.env.META_TRADE_FACET },
  ];

  console.log("\nRegistering facets...");
  
  for (const facet of facets) {
    if (!facet.address || facet.address === "0x" || !ethers.isAddress(facet.address)) {
      console.log(`⚠️  Skipping ${facet.name}: address not configured`);
      continue;
    }

    try {
      // Load the artifact to get selectors
      const artifact = await hre.artifacts.readArtifact(facet.name);
      const selectors = getSelectorsFromAbi(artifact.abi);
      
      if (selectors.length === 0) {
        console.log(`⚠️  Skipping ${facet.name}: no function selectors found`);
        continue;
      }

      console.log(`\nRegistering ${facet.name}:`);
      console.log(`  Address: ${facet.address}`);
      console.log(`  Selectors: ${selectors.length}`);

      const tx = await registry.registerFacet(facet.address, selectors);
      await tx.wait();
      
      console.log(`  ✅ Registered ${selectors.length} selectors`);
    } catch (err) {
      console.log(`  ⚠️  Error registering ${facet.name}: ${err.message}`);
    }
  }

  // Verify registration
  const totalSelectors = await registry.selectorCount();
  const version = await registry.version();
  
  console.log("\n═══════════════════════════════════════");
  console.log("FacetRegistry Summary:");
  console.log("  Address:", registryAddress);
  console.log("  Total Selectors:", totalSelectors.toString());
  console.log("  Version:", version.toString());
  console.log("═══════════════════════════════════════");

  // Configure factory if address is provided
  const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
  const initFacetAddress = process.env.ORDER_BOOK_INIT_FACET;
  
  if (factoryAddress && ethers.isAddress(factoryAddress)) {
    console.log("\nConfiguring FuturesMarketFactory...");
    
    const factoryAbi = [
      "function setFacetRegistry(address _facetRegistry) external",
      "function setInitFacet(address _initFacet) external",
      "function facetRegistry() view returns (address)",
      "function initFacetAddress() view returns (address)"
    ];
    const factory = new ethers.Contract(factoryAddress, factoryAbi, deployer);
    
    try {
      const tx1 = await factory.setFacetRegistry(registryAddress);
      await tx1.wait();
      console.log("  ✅ Set facetRegistry on factory");
      
      if (initFacetAddress && ethers.isAddress(initFacetAddress)) {
        const tx2 = await factory.setInitFacet(initFacetAddress);
        await tx2.wait();
        console.log("  ✅ Set initFacet on factory");
      }
      
      // Verify
      const configuredRegistry = await factory.facetRegistry();
      const configuredInit = await factory.initFacetAddress();
      console.log("\n  Factory configuration:");
      console.log("    facetRegistry:", configuredRegistry);
      console.log("    initFacet:", configuredInit);
    } catch (err) {
      console.log("  ⚠️  Error configuring factory:", err.message);
      console.log("  You may need to call setFacetRegistry and setInitFacet manually.");
    }
  }

  console.log("\n📋 Add these to your .env.local:");
  console.log(`FACET_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`NEXT_PUBLIC_FACET_REGISTRY_ADDRESS=${registryAddress}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
