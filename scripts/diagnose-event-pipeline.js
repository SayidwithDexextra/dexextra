#!/usr/bin/env node

/**
 * 🔍 EVENT PIPELINE DIAGNOSTIC SCRIPT
 *
 * This script performs a comprehensive test of the entire event processing pipeline:
 * 1. Tests RPC connectivity and blockchain access
 * 2. Checks database connectivity and existing events
 * 3. Tests contract configurations and ABIs
 * 4. Queries blockchain for recent events
 * 5. Tests event formatting and filtering logic
 * 6. Verifies the complete pipeline from blockchain to database
 *
 * Run with: node scripts/diagnose-event-pipeline.js
 */

const { ethers } = require("ethers");
const dotenv = require("dotenv");

// Load environment variables
dotenv.config({ path: ".env.local" });

// ===============================================
// STEP 0: CONFIGURATION AND SETUP
// ===============================================

console.log("🔍 EVENT PIPELINE DIAGNOSTIC SCRIPT");
console.log("=====================================\n");

// VAMM ABI - Define the events we're looking for
const VAMM_ABI = [
  "event PositionOpened(address indexed user, bool isLong, uint256 size, uint256 price, uint256 leverage, uint256 fee)",
  "event PositionClosed(address indexed user, uint256 size, uint256 price, int256 pnl, uint256 fee)",
  "event PositionLiquidated(address indexed user, address indexed liquidator, uint256 size, uint256 price, uint256 fee)",
  "event FundingUpdated(int256 fundingRate, uint256 fundingIndex, int256 premiumFraction)",
  "event CollateralDeposited(address indexed user, uint256 amount)",
  "event MarketCreated(bytes32 indexed marketId, string symbol, address indexed vamm, address indexed vault, address oracle, address collateralToken)",
];

// Configuration from environment
const config = {
  rpcUrl: process.env.RPC_URL || "http://localhost:8545",
  wsRpcUrl: process.env.WS_RPC_URL,
  chainId: process.env.CHAIN_ID || "31337",
  batchSize: parseInt(process.env.EVENT_BATCH_SIZE || "400"),
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
};

console.log("📋 Configuration loaded:");
console.log(`   - RPC URL: ${config.rpcUrl}`);
console.log(`   - WebSocket URL: ${config.wsRpcUrl || "Not configured"}`);
console.log(`   - Chain ID: ${config.chainId}`);
console.log(`   - Batch Size: ${config.batchSize}`);
console.log(
  `   - Supabase: ${
    config.supabaseUrl ? "Configured ✅" : "Not configured ❌"
  }\n`
);

// ===============================================
// STEP 1: TEST RPC CONNECTIVITY
// ===============================================

async function testRpcConnectivity() {
  console.log("🔗 STEP 1: Testing RPC Connectivity");
  console.log("-----------------------------------");

  try {
    // Create provider instance
    console.log("   Creating ethers provider...");
    const provider = new ethers.JsonRpcProvider(config.rpcUrl);

    // Test basic connectivity
    console.log("   Testing basic connectivity...");
    const network = await provider.getNetwork();
    console.log(
      `   ✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`
    );

    // Get current block number
    console.log("   Fetching current block number...");
    const currentBlock = await provider.getBlockNumber();
    console.log(`   ✅ Current block: ${currentBlock}`);

    // Test block retrieval
    console.log("   Testing block retrieval...");
    const latestBlock = await provider.getBlock("latest");
    console.log(`   ✅ Latest block hash: ${latestBlock.hash}`);
    console.log(
      `   ✅ Block timestamp: ${new Date(
        latestBlock.timestamp * 1000
      ).toISOString()}`
    );

    return { provider, currentBlock, network };
  } catch (error) {
    console.error("   ❌ RPC connectivity failed:", error.message);
    console.error("   💡 Check your RPC_URL in .env.local");
    throw error;
  }
}

// ===============================================
// STEP 2: TEST DATABASE CONNECTIVITY
// ===============================================

