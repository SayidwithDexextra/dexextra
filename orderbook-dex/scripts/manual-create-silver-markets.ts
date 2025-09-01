import { ethers } from "hardhat";
import { saveMarketCreation } from "./utils/supabase-client";

async function main() {
  const [deployer] = await ethers.getSigners();

  const routerAddr = process.env.ORDER_ROUTER_ADDRESS || "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";
  const umaAddr = process.env.UMA_ORACLE_MANAGER_ADDRESS || "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4";
  const vaultAddr = process.env.CENTRAL_VAULT_ADDRESS || "0x602B4B1fe6BBC10096970D4693D94376527D04ab";

  console.log("👤 Deployer:", deployer.address);
  console.log("🎯 Router:", routerAddr);
  console.log("🧠 UMA:", umaAddr);
  console.log("🏦 Vault:", vaultAddr);

  // Contracts
  const OrderBook = await ethers.getContractFactory("OrderBook");
  const Router = await ethers.getContractFactory("OrderRouter");
  const UMA = await ethers.getContractFactory("UMAOracleManager");

  const router = Router.attach(routerAddr);
  const uma = UMA.attach(umaAddr);

  // Ensure deployer has ROUTER_ADMIN_ROLE on router
  const ROUTER_ADMIN_ROLE = await router.ROUTER_ADMIN_ROLE();
  const hasRouterAdmin = await router.hasRole(ROUTER_ADMIN_ROLE, deployer.address);
  if (!hasRouterAdmin) {
    console.log("🔑 Granting ROUTER_ADMIN_ROLE to deployer...");
    const tx = await router.grantRole(ROUTER_ADMIN_ROLE, deployer.address);
    await tx.wait();
    console.log("✅ ROUTER_ADMIN_ROLE granted");
  } else {
    console.log("ℹ️ Deployer already has ROUTER_ADMIN_ROLE");
  }

  // Ensure deployer can configure UMA metrics
  const METRIC_MANAGER_ROLE = await uma.METRIC_MANAGER_ROLE();
  const hasMetricMgr = await uma.hasRole(METRIC_MANAGER_ROLE, deployer.address);
  if (!hasMetricMgr) {
    const ORACLE_ADMIN_ROLE = await uma.ORACLE_ADMIN_ROLE();
    const isOracleAdmin = await uma.hasRole(ORACLE_ADMIN_ROLE, deployer.address);
    if (!isOracleAdmin) throw new Error("Deployer lacks UMA ORACLE_ADMIN_ROLE to grant METRIC_MANAGER_ROLE");
    console.log("🔑 Granting METRIC_MANAGER_ROLE on UMA to deployer...");
    const tx = await uma.grantRole(METRIC_MANAGER_ROLE, deployer.address);
    await tx.wait();
    console.log("✅ METRIC_MANAGER_ROLE granted");
  } else {
    console.log("ℹ️ Deployer has METRIC_MANAGER_ROLE on UMA");
  }

  // Define two aesthetically-named markets
  const year = new Date().getUTCFullYear();
  const suffix = Math.floor(Math.random() * 1e6);
  const markets = [
    {
      metricId: `SILVER_Relayed_Aurora_${year}_${suffix}`,
      description: "Silver Oracle-Settled Prediction • Aurora Series (Relayed)",
    },
    {
      metricId: `SILVER_Relayed_Meridian_${year}_${suffix}`,
      description: "Silver Oracle-Settled Prediction • Meridian Series (Relayed)",
    },
  ];

  for (const m of markets) {
    console.log("\n============================");
    console.log("🛠️ Creating:", m.metricId);
    const settlementDate = Math.floor((Date.now() + 333 * 24 * 60 * 60 * 1000) / 1000);
    const tradingEndDate = Math.floor((Date.now() + 328 * 24 * 60 * 60 * 1000) / 1000);

    // Deploy OrderBook instance
    const ob = await OrderBook.deploy();
    await ob.waitForDeployment();
    const obAddr = await ob.getAddress();
    console.log("🏪 OrderBook:", obAddr);

    // Compute UMA identifier and configure metric
    const umaIdentifier = ethers.keccak256(ethers.toUtf8Bytes(`METRIC_${m.metricId}`));

    // configureMetric on UMA
    console.log("⚙️ Configuring UMA metric...");
    const cfg = {
      identifier: umaIdentifier,
      description: m.description,
      decimals: 8,
      minBond: ethers.parseEther("1000"),
      defaultReward: ethers.parseEther("100"),
      livenessPeriod: 7200,
      isActive: true,
      authorizedRequesters: [] as string[],
    };
    const txCfg = await uma.configureMetric(cfg);
    await txCfg.wait();
    console.log("✅ UMA metric configured");

    // Initialize OrderBook
    console.log("🔧 Initializing OrderBook...");
    const minOrder = ethers.parseEther("1.0");
    const tick = ethers.parseEther("0.01");
    const txInit = await ob.initialize(
      m.metricId,
      m.description,
      8,
      minOrder,
      tick,
      vaultAddr,
      routerAddr,
      umaAddr,
      umaIdentifier,
      settlementDate,
      tradingEndDate,
      86400,
      true
    );
    await txInit.wait();
    console.log("✅ OrderBook initialized");

    // Authorize the OrderBook as UMA requester
    console.log("🔑 Authorizing OrderBook as UMA requester...");
    const txAuth = await uma.addAuthorizedRequester(umaIdentifier, obAddr);
    await txAuth.wait();
    console.log("✅ Authorized requester added");

    // Register market on router
    console.log("🧭 Registering market on router...");
    const txReg = await router.registerMarket(m.metricId, obAddr);
    await txReg.wait();
    console.log("✅ Market registered on router");

    // Save to Supabase
    await saveMarketCreation({
      metricId: m.metricId,
      description: m.description,
      category: "COMMODITY",
      decimals: 8,
      minimumOrderSize: minOrder.toString(),
      requiresKyc: false,
      settlementDate: new Date(settlementDate * 1000),
      tradingEndDate: new Date(tradingEndDate * 1000),
      dataRequestWindowSeconds: 86400,
      autoSettle: true,
      oracleProvider: deployer.address,
      initialOrder: {
        enabled: true,
        side: 0,
        quantity: ethers.parseEther("100").toString(),
        price: ethers.parseEther("10.00").toString(),
        timeInForce: 0,
        expiryTime: 0,
      },
      creationFee: "0",
      marketAddress: obAddr,
      factoryAddress: "manual",
      centralVaultAddress: vaultAddr,
      orderRouterAddress: routerAddr,
      umaOracleManagerAddress: umaAddr,
      chainId: 137,
      deploymentTransactionHash: (await ob.deploymentTransaction())?.hash || "",
      deploymentBlockNumber: 0,
      creatorWalletAddress: deployer.address,
    });
  }

  console.log("\n🎉 Silver relayed markets created (manual path) and saved.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});







