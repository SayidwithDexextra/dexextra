#!/usr/bin/env node

const fetch = require("node-fetch");

const API_BASE = "http://localhost:3000";

// Test configuration
const TEST_CONFIG = {
  contractAddress: "0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0", // Gold vAMM
  testEvents: [
    {
      transactionHash: `0x${Date.now().toString(16).padStart(64, "0")}`,
      blockNumber: 73860000 + Math.floor(Math.random() * 1000),
      blockHash: `0x${Math.random().toString(16).substr(2, 64)}`,
      logIndex: 0,
      contractAddress: "0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0",
      eventType: "PositionOpened",
      timestamp: new Date().toISOString(),
      chainId: 137,
      user: `0x${Math.random().toString(16).substr(2, 40)}`,
      isLong: Math.random() > 0.5,
      size: (
        BigInt(Math.floor(Math.random() * 10000)) *
        BigInt("1000000000000000000")
      ).toString(),
      price: (3000 + Math.floor(Math.random() * 1000)).toString() + "000000",
      leverage: (Math.floor(Math.random() * 10) + 1).toString(),
      fee: Math.floor(Math.random() * 100).toString() + "000000",
    },
    {
      transactionHash: `0x${Date.now().toString(16).padStart(64, "1")}`,
      blockNumber: 73860000 + Math.floor(Math.random() * 1000),
      blockHash: `0x${Math.random().toString(16).substr(2, 64)}`,
      logIndex: 1,
      contractAddress: "0xDAB242Cd90b95A4ED68644347B80e0b3CEaD48c0",
      eventType: "PositionClosed",
      timestamp: new Date().toISOString(),
      chainId: 137,
      user: `0x${Math.random().toString(16).substr(2, 40)}`,
      size: (
        BigInt(Math.floor(Math.random() * 5000)) * BigInt("1000000000000000000")
      ).toString(),
      price: (3000 + Math.floor(Math.random() * 1000)).toString() + "000000",
      pnl:
        (Math.random() > 0.5 ? 1 : -1) * Math.floor(Math.random() * 500) +
        "000000",
      fee: Math.floor(Math.random() * 50).toString() + "000000",
    },
  ],
};

