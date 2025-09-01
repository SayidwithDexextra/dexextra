require("dotenv").config({ path: ".env.local" });
require("dotenv").config();
const { supabase } = require("./utils/supabase-client.cjs");

async function renameMetric(oldId, newId, newDesc) {
  if (!supabase) throw new Error("Supabase not configured");

  // If a row with newId already exists, delete or adjust to avoid conflict
  const { data: exists, error: existErr } = await supabase
    .from("orderbook_markets")
    .select("metric_id")
    .eq("metric_id", newId)
    .maybeSingle();
  if (existErr) throw existErr;
  if (exists) {
    // Overwrite existing newId row to ensure rename can proceed cleanly
    const { error: delErr } = await supabase
      .from("orderbook_markets")
      .delete()
      .eq("metric_id", newId);
    if (delErr) throw delErr;
  }

  const payload = { metric_id: newId };
  if (newDesc) payload.description = newDesc;

  const { error } = await supabase
    .from("orderbook_markets")
    .update(payload)
    .eq("metric_id", oldId);
  if (error) throw error;
}

(async () => {
  console.log("🔁 Renaming markets in Supabase...");
  await renameMetric(
    "SILVER_Relayed_Aurora_2025_85969",
    "SILVER_V3",
    "Silver V3 (Relayed)"
  );
  console.log("✅ Renamed to SILVER_V3");

  await renameMetric(
    "SILVER_Relayed_Meridian_2025_85969",
    "SILVER_V4",
    "Silver V4 (Relayed)"
  );
  console.log("✅ Renamed to SILVER_V4");
  console.log("🎉 Rename completed.");
})().catch((e) => {
  console.error("💥 Rename failed:", e);
  process.exit(1);
});





