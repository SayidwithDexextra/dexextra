/**
 * Fix Router Addresses in Supabase Database
 *
 * This script updates all empty router_address fields in the vamm_markets table
 * with the correct DexV2 router address.
 */

const { createClient } = require("@supabase/supabase-js");

// Configuration
const SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  "https://khhknmobkkkvvogznxdj.supabase.co";
const SUPABASE_SERVICE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A";

// DexV2 Router Address (from CONTRACT_ADDRESSES)
const DEXV2_ROUTER_ADDRESS = "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5";

async function fixRouterAddresses() {
  console.log("🔧 Fixing Router Addresses in Supabase Database");
  console.log("=".repeat(60));

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    // 1. First, check how many records need updating
    const { data: emptyRouterRecords, error: checkError } = await supabase
      .from("vamm_markets")
      .select("id, symbol, router_address")
      .or("router_address.is.null,router_address.eq.");

    if (checkError) {
      throw new Error(`Failed to check records: ${checkError.message}`);
    }

    console.log(
      `📊 Found ${emptyRouterRecords.length} records with empty router addresses:`
    );
    emptyRouterRecords.forEach((record) => {
      console.log(`  - ${record.symbol} (ID: ${record.id.substring(0, 8)}...)`);
    });

    if (emptyRouterRecords.length === 0) {
      console.log("✅ All records already have router addresses!");
      return;
    }

    // 2. Update all records with empty router addresses
    console.log(
      `\n🔄 Updating ${emptyRouterRecords.length} records with router address: ${DEXV2_ROUTER_ADDRESS}`
    );

    const { data: updatedRecords, error: updateError } = await supabase
      .from("vamm_markets")
      .update({
        router_address: DEXV2_ROUTER_ADDRESS,
        updated_at: new Date().toISOString(),
      })
      .or("router_address.is.null,router_address.eq.")
      .select("id, symbol, router_address");

    if (updateError) {
      throw new Error(`Failed to update records: ${updateError.message}`);
    }

    console.log(`✅ Successfully updated ${updatedRecords.length} records!`);

    // 3. Verify the updates
    console.log("\n📋 Updated Records:");
    updatedRecords.forEach((record) => {
      console.log(`  ✅ ${record.symbol}: ${record.router_address}`);
    });

    // 4. Final verification - check if any records still have empty router addresses
    const { data: remainingEmpty, error: verifyError } = await supabase
      .from("vamm_markets")
      .select("id, symbol")
      .or("router_address.is.null,router_address.eq.");

    if (verifyError) {
      console.warn(`⚠️ Failed to verify updates: ${verifyError.message}`);
    } else if (remainingEmpty.length > 0) {
      console.warn(
        `⚠️ Warning: ${remainingEmpty.length} records still have empty router addresses`
      );
    } else {
      console.log("\n🎉 All router addresses have been successfully updated!");
    }
  } catch (error) {
    console.error("❌ Error fixing router addresses:", error);
    process.exit(1);
  }
}

// Run the script
if (require.main === module) {
  fixRouterAddresses()
    .then(() => {
      console.log("\n✅ Router address fix completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Script failed:", error);
      process.exit(1);
    });
}

module.exports = { fixRouterAddresses };