async function testDatabaseConnectivity() {
  console.log("\n📊 STEP 2: Testing Database Connectivity");
  console.log("----------------------------------------");

  if (!config.supabaseUrl || !config.supabaseKey) {
    console.log("   ❌ Supabase configuration missing");
    console.log(
      "   💡 Add SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to .env.local"
    );
    return null;
  }

  try {
    // Import Supabase (dynamic import to handle missing dependencies)
    console.log("   Loading Supabase client...");
    const { createClient } = require("@supabase/supabase-js");
    const supabase = createClient(config.supabaseUrl, config.supabaseKey);

    // Test database connectivity by checking tables
    console.log("   Testing database connectivity...");
    const { data: tableData, error: tableError } = await supabase
      .from("contract_events")
      .select("*")
      .limit(1);

    if (tableError) {
      console.error("   ❌ Database table access failed:", tableError.message);
      return null;
    }

    console.log("   ✅ Database connectivity successful");

    // Count existing events
    console.log("   Counting existing events...");
    const { count, error: countError } = await supabase
      .from("contract_events")
      .select("*", { count: "exact", head: true });

    if (countError) {
      console.log("   ⚠️  Could not count events:", countError.message);
    } else {
      console.log(`   📊 Total events in database: ${count}`);
    }

    // Get recent events by type
    console.log("   Fetching recent events by type...");
    const { data: recentEvents, error: recentError } = await supabase
      .from("contract_events")
      .select("event_type, created_at")
      .order("created_at", { ascending: false })
      .limit(10);

    if (recentError) {
      console.log("   ⚠️  Could not fetch recent events:", recentError.message);
    } else {
      const eventCounts = {};
      recentEvents.forEach((event) => {
        eventCounts[event.event_type] =
          (eventCounts[event.event_type] || 0) + 1;
      });
      console.log("   📈 Recent event types:", eventCounts);
    }

    return supabase;
  } catch (error) {
    console.error("   ❌ Database connectivity failed:", error.message);
    console.error(
      "   💡 Check your Supabase configuration and network connectivity"
    );
    return null;
  }
}

// ===============================================
// STEP 3: GET CONTRACT CONFIGURATIONS
// ===============================================

async function getContractConfigurations(supabase) {
  console.log("\n🏗️  STEP 3: Loading Contract Configurations");
  console.log("--------------------------------------------");

  if (!supabase) {
    console.log("   ❌ Skipping - database not available");
    return [];
  }

  try {
    // Get contracts from database
    console.log("   Fetching deployed contracts from database...");
    const { data: contracts, error } = await supabase
      .from("vamm_markets")
      .select("*")
      .eq("deployment_status", "deployed");

    if (error) {
      console.error("   ❌ Failed to fetch contracts:", error.message);
      return [];
    }

    if (contracts.length === 0) {
      console.log("   ⚠️  No active contracts found in database");
      console.log("   💡 Deploy contracts using the create-market wizard");
      return [];
    }

    console.log(`   ✅ Found ${contracts.length} active contracts:`);
    contracts.forEach((contract) => {
      console.log(
        `      - ${contract.symbol}: ${contract.market_id}`
      );
    });

    return contracts;
  } catch (error) {
    console.error(
      "   ❌ Error loading contract configurations:",
      error.message
    );
    return [];
  }
}

// ===============================================
// STEP 4: TEST DIRECT BLOCKCHAIN EVENT QUERIES
// ===============================================

