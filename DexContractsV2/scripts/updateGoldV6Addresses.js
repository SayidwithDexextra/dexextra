const { createClient } = require("@supabase/supabase-js");

async function updateGoldV6Addresses() {
  console.log("🔄 Updating Gold V6 Market with Missing Contract Addresses");
  console.log("=".repeat(60));

  // Supabase configuration
  const supabaseUrl = "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A";

  // Contract addresses discovered from our queries
  const contractAddresses = {
    // Core V2 Infrastructure
    factoryAddress: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
    metricRegistryAddress: "0x8f5200203c53c5821061D1f29249f10A5b57CA6A",
    centralizedVaultAddress: "0x069331Cc5c881db1B1382416b189c198C5a2b356", // Factory acts as vault in V2

    // Market Specific - from successful metric query
    metricId:
      "0x969fdedee7d3e6f70d51189053c4aa60035844e98caa1cfe694825011c1dc997",
    metricName: "Gold Price V6",

    // Supporting Contracts
    collateralTokenAddress: "0x9D2110E6FD055Cf2605dde089FD3734C067dB515", // Mock USDC
    routerAddress: "NO_ROUTER_FOUND", // Not available in this deployment

    // VAMM Address - needs manual extraction from Polygonscan
    vammAddress: "NEEDS_MANUAL_UPDATE_FROM_POLYGONSCAN", // User needs to check Polygonscan

    // Deployment Info
    deploymentTxHash:
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
    console.log("📋 Contract Addresses to Update:");
    console.log(`• Factory: ${contractAddresses.factoryAddress}`);
    console.log(
      `• Metric Registry: ${contractAddresses.metricRegistryAddress}`
    );
    console.log(
      `• Centralized Vault: ${contractAddresses.centralizedVaultAddress}`
    );
    console.log(`• Metric ID: ${contractAddresses.metricId}`);
    console.log(
      `• Collateral Token: ${contractAddresses.collateralTokenAddress}`
    );
    console.log(`• VAMM Address: ${contractAddresses.vammAddress}`);

    // Find the Gold V6 record by transaction hash
    console.log("\n🔍 Finding Gold V6 record in database...");
    const { data: existingRecord, error: findError } = await supabase
      .from("vamm_markets")
      .select("*")
      .eq("transaction_hash", contractAddresses.deploymentTxHash)
      .single();

    if (findError) {
      console.error("❌ Error finding Gold V6 record:", findError);
      return;
    }

    if (!existingRecord) {
      console.log("❌ Gold V6 record not found in database");
      return;
    }

    console.log(`✅ Found Gold V6 record with ID: ${existingRecord.id}`);
    console.log(`   Current Symbol: ${existingRecord.symbol}`);
    console.log(`   Current VAMM: ${existingRecord.vamm_address}`);

    // Prepare update data - only update fields that exist in the schema
    const updateData = {
      // Update vault address to the centralized vault (factory in V2)
      vault_address: contractAddresses.centralizedVaultAddress,

      // Update description to include all the missing addresses
      description: `${existingRecord.description}

🏭 V2 Contract Architecture:
• Factory: ${contractAddresses.factoryAddress}
• Metric Registry: ${contractAddresses.metricRegistryAddress} 
• Centralized Vault: ${contractAddresses.centralizedVaultAddress}
• Metric ID: ${contractAddresses.metricId}
• Collateral Token: ${contractAddresses.collateralTokenAddress}

📊 Deployment Details:
• Block Number: ${contractAddresses.blockNumber}
• Gas Used: ${contractAddresses.gasUsed}
• Settlement Period: 7 days
• Minimum Stake: 10.0 ETH

⚠️ VAMM Address Update Required:
The VAMM address needs to be manually extracted from Polygonscan.
Check: https://polygonscan.com/tx/${contractAddresses.deploymentTxHash}
Look for 'SpecializedVAMMDeployed' event in transaction logs.`,

      // Note: No updated_at field in the schema
    };

    // Update the record
    console.log("\n💾 Updating Gold V6 record with contract addresses...");
    const { data: updateResult, error: updateError } = await supabase
      .from("vamm_markets")
      .update(updateData)
      .eq("id", existingRecord.id)
      .select()
      .single();

    if (updateError) {
      console.error("❌ Error updating Gold V6 record:", updateError);
      return;
    }

    console.log("✅ Successfully updated Gold V6 record!");

    // Also update monitored contracts with detailed descriptions
    console.log("\n📡 Updating monitored contracts with detailed info...");

    // Update Factory contract record
    const factoryUpdateData = {
      description: `V2 MetricVAMM Factory - Core infrastructure contract that manages specialized VAMMs. Also serves as centralized vault. Registry: ${contractAddresses.metricRegistryAddress}, Latest deployment: Gold V6 (${contractAddresses.deploymentTxHash})`,
    };

    await supabase
      .from("monitored_contracts")
      .update(factoryUpdateData)
      .eq("address", contractAddresses.factoryAddress);

    console.log("✅ Updated factory contract description");

    // Update VAMM contract record (even with placeholder address)
    if (
      existingRecord.vamm_address &&
      existingRecord.vamm_address !== "MANUAL_UPDATE_NEEDED"
    ) {
      const vammUpdateData = {
        description: `Gold V6 Metric VAMM - Specialized vAMM for Gold Price V6 metric. Start price: $10, Initial reserves: 1000 ETH. Metric ID: ${contractAddresses.metricId}, Registry: ${contractAddresses.metricRegistryAddress}, Vault: ${contractAddresses.centralizedVaultAddress}`,
      };

      await supabase
        .from("monitored_contracts")
        .update(vammUpdateData)
        .eq("address", existingRecord.vamm_address);

      console.log("✅ Updated VAMM contract description");
    }

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("🎉 GOLD V6 ADDRESS UPDATE COMPLETE!");
    console.log("=".repeat(60));

    console.log("\n📊 Updated Information:");
    console.log(`• Record ID: ${existingRecord.id}`);
    console.log(`• Symbol: ${existingRecord.symbol}`);
    console.log(`• Transaction: ${contractAddresses.deploymentTxHash}`);
    console.log(`• Factory: ${contractAddresses.factoryAddress}`);
    console.log(
      `• Metric Registry: ${contractAddresses.metricRegistryAddress}`
    );
    console.log(
      `• Centralized Vault: ${contractAddresses.centralizedVaultAddress}`
    );
    console.log(`• Metric ID: ${contractAddresses.metricId}`);
    console.log(
      `• Collateral Token: ${contractAddresses.collateralTokenAddress}`
    );

    console.log("\n✅ What's Now Available:");
    console.log("• All V2 contract addresses are documented");
    console.log("• Metric Registry address for metric queries");
    console.log("• Centralized Vault address for vault operations");
    console.log("• Metric ID for trading operations");
    console.log("• Collateral token address for deposits");
    console.log("• Complete deployment information");

    console.log("\n⚠️ Remaining Action Required:");
    console.log("• Get VAMM address from Polygonscan:");
    console.log(
      `  https://polygonscan.com/tx/${contractAddresses.deploymentTxHash}`
    );
    console.log("• Look for 'SpecializedVAMMDeployed' event");
    console.log("• Update vamm_address field in Supabase manually");

    console.log("\n🎯 Why These Addresses Matter:");
    console.log("• Factory: Manages all VAMM deployments and acts as vault");
    console.log("• Metric Registry: Stores and validates all custom metrics");
    console.log("• Metric ID: Unique identifier for Gold V6 metric trading");
    console.log("• Collateral Token: USDC token for margin and settlements");
    console.log("• Router: Not used in V2 (centralized vault architecture)");
  } catch (error) {
    console.error("❌ Failed to update Gold V6 addresses:", error);
    console.log("\n🔧 Troubleshooting:");
    console.log("• Check Supabase connection and credentials");
    console.log("• Verify the transaction hash is correct");
    console.log("• Check if the record exists in vamm_markets table");
  }
}

// Execute the script
updateGoldV6Addresses().catch(console.error);
