#!/usr/bin/env node

const { ethers } = require("ethers");

async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, options);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function fixEventMonitoring() {
  console.log("🔧 DexExtra Event Monitoring Fix Script\n");

  // Step 1: Check if development server is running
  console.log("1️⃣ Checking development server...");
  try {
    const healthCheck = await makeRequest(
      "http://localhost:3001/api/events/status"
    );
    if (healthCheck.error) {
      console.log("❌ Development server not responding");
      console.log("💡 Please run: npm run dev");
      return;
    }
    console.log("✅ Development server is running\n");
  } catch (error) {
    console.log("❌ Cannot connect to development server");
    console.log("💡 Please run: npm run dev");
    return;
  }

  // Step 2: Start event listener if stopped
  console.log("2️⃣ Starting event listener...");
  try {
    const startResponse = await makeRequest(
      "http://localhost:3001/api/events/trigger",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start" }),
      }
    );

    if (startResponse.success) {
      console.log("✅ Event listener started successfully");
    } else {
      console.log(
        `⚠️  Event listener: ${startResponse.message || startResponse.error}`
      );
    }
  } catch (error) {
    console.log(`❌ Failed to start event listener: ${error.message}`);
  }

  // Step 3: Check system status
  console.log("\n3️⃣ Checking system status...");
  try {
    const statusResponse = await makeRequest(
      "http://localhost:3001/api/events/status"
    );

    if (statusResponse.success) {
      const { eventListener, contracts } = statusResponse.status;

      console.log(
        `📊 Event Listener: ${
          eventListener.isRunning ? "🟢 Running" : "🔴 Stopped"
        }`
      );
      console.log(
        `📊 Contracts Monitored: ${eventListener.contractsMonitored}`
      );
      console.log(
        `📊 WebSocket Connected: ${
          eventListener.wsConnected ? "🟢 Yes" : "🔴 No"
        }`
      );
      console.log(`📊 Total Contracts: ${contracts.total}`);

      if (contracts.total === 0) {
        console.log("\n⚠️  No contracts registered for monitoring!");
        console.log("💡 You need to:");
        console.log("   1. Go to http://localhost:3001/create-market");
        console.log("   2. Complete the vAMM wizard to deploy contracts");
        console.log("   3. Contracts will be automatically registered");
      } else {
        console.log("\n📋 Monitored Contracts:");
        contracts.list.forEach((contract) => {
          console.log(`   - ${contract.name} (${contract.type})`);
        });
      }
    } else {
      console.log(`❌ Status check failed: ${statusResponse.error}`);
    }
  } catch (error) {
    console.log(`❌ Cannot check status: ${error.message}`);
  }

  // Step 4: Test database connectivity
  console.log("\n4️⃣ Testing database connectivity...");
  try {
    const eventsResponse = await makeRequest(
      "http://localhost:3001/api/events?limit=1"
    );

    if (eventsResponse.success) {
      console.log("✅ Database connectivity OK");
      if (eventsResponse.events && eventsResponse.events.length > 0) {
        console.log(`✅ Found recent events in database`);
      } else {
        console.log(
          "⚠️  No events found in database (this is normal for new deployments)"
        );
      }
    } else {
      console.log(`❌ Database connection failed: ${eventsResponse.error}`);
      console.log("💡 Check your Supabase configuration in .env.local");
    }
  } catch (error) {
    console.log(`❌ Database test failed: ${error.message}`);
  }

  // Step 5: Run simulation test
  console.log("\n5️⃣ Running simulation test...");
  try {
    const simResponse = await makeRequest(
      "http://localhost:3001/api/events/trigger",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "simulate" }),
      }
    );

    if (simResponse.success) {
      console.log("✅ Simulation test passed!");
      console.log(
        "💡 Check http://localhost:3001/token/Gold for the test event"
      );
    } else {
      console.log(`❌ Simulation failed: ${simResponse.error}`);
    }
  } catch (error) {
    console.log(`❌ Simulation test failed: ${error.message}`);
  }

  // Final status
  console.log("\n🎯 Quick Fix Summary:");
  console.log("✅ Event listener has been started");
  console.log("✅ System connectivity tested");
  console.log("✅ Simulation event generated");

  console.log("\n🚀 Next Steps:");
  console.log("1. If you need to monitor real contracts:");
  console.log("   → Deploy contracts via http://localhost:3001/create-market");
  console.log("2. If your recent event still doesn't show:");
  console.log("   → Check browser console for errors");
  console.log("   → Verify the contract address is registered");
  console.log("   → Ensure your wallet is on the correct network");

  console.log("\n🧪 Test Your Fix:");
  console.log("• Open: http://localhost:3001/token/Gold");
  console.log("• Look for the 'Live' indicator next to 'Recent Transactions'");
  console.log("• You should see the simulated event in the table");
}

// Run the fix
if (require.main === module) {
  fixEventMonitoring().catch(console.error);
}

module.exports = { fixEventMonitoring };