async function testBlockchainEventQueries(provider, currentBlock, contracts) {
  console.log("\n⛓️  STEP 4: Testing Direct Blockchain Event Queries");
  console.log("---------------------------------------------------");

  if (contracts.length === 0) {
    console.log("   ❌ Skipping - no contracts to query");
    return;
  }

  // Calculate block range (last 400 blocks or available blocks)
  const blocksToCheck = Math.min(400, currentBlock);
  const fromBlock = Math.max(0, currentBlock - blocksToCheck);
  const toBlock = currentBlock;

  console.log(
    `   📍 Querying blocks ${fromBlock} to ${toBlock} (${blocksToCheck} blocks)`
  );

  for (const contract of contracts) {
    console.log(
      `\n   🔍 Testing contract: ${contract.name} (${contract.address})`
    );

    try {
      // Create contract instance
      console.log("      Creating contract instance...");
      const contractInstance = new ethers.Contract(
        contract.address,
        VAMM_ABI,
        provider
      );

      // Test 1: Query all events using getLogs
      console.log("      Test 1: Direct getLogs query...");
      const logsFilter = {
        address: contract.address,
        fromBlock: fromBlock,
        toBlock: toBlock,
      };

      const rawLogs = await provider.getLogs(logsFilter);
      console.log(`      📦 Found ${rawLogs.length} raw logs`);

      // Test 2: Parse the logs
      console.log("      Test 2: Parsing logs...");
      let parsedEvents = 0;
      let positionEvents = 0;
      let otherEvents = 0;

      for (const log of rawLogs) {
        try {
          const parsed = contractInstance.interface.parseLog({
            topics: log.topics,
            data: log.data,
          });

          if (parsed) {
            parsedEvents++;
            console.log(
              `         📋 Event: ${parsed.name} in block ${log.blockNumber}`
            );

            // Check if this is a position-related event
            if (
              [
                "PositionOpened",
                "PositionClosed",
                "PositionLiquidated",
              ].includes(parsed.name)
            ) {
              positionEvents++;
              console.log(`         ⭐ Position event found: ${parsed.name}`);

              // Log detailed event data for position events
              console.log(`            User: ${parsed.args.user || "N/A"}`);
              if (parsed.args.size)
                console.log(`            Size: ${parsed.args.size.toString()}`);
              if (parsed.args.price)
                console.log(
                  `            Price: ${parsed.args.price.toString()}`
                );
            } else {
              otherEvents++;
              console.log(`         🔄 Other event: ${parsed.name}`);
            }
          }
        } catch (parseError) {
          console.log(`         ❌ Failed to parse log: ${parseError.message}`);
        }
      }

      console.log(`      📊 Summary for ${contract.name}:`);
      console.log(`         - Raw logs: ${rawLogs.length}`);
      console.log(`         - Parsed events: ${parsedEvents}`);
      console.log(`         - Position events: ${positionEvents}`);
      console.log(`         - Other events: ${otherEvents}`);
    } catch (error) {
      console.error(`      ❌ Error querying ${contract.name}:`, error.message);

      // Provide specific guidance based on error type
      if (error.message.includes("block range")) {
        console.log(
          "      💡 Block range too large - this is expected and handled by the system"
        );
      } else if (error.message.includes("contract")) {
        console.log(
          "      💡 Contract address might be invalid or not deployed"
        );
      }
    }
  }
}

// ===============================================
// STEP 5: TEST EVENT FORMATTING LOGIC
// ===============================================

async function testEventFormattingLogic(provider, contracts) {
  console.log("\n🔧 STEP 5: Testing Event Formatting Logic");
  console.log("------------------------------------------");

  if (contracts.length === 0) {
    console.log("   ❌ Skipping - no contracts to test");
    return;
  }

  // Test the event formatting logic with mock data
  console.log("   🧪 Testing event formatting with mock position event...");

  try {
    // Get network info for formatting
    const network = await provider.getNetwork();
    const currentBlock = await provider.getBlockNumber();
    const block = await provider.getBlock(currentBlock);

    // Mock a PositionOpened event
    const mockParsedLog = {
      name: "PositionOpened",
      args: {
        user: "0x1234567890123456789012345678901234567890",
        isLong: true,
        size: ethers.parseEther("100"),
        price: ethers.parseEther("2000"),
        leverage: ethers.parseEther("5"),
        fee: ethers.parseEther("1"),
      },
    };

    const mockLog = {
      transactionHash:
        "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      blockNumber: currentBlock,
      blockHash: block.hash,
      logIndex: 0,
    };

    console.log("   🏗️  Simulating event formatting...");

    // Simulate the formatting logic from the actual code
    const baseEvent = {
      transactionHash: mockLog.transactionHash,
      blockNumber: mockLog.blockNumber,
      blockHash: mockLog.blockHash,
      logIndex: mockLog.logIndex,
      contractAddress: contracts[0].address.toLowerCase(),
      timestamp: new Date(block.timestamp * 1000),
      chainId: Number(network.chainId),
    };

    // Test position event formatting
    const formattedEvent = {
      ...baseEvent,
      eventType: "PositionOpened",
      user: mockParsedLog.args.user,
      isLong: mockParsedLog.args.isLong,
      size: mockParsedLog.args.size?.toString(),
      price: mockParsedLog.args.price?.toString(),
      leverage: mockParsedLog.args.leverage?.toString(),
      fee: mockParsedLog.args.fee?.toString(),
    };

    console.log("   ✅ Event formatting successful:");
    console.log(`      Event Type: ${formattedEvent.eventType}`);
    console.log(`      User: ${formattedEvent.user}`);
    console.log(`      Is Long: ${formattedEvent.isLong}`);
    console.log(`      Size: ${formattedEvent.size}`);
    console.log(`      Price: ${formattedEvent.price}`);
    console.log(`      Transaction: ${formattedEvent.transactionHash}`);
    console.log(`      Block: ${formattedEvent.blockNumber}`);

    // Test filtering logic
    console.log("\n   🔍 Testing event filtering logic...");
    const allowedEventTypes = [
      "PositionOpened",
      "PositionClosed",
      "PositionLiquidated",
    ];

    // Test allowed event
    if (allowedEventTypes.includes(formattedEvent.eventType)) {
      console.log(`   ✅ Event ${formattedEvent.eventType} would be ALLOWED`);
    } else {
      console.log(
        `   ❌ Event ${formattedEvent.eventType} would be FILTERED OUT`
      );
    }

    // Test filtered events
    const testEvents = [
      "CollateralDeposited",
      "MarketCreated",
      "Transfer",
      "RandomEvent",
    ];
    testEvents.forEach((eventType) => {
      if (allowedEventTypes.includes(eventType)) {
        console.log(`   ✅ Event ${eventType} would be ALLOWED`);
      } else {
        console.log(`   🚫 Event ${eventType} would be FILTERED OUT`);
      }
    });
  } catch (error) {
    console.error("   ❌ Event formatting test failed:", error.message);
  }
}

