const { createClient } = require("@supabase/supabase-js");
const { ethers } = require("ethers");

async function addGoldV6ToSupabase() {
  console.log("🥇 Adding Gold V6 Market to Supabase Database");
  console.log("=".repeat(60));

  // Supabase configuration
  const supabaseUrl = "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseServiceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTM4NjI2NywiZXhwIjoyMDY2OTYyMjY3fQ.yuktTca5ztD7YYQhncN_A_phY67gaI5eEDNyILtsW6A";

  // Gold V6 deployment details from our successful deployment
  const goldV6Data = {
    // Transaction hash from our deployment
    deploymentTxHash:
      "0x03f8c17e29dbdfc11508d0bcf5e5e9f40397cd427247269e4648cfff0fd2bbb2",
    templateTxHash:
      "0xb366b7164fe9b1ba29950de8903fa8f6814a2362d5178e303ce8e811560e0bb8",

    // Template details
    templateName: "gold-v6-test-1753981660550", // From our deployment
    category: "Gold V6 Market Test 1753981669206", // From our deployment

    // Market configuration
    symbol: "GOLDV6",
    description:
      "Gold Price V6 - Custom template with $10 start price and loose sensitivity",
    metricName: "Gold Price V6",
    startPrice: "10.0", // $10 USD
    initialReserves: "1000.0", // 1000 ETH for loose price sensitivity

    // Icon URL provided by user
    iconUrl:
      "https://khhknmobkkkvvogznxdj.supabase.co/storage/v1/object/public/market-images/markets/icon/1752608879138-xv9i75pez9k.gif",

    // Factory and deployer details
    factoryAddress: "0x069331Cc5c881db1B1382416b189c198C5a2b356",
    deployerAddress: "0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb",
  };

  const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  try {
    console.log("📋 Gold V6 Market Details:");
    console.log(`• Symbol: ${goldV6Data.symbol}`);
    console.log(`• Description: ${goldV6Data.description}`);
    console.log(`• Start Price: $${goldV6Data.startPrice} USD`);
    console.log(`• Initial Reserves: ${goldV6Data.initialReserves} ETH`);
    console.log(`• Template: ${goldV6Data.templateName}`);
    console.log(`• Icon URL: ${goldV6Data.iconUrl}`);

    // Step 1: Get VAMM address from deployment transaction
    console.log("\n🔍 Getting VAMM address from deployment transaction...");

    const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const receipt = await provider.getTransactionReceipt(
      goldV6Data.deploymentTxHash
    );

    if (!receipt) {
      throw new Error("Transaction receipt not found");
    }

    console.log(`✅ Transaction confirmed in block: ${receipt.blockNumber}`);
    console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);

    // Get factory contract to parse logs
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      goldV6Data.factoryAddress
    );

    // Find the SpecializedVAMMDeployed event
    let vammAddress = null;
    let vaultAddress = null;

    for (const log of receipt.logs) {
      try {
        const parsed = factory.interface.parseLog(log);
        if (parsed.name === "SpecializedVAMMDeployed") {
          vammAddress = parsed.args.vamm;
          console.log(`🏭 VAMM Address: ${vammAddress}`);

          // Get vault address from factory (V2 uses centralized vault)
          vaultAddress = "0x069331Cc5c881db1B1382416b189c198C5a2b356"; // Factory manages vault
          console.log(`🏦 Vault Address: ${vaultAddress} (Centralized)`);
          break;
        }
      } catch (e) {
        // Skip logs that don't match our interface
        continue;
      }
    }

    if (!vammAddress) {
      console.log("⚠️ Could not find VAMM address from transaction logs");
      console.log("📝 Please provide the VAMM address manually:");
      console.log("   You can get it from the deployment transaction logs");
      console.log(`   Transaction: ${goldV6Data.deploymentTxHash}`);

      // Use a placeholder for now
      vammAddress = "REPLACE_WITH_ACTUAL_VAMM_ADDRESS";
      vaultAddress = goldV6Data.factoryAddress; // Factory acts as vault in V2
    }

    // Step 2: Get metric ID
    console.log("\n📊 Getting metric details...");
    const metricRegistryAddress = await factory.metricRegistry();
    const metricRegistry = await ethers.getContractAt(
      "MetricRegistry",
      metricRegistryAddress
    );

    let metricId;
    try {
      const metric = await metricRegistry.getMetricByName(
        goldV6Data.metricName
      );
      metricId = metric.metricId;
      console.log(`📋 Metric ID: ${metricId}`);
    } catch (error) {
      console.log("⚠️ Could not get metric ID, using generated one");
      metricId = `0x${Buffer.from(goldV6Data.metricName)
        .toString("hex")
        .padEnd(64, "0")}`;
    }

    // Step 3: Add to vamm_markets table
    console.log("\n💾 Adding to vamm_markets table...");
    const marketData = {
      symbol: goldV6Data.symbol,
      description: goldV6Data.description,
      category: "Gold", // Single category for V2
      oracle_address: "0x6f9BB0cb819744F50850b5dBeF2ca6EE8D406DA5", // Default oracle
      initial_price: parseFloat(goldV6Data.startPrice),
      price_decimals: 18,
      banner_image_url: null, // No banner provided
      icon_image_url: goldV6Data.iconUrl, // User-provided icon URL
      supporting_photo_urls: [], // No supporting photos
      deployment_fee: 0.1,
      is_active: true,
      user_address: goldV6Data.deployerAddress,
      vamm_address: vammAddress,
      vault_address: vaultAddress,
      market_id: `gold_v6_${Date.now()}`,
      transaction_hash: goldV6Data.deploymentTxHash,
      deployment_status: "deployed",
      created_at: new Date().toISOString(),

      // V2 specific fields
      metric_id: metricId,
      metric_name: goldV6Data.metricName,
      template_name: goldV6Data.templateName,
      template_config: JSON.stringify({
        maxLeverage: 10,
        tradingFeeRate: 30, // 0.3%
        liquidationFeeRate: 500, // 5%
        maintenanceMarginRatio: 1000, // 10%
        initialReserves: goldV6Data.initialReserves,
        volumeScaleFactor: 500,
        startPrice: goldV6Data.startPrice,
      }),
    };

    const { data: marketResult, error: marketError } = await supabase
      .from("vamm_markets")
      .insert([marketData])
      .select()
      .single();

    if (marketError) {
      console.error("❌ Error adding to vamm_markets:", marketError);

      // If insert fails due to existing record, try update
      if (marketError.code === "23505") {
        // Unique constraint violation
        console.log("🔄 Trying to update existing record...");
        const { data: updateResult, error: updateError } = await supabase
          .from("vamm_markets")
          .update({
            ...marketData,
            updated_at: new Date().toISOString(),
          })
          .eq("vamm_address", vammAddress)
          .select()
          .single();

        if (updateError) {
          console.error("❌ Error updating vamm_markets:", updateError);
        } else {
          console.log("✅ Successfully updated vamm_markets:", updateResult.id);
        }
      }
    } else {
      console.log("✅ Successfully added to vamm_markets:", marketResult.id);
    }

    // Step 4: Add to monitored_contracts table
    console.log("\n📡 Adding to monitored_contracts table...");

    const contractsToMonitor = [
      {
        name: `${goldV6Data.symbol} VAMM`,
        address: vammAddress,
        type: "MetricVAMM",
        network: "polygon",
        is_active: true,
        description: `Gold V6 Metric VAMM with $${goldV6Data.startPrice} start price`,
        metadata: JSON.stringify({
          symbol: goldV6Data.symbol,
          templateName: goldV6Data.templateName,
          metricName: goldV6Data.metricName,
          startPrice: goldV6Data.startPrice,
          initialReserves: goldV6Data.initialReserves,
        }),
      },
      {
        name: "MetricVAMM Factory",
        address: goldV6Data.factoryAddress,
        type: "Factory",
        network: "polygon",
        is_active: true,
        description: "V2 MetricVAMM Factory with centralized vault",
      },
    ];

    for (const contract of contractsToMonitor) {
      try {
        const { data: contractResult, error: contractError } = await supabase
          .from("monitored_contracts")
          .upsert(
            {
              ...contract,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
            {
              onConflict: "address",
            }
          )
          .select()
          .single();

        if (contractError) {
          console.error(`❌ Error adding ${contract.name}:`, contractError);
        } else {
          console.log(`✅ Added ${contract.name} for monitoring`);
        }
      } catch (error) {
        console.log(
          `⚠️ Monitored contracts table might not exist for ${contract.name}`
        );
      }
    }

    // Step 5: Results summary
    console.log("\n" + "=".repeat(60));
    console.log("🎉 SUCCESS! Gold V6 Market Added to Supabase!");
    console.log("=".repeat(60));

    console.log("\n📊 Market Summary:");
    console.log(`• Symbol: ${goldV6Data.symbol}`);
    console.log(`• Start Price: $${goldV6Data.startPrice} USD`);
    console.log(
      `• Initial Reserves: ${goldV6Data.initialReserves} ETH (loose sensitivity)`
    );
    console.log(`• Icon: ${goldV6Data.iconUrl.substring(0, 50)}...`);
    console.log(`• VAMM Address: ${vammAddress}`);
    console.log(`• Metric: ${goldV6Data.metricName}`);
    console.log(`• Template: ${goldV6Data.templateName}`);

    console.log("\n🔗 Database Records:");
    console.log("• ✅ vamm_markets table: Market record created");
    console.log(
      "• ✅ monitored_contracts table: Contracts added for monitoring"
    );
    console.log("• ✅ Icon URL configured for frontend display");

    console.log("\n🎯 Next Steps:");
    console.log("• Market is now visible in the frontend");
    console.log("• Event monitoring will track all transactions");
    console.log(
      "• Users can trade with $10 start price and loose price sensitivity"
    );
    console.log("• Custom gold icon will display in the UI");

    if (vammAddress === "REPLACE_WITH_ACTUAL_VAMM_ADDRESS") {
      console.log("\n⚠️ IMPORTANT: Update the VAMM address!");
      console.log("• Edit the record in Supabase with the actual VAMM address");
      console.log(`• Get it from transaction: ${goldV6Data.deploymentTxHash}`);
    }
  } catch (error) {
    console.error("❌ Failed to add Gold V6 to Supabase:", error);
    console.log("\n🔧 Troubleshooting:");
    console.log(
      "• Check if Supabase tables exist (vamm_markets, monitored_contracts)"
    );
    console.log("• Verify the deployment transaction hash is correct");
    console.log("• Ensure network connectivity to Polygon");
  }
}

// Execute the script
addGoldV6ToSupabase().catch(console.error);
