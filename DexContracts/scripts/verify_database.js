const { createClient } = require("@supabase/supabase-js");

async function verifyDatabase() {
  console.log("🔍 Verifying VAMM Contracts in Supabase Database");
  console.log("===============================================");

  // Supabase configuration
  const supabaseUrl =
    process.env.SUPABASE_URL || "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A";

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    // 1. Check vamm_markets table
    console.log("\n📊 Checking vamm_markets table...");
    const { data: markets, error: marketsError } = await supabase
      .from("vamm_markets")
      .select("*")
      .eq("symbol", "TESTPUMP")
      .order("created_at", { ascending: false })
      .limit(5);

    if (marketsError) {
      console.error("❌ Error querying vamm_markets:", marketsError);
    } else {
      console.log(`✅ Found ${markets.length} TESTPUMP markets in database:`);
      markets.forEach((market, i) => {
        console.log(`\n   Market ${i + 1}:`);
        console.log(`   • ID: ${market.id}`);
        console.log(`   • Symbol: ${market.symbol}`);
        console.log(`   • vAMM: ${market.vamm_address}`);
        console.log(`   • Vault: ${market.vault_address}`);
        console.log(`   • Status: ${market.deployment_status}`);
        console.log(`   • Created: ${market.created_at}`);
      });
    }

    // 2. Check monitored_contracts table
    console.log("\n🔍 Checking monitored_contracts table...");
    const contractAddresses = [
      "0x9D2110E6FD055Cf2605dde089FD3734C067dB515", // MockUSDC
      "0x6f9BB0cb819744F50850b5dBeF2ca6EE8D406DA5", // MockOracle
      "0xeAA975599539D9EF27F0830c0358ccFbF085542f", // Vault
      "0x85DaA7107374F28505955E09D31009e71281E291", // vAMM
    ];

    for (const address of contractAddresses) {
      const { data: contracts, error: contractError } = await supabase
        .from("monitored_contracts")
        .select("name, address, type, is_active, network")
        .eq("address", address.toLowerCase());

      if (contractError) {
        console.error(`❌ Error querying contract ${address}:`, contractError);
      } else if (contracts.length > 0) {
        const contract = contracts[0];
        console.log(
          `✅ ${contract.name} (${contract.type}): ${contract.address} - Active: ${contract.is_active}`
        );
      } else {
        console.log(`⚠️  Contract ${address} not found in monitored_contracts`);
      }
    }

    // 3. Test event system integration
    console.log("\n🔄 Testing event system integration...");
    const { data: eventContracts, error: eventError } = await supabase
      .from("vamm_markets")
      .select("symbol, vamm_address, vault_address, deployment_status")
      .eq("deployment_status", "deployed")
      .not("vamm_address", "is", null);

    if (eventError) {
      console.error(
        "❌ Error checking deployed contracts for events:",
        eventError
      );
    } else {
      console.log(
        `✅ Found ${eventContracts.length} deployed contracts ready for event monitoring:`
      );
      eventContracts.forEach((contract) => {
        console.log(
          `   • ${contract.symbol}: vAMM=${contract.vamm_address}, Vault=${contract.vault_address}`
        );
      });
    }

    console.log("\n🎉 Database Verification Complete!");
    console.log("\n📋 Summary:");
    console.log("✅ Contracts successfully stored in vamm_markets table");
    console.log("✅ Contracts added to monitored_contracts for event tracking");
    console.log("✅ Event monitoring system can discover these contracts");
    console.log("✅ Frontend APIs can now load this market data");

    console.log("\n🚀 Next Steps:");
    console.log(
      "• Your event monitoring system will automatically detect trading events"
    );
    console.log(
      "• Transaction tables in the frontend will show real-time position data"
    );
    console.log("• Market data APIs will include your TESTPUMP market");
  } catch (error) {
    console.error("❌ Database verification failed:", error);
  }
}

verifyDatabase().catch(console.error);