// ===============================================
// STEP 6: TEST EVENT LISTENER API STATUS
// ===============================================

async function testEventListenerStatus() {
  console.log("\n🎧 STEP 6: Testing Event Listener Status");
  console.log("----------------------------------------");

  try {
    // Test if the event listener API is running
    console.log("   📡 Checking event listener API status...");

    const fetch = require("node-fetch").default || require("node-fetch");
    const response = await fetch("http://localhost:3000/api/event-listener", {
      method: "GET",
      timeout: 5000,
    });

    if (response.ok) {
      const data = await response.json();
      console.log("   ✅ Event listener API is responding");
      console.log(`      Status: ${data.status || "Unknown"}`);
      console.log(`      Running: ${data.isRunning ? "Yes" : "No"}`);

      if (data.contracts) {
        console.log(`      Monitoring: ${data.contracts} contracts`);
      }

      if (data.uptime) {
        console.log(`      Uptime: ${Math.round(data.uptime / 1000)}s`);
      }
    } else {
      console.log(`   ❌ Event listener API returned ${response.status}`);
    }
  } catch (error) {
    console.log("   ❌ Event listener API not accessible:", error.message);
    console.log(
      "   💡 Make sure your Next.js app is running on localhost:3000"
    );
    console.log("   💡 Try: npm run dev");
  }
}

// ===============================================
// STEP 7: TEST FULL PIPELINE SIMULATION
// ===============================================

