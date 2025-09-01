import { ethers } from "hardhat";
import { saveMarketCreation } from "./utils/supabase-client";

async function main() {
  const [deployer] = await ethers.getSigners();
  const factoryAddress = process.env.USE_FACTORY_ADDRESS || "";
  if (!factoryAddress) throw new Error("USE_FACTORY_ADDRESS env required");

  const umaOracleManager = process.env.UMA_ORACLE_MANAGER_ADDRESS || "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4";
  const centralVault = process.env.CENTRAL_VAULT_ADDRESS || "0x602B4B1fe6BBC10096970D4693D94376527D04ab";
  const orderRouter = process.env.ORDER_ROUTER_ADDRESS || "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";

  console.log("👤 Deployer:", deployer.address);
  console.log("🏭 Using Factory:", factoryAddress);

  const Factory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = Factory.attach(factoryAddress);

  const suffix = `${Date.now()}_${Math.floor(Math.random()*1e6)}`;
  const markets = [
    { id: `SILVER_V1_R2_${suffix}`, desc: "Silver Price (V1 Replacement)" },
    { id: `SILVER_V2_R2_${suffix}`, desc: "Silver Price (V2 Replacement)" },
  ];

  for (const m of markets) {
    const settlementDate = Math.floor((Date.now() + 333 * 24 * 60 * 60 * 1000) / 1000);
    const tradingEndDate = Math.floor((Date.now() + 328 * 24 * 60 * 60 * 1000) / 1000);

    const config = {
      metricId: m.id,
      description: `${m.desc} with EIP-712 relayed router`,
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

    console.log("\n🛠️ Creating market:", m.id);
    const tx = await factory.createMarket(config, { value: 0 });
    console.log("📝 Tx:", tx.hash);
    const receipt = await tx.wait();
    console.log("✅ Confirmed in block", receipt?.blockNumber);

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

    await saveMarketCreation({
      metricId: m.id,
      description: `${m.desc} with EIP-712 relayed router`,
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
      factoryAddress,
      centralVaultAddress: centralVault,
      orderRouterAddress: orderRouter,
      umaOracleManagerAddress: umaOracleManager,
      chainId: 137,
      deploymentTransactionHash: tx.hash,
      deploymentBlockNumber: Number(receipt?.blockNumber || 0),
      creatorWalletAddress: deployer.address,
    });
  }

  console.log("\n🎉 Markets created successfully.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


