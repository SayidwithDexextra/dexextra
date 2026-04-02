#!/usr/bin/env node

// deploy-upgraded-vault.js
//
// Deploys the upgraded CoreVault (UUPS proxy) and all supporting manager
// contracts: LiquidationManager, VaultViewsManager, SettlementManager.
//
// USAGE:
//   npx hardhat run scripts/deploy-upgraded-vault.js --network localhost
//   npx hardhat run scripts/deploy-upgraded-vault.js --network hyperliquid_testnet

const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config({
    path: path.resolve(__dirname, "../../.env.local"),
  });
} catch (_) {}
try {
  require("dotenv").config();
} catch (_) {}

async function main() {
  console.log("\n========================================");
  console.log("  CoreVault V2 — UUPS Proxy Deployment");
  console.log("========================================\n");

  const network = await ethers.provider.getNetwork();
  const chainId = Number(network.chainId);
  const networkName = process.env.HARDHAT_NETWORK || "unknown";
  console.log(`Network: ${networkName} (chainId ${chainId})`);

  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${ethers.formatEther(balance)} ETH\n`);

  const collateralToken =
    process.env.COLLATERAL_TOKEN_ADDRESS ||
    process.env.MOCK_USDC ||
    process.env.USDC_TOKEN_ADDRESS;

  if (!collateralToken) {
    throw new Error(
      "COLLATERAL_TOKEN_ADDRESS (or MOCK_USDC / USDC_TOKEN_ADDRESS) must be set"
    );
  }
  console.log(`Collateral token: ${collateralToken}`);

  // ------------------------------------------------------------------
  // 1. Deploy (or reuse) libraries
  // ------------------------------------------------------------------
  console.log("\n--- Step 1: Libraries ---");

  let vaultAnalyticsAddr = process.env.VAULT_ANALYTICS;
  if (vaultAnalyticsAddr) {
    console.log(`Reusing VaultAnalytics: ${vaultAnalyticsAddr}`);
  } else {
    const VaultAnalytics = await ethers.getContractFactory("VaultAnalytics");
    const vaultAnalytics = await VaultAnalytics.deploy();
    await vaultAnalytics.waitForDeployment();
    vaultAnalyticsAddr = await vaultAnalytics.getAddress();
    console.log(`Deployed VaultAnalytics: ${vaultAnalyticsAddr}`);
  }

  let positionManagerAddr = process.env.POSITION_MANAGER;
  if (positionManagerAddr) {
    console.log(`Reusing PositionManager: ${positionManagerAddr}`);
  } else {
    const PositionManager = await ethers.getContractFactory("PositionManager");
    const positionManager = await PositionManager.deploy();
    await positionManager.waitForDeployment();
    positionManagerAddr = await positionManager.getAddress();
    console.log(`Deployed PositionManager: ${positionManagerAddr}`);
  }

  const libraries = {
    VaultAnalytics: vaultAnalyticsAddr,
    PositionManager: positionManagerAddr,
  };

  // ------------------------------------------------------------------
  // 2. Deploy CoreVault implementation
  // ------------------------------------------------------------------
  console.log("\n--- Step 2: CoreVault implementation ---");

  const CoreVaultImpl = await ethers.getContractFactory("CoreVault", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const impl = await CoreVaultImpl.deploy(collateralToken);
  await impl.waitForDeployment();
  const implAddress = await impl.getAddress();
  console.log(`CoreVault implementation: ${implAddress}`);

  // ------------------------------------------------------------------
  // 3. Deploy ERC1967Proxy → initialize
  // ------------------------------------------------------------------
  console.log("\n--- Step 3: ERC1967Proxy + initialize ---");

  const initData = CoreVaultImpl.interface.encodeFunctionData("initialize", [
    deployer.address,
  ]);

  const ERC1967Proxy = await ethers.getContractFactory(
    "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol:ERC1967Proxy"
  );
  const proxy = await ERC1967Proxy.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const proxyAddress = await proxy.getAddress();

  const vault = CoreVaultImpl.attach(proxyAddress);
  console.log(`CoreVault proxy: ${proxyAddress}`);

  // ------------------------------------------------------------------
  // 4. Deploy manager contracts
  // ------------------------------------------------------------------
  console.log("\n--- Step 4: Manager contracts ---");

  // VaultViewsManager — only needs VaultAnalytics
  const VaultViewsManager = await ethers.getContractFactory(
    "VaultViewsManager",
    { libraries: { VaultAnalytics: vaultAnalyticsAddr } }
  );
  const viewsManager = await VaultViewsManager.deploy();
  await viewsManager.waitForDeployment();
  const viewsManagerAddr = await viewsManager.getAddress();
  console.log(`VaultViewsManager: ${viewsManagerAddr}`);

  // SettlementManager — needs PositionManager via CoreVaultStorage
  const SettlementManager = await ethers.getContractFactory("SettlementManager", {
    libraries: { PositionManager: positionManagerAddr },
  });
  const settlementManager = await SettlementManager.deploy();
  await settlementManager.waitForDeployment();
  const settlementManagerAddr = await settlementManager.getAddress();
  console.log(`SettlementManager: ${settlementManagerAddr}`);

  // LiquidationManager — needs VaultAnalytics + PositionManager
  const LiquidationManager = await ethers.getContractFactory(
    "LiquidationManager",
    { libraries: { VaultAnalytics: vaultAnalyticsAddr, PositionManager: positionManagerAddr } }
  );
  const liquidationManager = await LiquidationManager.deploy(
    collateralToken,
    deployer.address
  );
  await liquidationManager.waitForDeployment();
  const liquidationManagerAddr = await liquidationManager.getAddress();
  console.log(`LiquidationManager: ${liquidationManagerAddr}`);

  // ------------------------------------------------------------------
  // 5. Wire managers into proxy
  // ------------------------------------------------------------------
  console.log("\n--- Step 5: Wiring managers ---");

  let tx;

  tx = await vault.setViewsManager(viewsManagerAddr);
  await tx.wait();
  console.log("setViewsManager        ✓");

  tx = await vault.setSettlementManager(settlementManagerAddr);
  await tx.wait();
  console.log("setSettlementManager   ✓");

  tx = await vault.setLiquidationManager(liquidationManagerAddr);
  await tx.wait();
  console.log("setLiquidationManager  ✓");

  const sessionRegistry = process.env.GLOBAL_SESSION_REGISTRY;
  if (sessionRegistry) {
    tx = await vault.setSessionRegistry(sessionRegistry);
    await tx.wait();
    console.log(`setSessionRegistry     ✓  (${sessionRegistry})`);
  } else {
    console.log("setSessionRegistry     — skipped (no GLOBAL_SESSION_REGISTRY)");
  }

  // ------------------------------------------------------------------
  // 6. Grant roles
  // ------------------------------------------------------------------
  console.log("\n--- Step 6: Role grants ---");

  const FACTORY_ROLE = ethers.keccak256(ethers.toUtf8Bytes("FACTORY_ROLE"));
  const SETTLEMENT_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("SETTLEMENT_ROLE")
  );
  const ORDERBOOK_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("ORDERBOOK_ROLE")
  );

  const roleGrants = [
    { envVar: "FACTORY_ADDRESS", role: FACTORY_ROLE, label: "FACTORY_ROLE" },
    {
      envVar: "SETTLEMENT_ADDRESS",
      role: SETTLEMENT_ROLE,
      label: "SETTLEMENT_ROLE",
    },
    {
      envVar: "ORDERBOOK_ADDRESS",
      role: ORDERBOOK_ROLE,
      label: "ORDERBOOK_ROLE",
    },
    {
      envVar: "FUTURES_MARKET_FACTORY",
      role: FACTORY_ROLE,
      label: "FACTORY_ROLE (factory)",
    },
  ];

  for (const { envVar, role, label } of roleGrants) {
    const addr = process.env[envVar];
    if (addr) {
      tx = await vault.grantRole(role, addr);
      await tx.wait();
      console.log(`Granted ${label} → ${addr}`);
    }
  }

  // Grant deployer SETTLEMENT_ROLE so mark prices can be set
  tx = await vault.grantRole(SETTLEMENT_ROLE, deployer.address);
  await tx.wait();
  console.log(`Granted SETTLEMENT_ROLE → deployer (${deployer.address})`);

  // ------------------------------------------------------------------
  // 7. Save deployment artifact
  // ------------------------------------------------------------------
  console.log("\n--- Step 7: Saving deployment ---");

  const deployment = {
    network: networkName,
    chainId,
    deployer: deployer.address,
    timestamp: new Date().toISOString(),
    contracts: {
      CoreVaultProxy: proxyAddress,
      CoreVaultImpl: implAddress,
      VaultAnalytics: vaultAnalyticsAddr,
      PositionManager: positionManagerAddr,
      VaultViewsManager: viewsManagerAddr,
      SettlementManager: settlementManagerAddr,
      LiquidationManager: liquidationManagerAddr,
      CollateralToken: collateralToken,
      SessionRegistry: sessionRegistry || null,
    },
  };

  const deploymentsDir = path.join(__dirname, "../deployments");
  if (!fs.existsSync(deploymentsDir)) {
    fs.mkdirSync(deploymentsDir, { recursive: true });
  }
  const outFile = path.join(
    deploymentsDir,
    `upgraded-vault-${chainId}.json`
  );
  fs.writeFileSync(outFile, JSON.stringify(deployment, null, 2));
  console.log(`Saved: ${outFile}`);

  // ------------------------------------------------------------------
  // Summary
  // ------------------------------------------------------------------
  console.log("\n========================================");
  console.log("  Deployment Complete");
  console.log("========================================");
  console.log(`  CoreVault Proxy:      ${proxyAddress}`);
  console.log(`  CoreVault Impl:       ${implAddress}`);
  console.log(`  VaultAnalytics:       ${vaultAnalyticsAddr}`);
  console.log(`  PositionManager:      ${positionManagerAddr}`);
  console.log(`  VaultViewsManager:    ${viewsManagerAddr}`);
  console.log(`  SettlementManager:    ${settlementManagerAddr}`);
  console.log(`  LiquidationManager:   ${liquidationManagerAddr}`);
  console.log(`  Collateral Token:     ${collateralToken}`);
  if (sessionRegistry) {
    console.log(`  Session Registry:     ${sessionRegistry}`);
  }
  console.log("========================================\n");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\nDeployment failed:", error);
    process.exit(1);
  });
