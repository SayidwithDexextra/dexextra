const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log(
    "🚀 Deploying UPDATED DexContractsV2 Contracts with StartPrice to Polygon Mainnet...\n"
  );

  const [deployer] = await ethers.getSigners();
  console.log("📍 Deploying with account:", deployer.address);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("💰 Account balance:", ethers.formatEther(balance), "MATIC\n");

  // Use existing contract addresses (DO NOT REDEPLOY)
  const mockUSDCAddress = "0xbD9E0b8e723434dCd41700e82cC4C8C539F66377";
  const existingVaultAddress = "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93";
  const existingRegistryAddress = "0x8f5200203c53c5821061D1f29249f10A5b57CA6A";
  const existingLimitOrderManagerAddress =
    "0x6c91c1A5D49707f4716344d0881c43215FC55D41";

  console.log("✅ Using existing Mock USDC at:", mockUSDCAddress);
  console.log("✅ Using existing CentralizedVault at:", existingVaultAddress);
  console.log("✅ Using existing MetricRegistry at:", existingRegistryAddress);
  console.log(
    "✅ Using existing LimitOrderManager at:",
    existingLimitOrderManagerAddress
  );

  // Deploy NEW MetricVAMMFactory (with startPrice functionality)
  console.log("\n🏗️  Deploying NEW MetricVAMMFactory with startPrice...");
  const MetricVAMMFactory = await ethers.getContractFactory(
    "MetricVAMMFactory"
  );
  const factory = await MetricVAMMFactory.deploy(
    existingVaultAddress,
    existingRegistryAddress
  );
  await factory.waitForDeployment();
  console.log(
    "✅ NEW MetricVAMMFactory deployed to:",
    await factory.getAddress()
  );

  // Update existing vault with new factory address
  console.log(
    "\n🔧 Updating existing CentralizedVault with new factory address..."
  );
  const CentralizedVault = await ethers.getContractFactory("CentralizedVault");
  const existingVault = CentralizedVault.attach(existingVaultAddress);
  await existingVault.setFactory(await factory.getAddress());
  console.log("✅ CentralizedVault factory address updated");

  // Deploy NEW MetricVAMMRouter (to work with new factory)
  console.log("\n🏗️  Deploying NEW MetricVAMMRouter...");
  const MetricVAMMRouter = await ethers.getContractFactory("MetricVAMMRouter");
  const router = await MetricVAMMRouter.deploy(
    await factory.getAddress(),
    existingVaultAddress,
    existingRegistryAddress,
    existingLimitOrderManagerAddress
  );
  await router.waitForDeployment();
  console.log(
    "✅ NEW MetricVAMMRouter deployed to:",
    await router.getAddress()
  );

  console.log("\n📋 DEPLOYMENT SUMMARY");
  console.log("====================");
  console.log("Mock USDC (existing):       ", mockUSDCAddress);
  console.log("MetricRegistry (existing):  ", existingRegistryAddress);
  console.log("CentralizedVault (existing):", existingVaultAddress);
  console.log("MetricVAMMFactory (NEW):    ", await factory.getAddress());
  console.log("MetricVAMMRouter (NEW):     ", await router.getAddress());

  // Save deployment info
  const deploymentInfo = {
    network: "polygon",
    timestamp: new Date().toISOString(),
    deploymentType: "startPrice_upgrade",
    contracts: {
      usdc: mockUSDCAddress,
      metricRegistry: existingRegistryAddress,
      centralVault: existingVaultAddress,
      factory: await factory.getAddress(),
      router: await router.getAddress(),
    },
    newContracts: {
      factory: await factory.getAddress(),
      router: await router.getAddress(),
    },
    existingContracts: {
      usdc: mockUSDCAddress,
      metricRegistry: existingRegistryAddress,
      centralVault: existingVaultAddress,
    },
  };

  const deploymentPath = path.join(
    __dirname,
    "deployment-polygon-startprice-upgrade.json"
  );
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentInfo, null, 2));

  console.log("\n📄 Deployment info saved to:", deploymentPath);

  return deploymentInfo;
}

main()
  .then((deploymentInfo) => {
    console.log("\n✅ Deployment script completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Deployment failed:", error);
    process.exit(1);
  });
