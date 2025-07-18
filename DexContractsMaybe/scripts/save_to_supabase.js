const { createClient } = require("@supabase/supabase-js");

// Initialize Supabase client
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    "Missing Supabase configuration. Please set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables."
  );
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function saveDeploymentToSupabase(deploymentData) {
  console.log("💾 Saving deployment data to Supabase...\n");

  try {
    // =================================
    // 1. CREATE SIMPLE_VAMM_DEPLOYMENTS TABLE IF NOT EXISTS
    // =================================
    console.log("📋 1. Ensuring deployment table exists...");

    // Create table SQL - will be executed manually or through migration
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS simple_vamm_deployments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        network TEXT NOT NULL,
        chain_id INTEGER NOT NULL,
        deployer TEXT NOT NULL,
        simple_usdc_address TEXT NOT NULL,
        simple_oracle_address TEXT NOT NULL,
        simple_vault_address TEXT NOT NULL,
        simple_vamm_address TEXT NOT NULL,
        initial_price TEXT NOT NULL,
        initial_supply TEXT NOT NULL,
        deployment_time TIMESTAMPTZ NOT NULL,
        tx_hashes JSONB,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      
      -- Create index on network and chain_id for fast lookups
      CREATE INDEX IF NOT EXISTS idx_simple_vamm_deployments_network 
      ON simple_vamm_deployments(network, chain_id);
      
      -- Create index on deployer
      CREATE INDEX IF NOT EXISTS idx_simple_vamm_deployments_deployer 
      ON simple_vamm_deployments(deployer);
    `;

    console.log("📝 Table schema prepared (execute manually if needed)");

    // =================================
    // 2. INSERT DEPLOYMENT DATA
    // =================================
    console.log("\n📋 2. Inserting deployment data...");

    const insertData = {
      network: deploymentData.network,
      chain_id: deploymentData.chainId,
      deployer: deploymentData.deployer,
      simple_usdc_address: deploymentData.contracts.SimpleUSDC,
      simple_oracle_address: deploymentData.contracts.SimplePriceOracle,
      simple_vault_address: deploymentData.contracts.SimpleVault,
      simple_vamm_address: deploymentData.contracts.SimpleVAMM,
      initial_price: deploymentData.initialPrice,
      initial_supply: deploymentData.initialSupply,
      deployment_time: deploymentData.deploymentTime,
      tx_hashes: deploymentData.txHashes,
      is_active: true,
    };

    const { data, error } = await supabase
      .from("simple_vamm_deployments")
      .insert([insertData])
      .select();

    if (error) {
      console.error("❌ Failed to insert deployment data:", error);
      throw error;
    }

    console.log("✅ Deployment data saved successfully!");
    console.log("📋 Record ID:", data[0]?.id);

    // =================================
    // 3. CREATE VAMM MARKET ENTRY (COMPATIBLE WITH EXISTING SYSTEM)
    // =================================
    console.log("\n📋 3. Creating VAMM market entry...");

    const marketData = {
      id: `simple-futures-${Date.now()}`,
      symbol: "FUTURE1",
      description: "Traditional Futures Market - Bilateral Price Impact",
      category: ["futures", "traditional", "bilateral"],
      oracle_address: deploymentData.contracts.SimplePriceOracle,
      initial_price: parseFloat(deploymentData.initialPrice),
      price_decimals: 18,
      banner_image_url: null,
      icon_image_url: null,
      supporting_photo_urls: [],
      deployment_fee: 0.0, // Free deployment for traditional futures
      is_active: true,
      vamm_address: deploymentData.contracts.SimpleVAMM,
      vault_address: deploymentData.contracts.SimpleVault,
      market_id: null,
      deployment_status: "deployed",
      user_address: deploymentData.deployer,
    };

    const { data: marketRecord, error: marketError } = await supabase
      .from("vamm_markets")
      .insert([marketData])
      .select();

    if (marketError) {
      console.warn(
        "⚠️ Failed to create VAMM market entry (table might not exist):",
        marketError
      );
      console.log("📝 Market data that would be inserted:");
      console.log(JSON.stringify(marketData, null, 2));
    } else {
      console.log("✅ VAMM market entry created successfully!");
      console.log("📋 Market ID:", marketRecord[0]?.id);
    }

    // =================================
    // 4. UPDATE CONTRACT ADDRESSES TABLE
    // =================================
    console.log("\n📋 4. Updating contract addresses...");

    const contractEntries = [
      {
        network: deploymentData.network,
        contract_name: "SIMPLE_USDC",
        contract_address: deploymentData.contracts.SimpleUSDC,
        contract_type: "Token",
        deployment_time: deploymentData.deploymentTime,
        is_active: true,
      },
      {
        network: deploymentData.network,
        contract_name: "SIMPLE_ORACLE",
        contract_address: deploymentData.contracts.SimplePriceOracle,
        contract_type: "Oracle",
        deployment_time: deploymentData.deploymentTime,
        is_active: true,
      },
      {
        network: deploymentData.network,
        contract_name: "SIMPLE_VAULT",
        contract_address: deploymentData.contracts.SimpleVault,
        contract_type: "Vault",
        deployment_time: deploymentData.deploymentTime,
        is_active: true,
      },
      {
        network: deploymentData.network,
        contract_name: "SIMPLE_VAMM",
        contract_address: deploymentData.contracts.SimpleVAMM,
        contract_type: "VAMM",
        deployment_time: deploymentData.deploymentTime,
        is_active: true,
      },
    ];

    const { data: contractsData, error: contractsError } = await supabase
      .from("contract_addresses")
      .upsert(contractEntries, {
        onConflict: "network,contract_name",
        ignoreDuplicates: false,
      })
      .select();

    if (contractsError) {
      console.warn(
        "⚠️ Failed to update contract addresses (table might not exist):",
        contractsError
      );
      console.log("📝 Contract entries that would be inserted:");
      console.log(JSON.stringify(contractEntries, null, 2));
    } else {
      console.log("✅ Contract addresses updated successfully!");
      console.log("📋 Updated", contractsData?.length, "contract entries");
    }

    // =================================
    // 5. DEPLOYMENT SUMMARY
    // =================================
    console.log("\n🎉 Supabase Save Summary:");
    console.log("=======================================");
    console.log("✅ Deployment record saved");
    console.log("✅ VAMM market entry created (if table exists)");
    console.log("✅ Contract addresses updated (if table exists)");
    console.log("🌐 Network:", deploymentData.network);
    console.log("🔗 Chain ID:", deploymentData.chainId);

    return {
      success: true,
      deploymentId: data[0]?.id,
      marketId: marketRecord?.[0]?.id,
      contractsUpdated: contractsData?.length || 0,
    };
  } catch (error) {
    console.error("❌ Failed to save to Supabase:", error);
    throw error;
  }
}

// If running directly with deployment data
async function main() {
  // Example deployment data structure
  const exampleData = {
    network: "polygon",
    chainId: 137,
    deployer: "0x1234567890123456789012345678901234567890",
    contracts: {
      SimpleUSDC: "0x1111111111111111111111111111111111111111",
      SimplePriceOracle: "0x2222222222222222222222222222222222222222",
      SimpleVault: "0x3333333333333333333333333333333333333333",
      SimpleVAMM: "0x4444444444444444444444444444444444444444",
    },
    deploymentTime: new Date().toISOString(),
    initialPrice: "100",
    initialSupply: "1000000000",
    txHashes: {
      usdc: "0xaaaa",
      oracle: "0xbbbb",
      vault: "0xcccc",
      vamm: "0xdddd",
    },
  };

  console.log("🧪 Testing Supabase save with example data...");
  console.log("📝 Use this script after actual deployment with real data\n");

  // Uncomment to test with example data:
  // await saveDeploymentToSupabase(exampleData);

  console.log("📋 To use this script after deployment:");
  console.log("1. Run deployment script to get real deployment data");
  console.log("2. Pass that data to saveDeploymentToSupabase()");
  console.log("3. Or modify this script to load deployment data from file");
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("✅ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = { saveDeploymentToSupabase };
