require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const { supabase } = require("./utils/supabase-client.cjs");

async function upsertMarket(row) {
  if (!supabase) throw new Error("Supabase not configured");
  const { error } = await supabase
    .from("orderbook_markets")
    .upsert(row, { onConflict: "metric_id" });
  if (error) throw error;
}

(async () => {
  const deployer = process.env.DEPLOYER_ADDRESS || "";
  const common = {
    category: "COMMODITY",
    decimals: 8,
    minimum_order_size: "1.00000000",
    tick_size: "0.01000000",
    requires_kyc: false,
    data_request_window_seconds: 86400,
    auto_settle: true,
    creation_fee: "0.00000000",
    is_active: true,
    factory_address: "manual",
    central_vault_address: "0x602B4B1fe6BBC10096970D4693D94376527D04ab",
    order_router_address: "0x836AaF8c558F7390d59591248e02435fc9Ea66aD",
    uma_oracle_manager_address: "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4",
    chain_id: 137,
    market_status: "ACTIVE",
    total_volume: "0.00000000",
    total_trades: 0,
    open_interest_long: "0.00000000",
    open_interest_short: "0.00000000",
    creator_wallet_address: deployer,
    deployed_at: new Date().toISOString(),
  };

  const markets = [
    {
      metric_id: "SILVER_Relayed_Aurora_2025_85969",
      description: "Silver Oracle-Settled Prediction • Aurora Series (Relayed)",
      settlement_date: new Date(
        Date.now() + 333 * 24 * 60 * 60 * 1000
      ).toISOString(),
      trading_end_date: new Date(
        Date.now() + 328 * 24 * 60 * 60 * 1000
      ).toISOString(),
      oracle_provider: deployer,
      initial_order: {
        enabled: true,
        side: 0,
        quantity: "100.00000000",
        price: "10.00000000",
        timeInForce: 0,
        expiryTime: 0,
      },
      market_address: "0xc0A3126CA127f569fd8D607540b3B903716E2e08",
    },
    {
      metric_id: "SILVER_Relayed_Meridian_2025_85969",
      description:
        "Silver Oracle-Settled Prediction • Meridian Series (Relayed)",
      settlement_date: new Date(
        Date.now() + 333 * 24 * 60 * 60 * 1000
      ).toISOString(),
      trading_end_date: new Date(
        Date.now() + 328 * 24 * 60 * 60 * 1000
      ).toISOString(),
      oracle_provider: deployer,
      initial_order: {
        enabled: true,
        side: 0,
        quantity: "100.00000000",
        price: "10.00000000",
        timeInForce: 0,
        expiryTime: 0,
      },
      market_address: "0x0900D4f3C7CF7d8f55709019330cCE110bC76DEf",
    },
  ];

  for (const m of markets) {
    const row = { ...common, ...m };
    console.log("⬆️ Upserting", row.metric_id);
    await upsertMarket(row);
    console.log("✅ Upserted", row.metric_id);
  }
})().catch((e) => {
  console.error("💥 Upsert failed:", e);
  process.exit(1);
});
