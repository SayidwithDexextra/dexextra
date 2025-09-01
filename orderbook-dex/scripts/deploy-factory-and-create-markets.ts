import { ethers, run } from "hardhat";
import { supabase, saveMarketCreation } from "./utils/supabase-client";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  const umaOracleManager = process.env.UMA_ORACLE_MANAGER_ADDRESS || "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4";
  const orderBookImplementation = process.env.ORDERBOOK_IMPL_ADDRESS || "0x053Fa4b76A8661A9FF653F58d20FA15521b1bc63";
  const centralVault = process.env.CENTRAL_VAULT_ADDRESS || "0x602B4B1fe6BBC10096970D4693D94376527D04ab";
  const orderRouter = process.env.ORDER_ROUTER_ADDRESS || "0x836AaF8c558F7390d59591248e02435fc9Ea66aD"; // new router with deployer as admin
  const admin = process.env.FACTORY_ADMIN_ADDRESS || deployer.address;
  const defaultCreationFee = ethers.parseEther(process.env.DEFAULT_CREATION_FEE || "0");
  const feeRecipient = process.env.FEE_RECIPIENT || deployer.address;

  console.log("\n📦 Deploying new MetricsMarketFactory pointing to new router...");
  const Factory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = await Factory.deploy(
    umaOracleManager,
    orderBookImplementation,
    centralVault,
    orderRouter,
    admin,
    defaultCreationFee,
    feeRecipient
  );
  await factory.waitForDeployment();
  const factoryAddress = await factory.getAddress();
  console.log("✅ MetricsMarketFactory:", factoryAddress);

  // Grant FACTORY_ROLE on router to this factory
  console.log("\n🔑 Granting FACTORY_ROLE to factory on OrderRouter...");
  const Router = await ethers.getContractFactory("OrderRouter");
  const router = Router.attach(orderRouter);
  const FACTORY_ROLE = await router.FACTORY_ROLE();
  const hasRole = await router.hasRole(FACTORY_ROLE, factoryAddress);
  if (!hasRole) {
    const grantTx = await router.grantRole(FACTORY_ROLE, factoryAddress);
    await grantTx.wait();
    console.log("✅ FACTORY_ROLE granted to", factoryAddress);
  } else {
    console.log("ℹ️ Factory already has FACTORY_ROLE");
  }

  // Verify factory (best-effort)
  try {
    console.log("\n🔎 Verifying factory on Polygonscan...");
    await run("verify:verify", {
      address: factoryAddress,
      constructorArguments: [
        umaOracleManager,
        orderBookImplementation,
        centralVault,
        orderRouter,
        admin,
        defaultCreationFee,
        feeRecipient,
      ],
    });
    console.log("✅ Factory verification submitted");
  } catch (e: any) {
    console.warn("⚠️ Factory verification skipped/failed:", e?.message || e);
  }

  // Create replacement markets for SILVER_V1 and SILVER_V2
  const now = Date.now();
  const marketsToCreate = [
    {
      metricId: `SILVER_V1_R2_${now}`,
      description: "Silver Price (V1 Replacement) with EIP-712 relayed router",
    },
    {
      metricId: `SILVER_V2_R2_${now}`,
      description: "Silver Price (V2 Replacement) with EIP-712 relayed router",
    },
  ];

  for (const m of marketsToCreate) {
    console.log(`\n🛠️ Creating market ${m.metricId} via new factory...`);
    const settlementDate = Math.floor((Date.now() + 333 * 24 * 60 * 60 * 1000) / 1000);
    const tradingEndDate = Math.floor((Date.now() + 328 * 24 * 60 * 60 * 1000) / 1000);

    const config = {
      metricId: m.metricId,
      description: m.description,
      oracleProvider: deployer.address,
      decimals: 8,
      minimumOrderSize: ethers.parseEther("1.0"),
      tickSize: ethers.parseEther("0.01"),
      creationFee: 0,
      requiresKYC: false,
      settlementDate,
      tradingEndDate,
      dataRequestWindow: 86400,
      autoSettle: true,
      initialOrder: {
        enabled: true,
        side: 0, // BUY
        quantity: ethers.parseEther("100"),
        price: ethers.parseEther("10.00"),
        timeInForce: 0,
        expiryTime: 0,
      },
    };

    const tx = await factory.createMarket(config, { value: 0 });
    console.log("📝 Tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Confirmed in block", receipt?.blockNumber);

    // Extract MarketCreated event to get market address
    let marketAddress = "";
    if (receipt?.logs) {
      for (const log of receipt.logs) {
        try {
          const parsed = factory.interface.parseLog(log);
          if (parsed?.name === "MarketCreated") {
            marketAddress = parsed.args.marketAddress;
            break;
          }
        } catch {}
      }
    }
    console.log("🏪 Market:", marketAddress);

    // Save to Supabase
    await saveMarketCreation({
      metricId: m.metricId,
      description: m.description,
      category: "COMMODITY",
      decimals: 8,
      minimumOrderSize: ethers.parseEther("1.0").toString(),
      requiresKyc: false,
      settlementDate: new Date(settlementDate * 1000),
      tradingEndDate: new Date(tradingEndDate * 1000),
      dataRequestWindowSeconds: 86400,
      autoSettle: true,
      oracleProvider: deployer.address,
      initialOrder: config.initialOrder,
      creationFee: "0",
      marketAddress,
      factoryAddress: factoryAddress,
      centralVaultAddress: centralVault,
      orderRouterAddress: orderRouter,
      umaOracleManagerAddress: umaOracleManager,
      chainId: 137,
      deploymentTransactionHash: tx.hash,
      deploymentBlockNumber: Number(receipt?.blockNumber || 0),
      creatorWalletAddress: deployer.address,
    });
  }

  console.log("\n🎉 New factory deployed and replacement markets created.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});