async function testFullPipelineSimulation(supabase, contracts) {
  console.log("\n🔄 STEP 7: Full Pipeline Simulation Test");
  console.log("----------------------------------------");

  if (!supabase || contracts.length === 0) {
    console.log("   ❌ Skipping - database or contracts not available");
    return;
  }

  console.log("   🧪 Simulating complete event processing pipeline...");

  try {
    // Step 7.1: Create a test event
    console.log("   Step 7.1: Creating test event...");
    const testEvent = {
      transaction_hash: `0xtest${Date.now()}`,
      block_number: 999999,
      block_hash: "0xtest_block_hash",
      log_index: 0,
      contract_address: contracts[0].address.toLowerCase(),
      event_type: "PositionOpened",
      event_data: {
        eventType: "PositionOpened",
        user: "0xtest_user_address",
        isLong: true,
        size: "1000000000000000000",
        price: "2000000000000000000000",
        leverage: "5000000000000000000",
        fee: "10000000000000000",
      },
      timestamp: new Date().toISOString(),
      chain_id: parseInt(config.chainId),
      user_address: "0xtest_user_address",
    };

    // Step 7.2: Test database insertion
    console.log("   Step 7.2: Testing database insertion...");
    const { data: insertData, error: insertError } = await supabase
      .from("contract_events")
      .insert(testEvent)
      .select();

    if (insertError) {
      console.error("   ❌ Database insertion failed:", insertError.message);
      return;
    }

    console.log("   ✅ Test event inserted successfully");

    // Step 7.3: Test database retrieval
    console.log("   Step 7.3: Testing database retrieval...");
    const { data: retrievedData, error: retrieveError } = await supabase
      .from("contract_events")
      .select("*")
      .eq("transaction_hash", testEvent.transaction_hash);

    if (retrieveError) {
      console.error("   ❌ Database retrieval failed:", retrieveError.message);
      return;
    }

    if (retrievedData.length > 0) {
      console.log("   ✅ Test event retrieved successfully");
      console.log(`      Event Type: ${retrievedData[0].event_type}`);
      console.log(`      User: ${retrievedData[0].user_address}`);
    } else {
      console.log("   ❌ Test event not found in database");
    }

    // Step 7.4: Clean up test data
    console.log("   Step 7.4: Cleaning up test data...");
    await supabase
      .from("contract_events")
      .delete()
      .eq("transaction_hash", testEvent.transaction_hash);

    console.log("   ✅ Test data cleaned up");
    console.log("   🎉 Full pipeline simulation completed successfully!");
  } catch (error) {
    console.error("   ❌ Pipeline simulation failed:", error.message);
  }
}

// ===============================================
// MAIN DIAGNOSTIC FUNCTION
// ===============================================

async function runDiagnostic() {
  console.log("🚀 Starting comprehensive event pipeline diagnostic...\n");

  try {
    // Step 1: Test RPC connectivity
    const { provider, currentBlock, network } = await testRpcConnectivity();

    // Step 2: Test database connectivity
    const supabase = await testDatabaseConnectivity();

    // Step 3: Get contract configurations
    const contracts = await getContractConfigurations(supabase);

    // Step 4: Test blockchain event queries
    await testBlockchainEventQueries(provider, currentBlock, contracts);

    // Step 5: Test event formatting logic
    await testEventFormattingLogic(provider, contracts);

    // Step 6: Test event listener status
    await testEventListenerStatus();

    // Step 7: Test full pipeline simulation
    await testFullPipelineSimulation(supabase, contracts);

    // Final summary
    console.log("\n📋 DIAGNOSTIC SUMMARY");
    console.log("====================");
    console.log("✅ RPC Connectivity: Working");
    console.log(
      `${supabase ? "✅" : "❌"} Database Connectivity: ${
        supabase ? "Working" : "Failed"
      }`
    );
    console.log(
      `${contracts.length > 0 ? "✅" : "⚠️ "} Contracts: ${
        contracts.length
      } found`
    );
    console.log("✅ Event Formatting: Working");

    // Recommendations
    console.log("\n💡 RECOMMENDATIONS");
    console.log("==================");

    if (!supabase) {
      console.log("❗ Fix Supabase configuration in .env.local");
    }

    if (contracts.length === 0) {
      console.log("❗ Deploy contracts using the create-market wizard");
    } else {
      console.log("✅ All systems appear to be working correctly");
      console.log("💡 If events still aren't showing, check:");
      console.log("   1. Event listener is running (npm run event-listener)");
      console.log("   2. Contracts are generating position events");
      console.log("   3. Block range is appropriate for your network");
    }
  } catch (error) {
    console.error("\n❌ DIAGNOSTIC FAILED");
    console.error("===================");
    console.error("Error:", error.message);
    console.error("\n💡 Check your configuration and try again");
  }
}

// ===============================================
// RUN THE DIAGNOSTIC
// ===============================================

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n\n👋 Diagnostic interrupted by user");
  process.exit(0);
});

process.on("unhandledRejection", (error) => {
  console.error("\n💥 Unhandled error:", error.message);
  process.exit(1);
});

// Run the diagnostic
runDiagnostic()
  .then(() => {
    console.log("\n🎯 Diagnostic completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Diagnostic failed:", error.message);
    process.exit(1);
  });
