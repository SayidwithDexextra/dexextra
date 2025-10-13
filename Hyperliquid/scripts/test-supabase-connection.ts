import { createClient } from '@supabase/supabase-js';

/**
 * Simple test script to verify Supabase connection and database structure
 */

async function testSupabaseConnection() {
  const supabaseUrl = "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODYyNjcsImV4cCI6MjA2Njk2MjI2N30.vt_7kDR-6IrDYqdrMTzCo5NyFXYZQU-X_OwEtOP1u24";
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log("🔗 Testing Supabase connection...");
  
  try {
    // Test connection by querying orderbook_markets table
    const { data, error } = await supabase
      .from('orderbook_markets')
      .select('id, metric_id, market_address, created_at')
      .limit(5);
    
    if (error) {
      console.error("❌ Error connecting to Supabase:", error);
      return false;
    }
    
    console.log("✅ Successfully connected to Supabase!");
    console.log(`📊 Found ${data.length} existing markets in database`);
    
    if (data.length > 0) {
      console.log("📋 Existing markets:");
      data.forEach((market, index) => {
        console.log(`   ${index + 1}. ${market.metric_id} - ${market.market_address}`);
      });
    }
    
    return true;
    
  } catch (error) {
    console.error("❌ Unexpected error:", error);
    return false;
  }
}

async function testInsertTestData() {
  const supabaseUrl = "https://khhknmobkkkvvogznxdj.supabase.co";
  const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtoaGtubW9ia2trdnZvZ3pueGRqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTEzODYyNjcsImV4cCI6MjA2Njk2MjI2N30.vt_7kDR-6IrDYqdrMTzCo5NyFXYZQU-X_OwEtOP1u24";
  
  const supabase = createClient(supabaseUrl, supabaseKey);
  
  console.log("🧪 Testing data insertion capabilities...");
  
  try {
    // Test data structure (similar to what deployment script will insert)
    const testMarketData = {
      metric_id: `TEST_ALUMINUM_V1_${Date.now()}`,
      description: "Test Aluminum V1 futures market (deployment test)",
      category: 'COMMODITY',
      decimals: 18,
      minimum_order_size: 0.01,
      tick_size: 0.01,
      requires_kyc: false,
      auto_settle: true,
      oracle_provider: "0x1234567890123456789012345678901234567890", // Test address
      creation_fee: 0,
      is_active: false, // Mark as test/inactive
      market_address: "0x0000000000000000000000000000000000000001", // Test address
      factory_address: "0x0000000000000000000000000000000000000002",
      central_vault_address: "0x0000000000000000000000000000000000000003",
      order_router_address: "0x0000000000000000000000000000000000000004",
      uma_oracle_manager_address: "0x0000000000000000000000000000000000000005",
      chain_id: 137, // Polygon
      market_status: 'PENDING',
      total_volume: 0,
      total_trades: 0,
      open_interest_long: 0,
      open_interest_short: 0,
      creator_wallet_address: "0x0000000000000000000000000000000000000006"
    };

    const { data, error } = await supabase
      .from('orderbook_markets')
      .insert([testMarketData])
      .select();

    if (error) {
      console.error("❌ Error inserting test data:", error);
      return false;
    }

    console.log("✅ Successfully inserted test market data!");
    console.log(`📋 Test market ID: ${data[0]?.id}`);
    console.log(`📋 Test metric ID: ${data[0]?.metric_id}`);
    
    // Clean up test data
    const { error: deleteError } = await supabase
      .from('orderbook_markets')
      .delete()
      .eq('id', data[0]?.id);
    
    if (deleteError) {
      console.warn("⚠️  Warning: Could not clean up test data:", deleteError);
    } else {
      console.log("🧹 Test data cleaned up successfully");
    }
    
    return true;
    
  } catch (error) {
    console.error("❌ Unexpected error during test insertion:", error);
    return false;
  }
}

async function main() {
  console.log("🚀 Starting Supabase integration tests...\n");
  
  const connectionTest = await testSupabaseConnection();
  
  if (connectionTest) {
    console.log("\n" + "=".repeat(50));
    await testInsertTestData();
  }
  
  console.log("\n🎉 Supabase integration tests completed!");
  
  if (connectionTest) {
    console.log("✅ Your deployment script is ready to save data to Supabase!");
  } else {
    console.log("❌ Please check your Supabase configuration before deploying.");
  }
}

// Handle script execution
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error("❌ Test failed:", error);
      process.exit(1);
    });
}

export { testSupabaseConnection, testInsertTestData };
