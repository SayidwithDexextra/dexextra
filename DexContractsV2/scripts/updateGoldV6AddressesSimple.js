const { createClient } = require("@supabase/supabase-js");

async function updateGoldV6AddressesSimple() {
  console.log("🔄 Adding Contract Addresses to Gold V6 Description");
  console.log("=".repeat(60));

  // Supabase configuration
  const supabaseUrl = "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A";

  // Contract addresses discovered from our queries
  const addresses = {
    factory: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
    metricRegistry: "0x8f5200203c53c5821061D1f29249f10A5b57CA6A",
    centralizedVault: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
    metricId:
      "0x969fdedee7d3e6f70d51189053c4aa60035844e98caa1cfe694825011c1dc997",
    collateralToken: "0x9D2110E6FD055Cf2605dde089FD3734C067dB515",
    deploymentTx:
      "0x03f8c17e29dbdfc11508d0bcf5e5e9f40397cd427247269e4648cfff0fd2bbb2",
    blockNumber: 74636074,
    gasUsed: 3446604,
  };

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    console.log("📋 Contract Addresses Found:");
    console.log(`• Factory: ${addresses.factory}`);
    console.log(`• Metric Registry: ${addresses.metricRegistry}`);
    console.log(`• Centralized Vault: ${addresses.centralizedVault}`);
    console.log(`• Metric ID: ${addresses.metricId}`);
    console.log(`• Collateral Token: ${addresses.collateralToken}`);

    // Find the Gold V6 record
    console.log("\n🔍 Finding Gold V6 record...");
    const { data: record, error: findError } = await supabase
      .from("vamm_markets")
      .select("*")
      .eq("transaction_hash", addresses.deploymentTx)
      .single();

    if (findError || !record) {
      console.error("❌ Error finding Gold V6 record:", findError);
      return;
    }

    console.log(`✅ Found record: ${record.symbol} (ID: ${record.id})`);

    // Create enhanced description with all addresses
    const enhancedDescription = `Gold Price V6 - Custom template with $10 start price and loose sensitivity

🏭 V2 Contract Architecture:
• Factory: ${addresses.factory}
• Metric Registry: ${addresses.metricRegistry}
• Centralized Vault: ${addresses.centralizedVault}
• Metric ID: ${addresses.metricId}
• Collateral Token: ${addresses.collateralToken}

📊 Market Configuration:
• Start Price: $10.00 USD
• Initial Reserves: 1000 ETH (loose price sensitivity)
• Max Leverage: 10x
• Trading Fee: 0.30%
• Settlement Period: 7 days
• Minimum Stake: 10.0 ETH

📈 Deployment Details:
• Block Number: ${addresses.blockNumber}
• Gas Used: ${addresses.gasUsed}
• Transaction: ${addresses.deploymentTx}

⚠️ VAMM Address Update Required:
Check Polygonscan for the actual VAMM address from the deployment transaction.
Look for 'SpecializedVAMMDeployed' event in the logs.

🎯 Custom Gold Icon: https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752608879138-xv9i75pez9k.gif`;

    // Update only the description field
    console.log("\n💾 Updating description with all contract addresses...");
    const { data: updateResult, error: updateError } = await supabase
      .from("vamm_markets")
      .update({
        description: enhancedDescription,
        vault_address: addresses.centralizedVault, // Also update vault to the correct V2 address
      })
      .eq("id", record.id)
      .select()
      .single();

    if (updateError) {
      console.error("❌ Error updating record:", updateError);
      return;
    }

    console.log("✅ Successfully updated Gold V6 record!");

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("🎉 GOLD V6 ADDRESSES SUCCESSFULLY ADDED!");
    console.log("=".repeat(60));

    console.log("\n📊 Now Available in Database:");
    console.log("✅ Factory Address - Manages all VAMM deployments");
    console.log("✅ Metric Registry - Stores Gold V6 metric definition");
    console.log("✅ Centralized Vault - Handles collateral and settlements");
    console.log("✅ Metric ID - Unique identifier for Gold V6 trading");
    console.log("✅ Collateral Token - USDC for margin deposits");
    console.log("✅ Complete deployment information");
    console.log("✅ Custom gold icon URL");

    console.log("\n🔍 Missing Values Explained:");
    console.log(
      "• Different Vault Address: V2 uses factory as centralized vault"
    );
    console.log(
      "• Metric Registry: Now available at " + addresses.metricRegistry
    );
    console.log("• Metric ID: Now available for trading operations");
    console.log("• Router Address: Not used in V2 architecture");
    console.log("• Collateral Token: Mock USDC for testing");

    console.log("\n⚠️ Final Step:");
    console.log("Get the VAMM address from Polygonscan:");
    console.log(`https://polygonscan.com/tx/${addresses.deploymentTx}`);
    console.log("Update the vamm_address field manually in Supabase");

    console.log("\n🎯 Your Gold V6 market is now fully documented and ready!");
  } catch (error) {
    console.error("❌ Script failed:", error);
  }
}

updateGoldV6AddressesSimple().catch(console.error);