async function apiRequest(path, options = {}) {
  const url = `${API_BASE}${path}`;
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`
    );
  }

  return response.json();
}

async function testEventListenerStatus() {
  console.log("🔍 Testing event listener status...");

  try {
    const status = await apiRequest("/api/events/status");
    console.log("✅ Event listener status:", status.status.eventListener);
    console.log("📊 Contracts monitored:", status.status.contracts.total);

    if (!status.status.eventListener.isRunning) {
      console.log("🚀 Starting event listener...");
      await apiRequest("/api/events/trigger", {
        method: "POST",
        body: JSON.stringify({ action: "start" }),
      });
      console.log("✅ Event listener started");
    }

    return true;
  } catch (error) {
    console.error("❌ Event listener test failed:", error.message);
    return false;
  }
}

async function testDatabaseStorage() {
  console.log("🗄️ Testing database storage...");

  try {
    const storeResult = await apiRequest("/api/events/store", {
      method: "POST",
      body: JSON.stringify({
        events: TEST_CONFIG.testEvents,
        source: "integration-test",
        contractAddress: TEST_CONFIG.contractAddress,
      }),
    });

    console.log("✅ Database storage test:", storeResult.summary);
    return storeResult.summary.stored > 0;
  } catch (error) {
    console.error("❌ Database storage test failed:", error.message);
    return false;
  }
}

async function testEventRetrieval() {
  console.log("📋 Testing event retrieval...");

  try {
    const events = await apiRequest(
      `/api/events?contractAddress=${TEST_CONFIG.contractAddress}&limit=10`
    );
    console.log("✅ Event retrieval test:", {
      success: events.success,
      eventCount: events.events.length,
      latestEvent: events.events[0]
        ? {
            type: events.events[0].eventType,
            timestamp: events.events[0].timestamp,
          }
        : null,
    });

    return events.success && events.events.length > 0;
  } catch (error) {
    console.error("❌ Event retrieval test failed:", error.message);
    return false;
  }
}

async function testTransactionTableData() {
  console.log("🔄 Testing transaction table data transformation...");

  try {
    const events = await apiRequest(
      `/api/events?contractAddress=${TEST_CONFIG.contractAddress}&limit=5`
    );

    if (!events.success || events.events.length === 0) {
      console.log("⚠️ No events to test transaction table transformation");
      return false;
    }

    // Test that events can be transformed to transaction format
    const testEvent = events.events[0];
    const hasRequiredFields =
      testEvent.transactionHash && testEvent.eventType && testEvent.timestamp;

    console.log("✅ Transaction table data test:", {
      hasRequiredFields,
      eventType: testEvent.eventType,
      hasUser: !!testEvent.user,
      hasSize: !!testEvent.size,
      hasFee: !!testEvent.fee,
    });

    return hasRequiredFields;
  } catch (error) {
    console.error("❌ Transaction table data test failed:", error.message);
    return false;
  }
}

async function testSSEConnection() {
  console.log("📡 Testing SSE connection...");

  try {
    // Test SSE endpoint availability
    const response = await fetch(
      `${API_BASE}/api/events/stream?contractAddress=${TEST_CONFIG.contractAddress}`
    );
    console.log("✅ SSE connection test:", {
      status: response.status,
      headers: response.headers.get("content-type"),
    });

    return response.ok;
  } catch (error) {
    console.error("❌ SSE connection test failed:", error.message);
    return false;
  }
}

async function testEventSimulation() {
  console.log("🎭 Testing event simulation...");

  try {
    const simulationResult = await apiRequest("/api/events/trigger", {
      method: "POST",
      body: JSON.stringify({ action: "simulate" }),
    });

    console.log("✅ Event simulation test:", {
      success: simulationResult.success,
      eventType: simulationResult.event?.eventType,
    });

    return simulationResult.success;
  } catch (error) {
    console.error("❌ Event simulation test failed:", error.message);
    return false;
  }
}

async function runIntegrationTests() {
  console.log("🧪 Running Event System Integration Tests\n");

  const tests = [
    { name: "Event Listener Status", test: testEventListenerStatus },
    { name: "Database Storage", test: testDatabaseStorage },
    { name: "Event Retrieval", test: testEventRetrieval },
    { name: "Transaction Table Data", test: testTransactionTableData },
    { name: "SSE Connection", test: testSSEConnection },
    { name: "Event Simulation", test: testEventSimulation },
  ];

  const results = [];

  for (const { name, test } of tests) {
    console.log(`\n📋 Running: ${name}`);
    try {
      const result = await test();
      results.push({ name, passed: result });
      console.log(result ? "✅ PASSED" : "❌ FAILED");
    } catch (error) {
      console.error(`❌ ERROR: ${error.message}`);
      results.push({ name, passed: false, error: error.message });
    }
  }

  // Summary
  console.log("\n📊 Test Summary:");
  console.log("================");
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  results.forEach((result) => {
    const status = result.passed ? "✅" : "❌";
    console.log(`${status} ${result.name}`);
    if (result.error) {
      console.log(`   Error: ${result.error}`);
    }
  });

  console.log(`\n${passed}/${total} tests passed`);

  if (passed === total) {
    console.log(
      "🎉 All tests passed! Transaction table should be working correctly."
    );
  } else {
    console.log("⚠️ Some tests failed. Check the issues above.");
  }

  return passed === total;
}

// Run tests if this file is executed directly
if (require.main === module) {
  runIntegrationTests()
    .then((success) => {
      process.exit(success ? 0 : 1);
    })
    .catch((error) => {
      console.error("Test runner error:", error);
      process.exit(1);
    });
}

module.exports = { runIntegrationTests, TEST_CONFIG };
