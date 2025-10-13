const { ethers } = require("hardhat");
const { createClient } = require("@supabase/supabase-js");

/**
 * Create ALUMINUM_V2 market and save to Supabase
 * Using ALUM_V2 symbol since we already created it successfully
 */

async function main() {
  console.log("🚀 Creating ALUMINUM_V2 market and saving to Supabase...\n");

  // Production addresses
  const factoryAddress = "0x28036ce16450E9A74D5BbB699b2E11bbA8EC6c75";
  const vaultRouterAddress = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
  const tradingRouterAddress = "0x740C78Ab819a3ceeBaCC544350ef40EA1B790C2B";
  const upgradeManagerAddress = "0x0B403f10BBe8F1EcE4D4756c9384429D364CE7E9";

  // Market we created in the test
  const aluminumV2MarketId =
    "0x88f2de2739bd614453f56cfec79f0456ef2829a0a56b36a410723613bcf2415b";
  const aluminumV2OrderBook = "0xaA5662ab1bF7BA1055B8C63281b764aF65553fec";
  const symbol = "ALUM_V2";

  // Get deployer
  const [deployer] = await ethers.getSigners();
  console.log("👤 Deployer:", deployer.address);

  // Supabase setup
  const supabaseConfig = {
    url: "https://khhknmobkkkvvogznxdj.supabase.co",
    anonKey:
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODYyNjcsImV4cCI6MjA2Njk2MjI2N30.vt_7kDR-6IrDYqdrMTzCo5NyFXYZQU-X_OwEtOP1u24",
  };

  const supabase = createClient(supabaseConfig.url, supabaseConfig.anonKey);
  console.log("✅ Connected to Supabase");

  // Verify market exists
  const factory = await ethers.getContractAt(
    "OrderBookFactoryMinimal",
    factoryAddress
  );
  const marketInfo = await factory.getMarket(aluminumV2MarketId);

  console.log("🔍 Verifying market details:");
  console.log("   Symbol:", marketInfo.symbol);
  console.log("   OrderBook:", marketInfo.orderBookAddress);
  console.log("   Active:", marketInfo.isActive);
  console.log("   Creator:", marketInfo.creator);

  if (marketInfo.orderBookAddress !== aluminumV2OrderBook) {
    throw new Error("Market addresses don't match!");
  }

  // Get network info
  const network = await deployer.provider.getNetwork();
  const chainId = Number(network.chainId);

  console.log("\n💾 Saving ALUMINUM_V2 to Supabase...");

  // Prepare market data for Supabase
  const marketData = {
    metric_id: "ALUMINUM_V2", // This is what we want to call it in our system
    description:
      "Aluminum V2 futures market with enhanced features and optimizations for production trading",
    category: "COMMODITY",
    decimals: 18,
    minimum_order_size: 0.01,
    tick_size: 0.01,
    requires_kyc: false,
    auto_settle: true,
    oracle_provider: upgradeManagerAddress,
    creation_fee: 0,
    is_active: true,
    market_address: aluminumV2OrderBook,
    factory_address: factoryAddress,
    central_vault_address: vaultRouterAddress,
    order_router_address: tradingRouterAddress,
    uma_oracle_manager_address: upgradeManagerAddress,
    chain_id: chainId,
    market_status: "ACTIVE",
    total_volume: 0,
    total_trades: 0,
    open_interest_long: 0,
    open_interest_short: 0,
    creator_wallet_address: deployer.address,
    deployed_at: new Date().toISOString(),
    // Add additional fields for mapping
    symbol_on_chain: symbol, // The actual symbol used on-chain (ALUM_V2)
    market_id_on_chain: aluminumV2MarketId,
  };

  console.log("📋 Market data:");
  console.log("   Metric ID (display):", marketData.metric_id);
  console.log("   Symbol (on-chain):", marketData.symbol_on_chain);
  console.log("   Market Address:", marketData.market_address);
  console.log("   Factory Address:", marketData.factory_address);
  console.log("   Chain ID:", marketData.chain_id);

  try {
    // First check if it already exists
    const { data: existing, error: checkError } = await supabase
      .from("orderbook_markets")
      .select("*")
      .eq("metric_id", "ALUMINUM_V2")
      .single();

    if (existing && !checkError) {
      console.log("⚠️  ALUMINUM_V2 already exists in database");
      console.log("   Database ID:", existing.id);
      console.log("   Existing Market Address:", existing.market_address);

      // Update the existing record
      const { data: updateData, error: updateError } = await supabase
        .from("orderbook_markets")
        .update(marketData)
        .eq("metric_id", "ALUMINUM_V2")
        .select();

      if (updateError) {
        console.error("❌ Error updating Supabase:", updateError);
        throw updateError;
      }

      console.log("✅ Successfully updated ALUMINUM_V2 in Supabase!");
      console.log("📋 Updated record ID:", updateData[0]?.id);
    } else {
      // Insert new record
      const { data, error } = await supabase
        .from("orderbook_markets")
        .insert([marketData])
        .select();

      if (error) {
        console.error("❌ Error saving to Supabase:", error);
        throw error;
      }

      console.log("✅ Successfully saved ALUMINUM_V2 to Supabase!");
      console.log("📋 Database record ID:", data[0]?.id);
    }

    // Verify the entry
    console.log("\n🔍 Verifying database entry...");
    const { data: verifyData, error: verifyError } = await supabase
      .from("orderbook_markets")
      .select("*")
      .eq("metric_id", "ALUMINUM_V2")
      .single();

    if (verifyError) {
      console.error("❌ Error verifying:", verifyError);
    } else {
      console.log("✅ ALUMINUM_V2 verified in database!");
      console.log("   Database ID:", verifyData.id);
      console.log("   Metric ID:", verifyData.metric_id);
      console.log("   Market Address:", verifyData.market_address);
      console.log("   Symbol (on-chain):", verifyData.symbol_on_chain);
      console.log("   Status:", verifyData.market_status);
      console.log("   Created:", verifyData.created_at);
    }

    // Print summary
    console.log("\n" + "=".repeat(60));
    console.log("🎉 ALUMINUM_V2 DEPLOYMENT COMPLETE");
    console.log("=".repeat(60));
    console.log("📊 Market Name: ALUMINUM_V2");
    console.log("🔤 On-Chain Symbol:", symbol);
    console.log("🆔 Market ID:", aluminumV2MarketId);
    console.log("🏪 OrderBook Address:", aluminumV2OrderBook);
    console.log("🏭 Factory Address:", factoryAddress);
    console.log("🏦 VaultRouter Address:", vaultRouterAddress);
    console.log("🛣️  TradingRouter Address:", tradingRouterAddress);
    console.log("👤 Creator:", deployer.address);
    console.log("🌐 Network: Polygon Mainnet (Chain ID: 137)");
    console.log("\n🔗 Contract Links:");
    console.log(
      `   OrderBook: https://polygonscan.com/address/${aluminumV2OrderBook}`
    );
    console.log(
      `   Factory: https://polygonscan.com/address/${factoryAddress}`
    );
    console.log(
      `   VaultRouter: https://polygonscan.com/address/${vaultRouterAddress}`
    );
    console.log(
      `   TradingRouter: https://polygonscan.com/address/${tradingRouterAddress}`
    );
    console.log("\n📊 Status:");
    console.log("   ✅ OrderBook Contract Deployed");
    console.log("   ✅ Market Registered in Factory");
    console.log("   ✅ Market Data Saved to Supabase");
    console.log("   ✅ Ready for Trading via API");
    console.log("=".repeat(60));
  } catch (error) {
    console.error("\n❌ Failed to save to Supabase:", error);
    throw error;
  }
}

main()
  .then(() => {
    console.log(
      "\n✅ ALUMINUM_V2 deployment and database integration completed successfully!"
    );
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Script failed:", error);
    process.exit(1);
  });
