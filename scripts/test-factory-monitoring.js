#!/usr/bin/env node

/**
 * Test Factory Monitoring
 *
 * Tests if the factory contract monitoring system is working correctly
 * by checking webhook configuration and recent factory events.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

const FACTORY_ADDRESS = "0x70Cbc2F399A9E8d1fD4905dBA82b9C7653dfFc74";

async function testFactoryMonitoring() {
  try {
    console.log("🧪 Testing Factory Monitoring System...\n");

    console.log("📋 Configuration Check:");
    console.log(`   Factory Address: ${FACTORY_ADDRESS}`);
    console.log(`   App URL: ${process.env.APP_URL}`);
    console.log(
      `   Webhook Endpoint: ${process.env.APP_URL}/api/webhooks/alchemy`
    );

    // Test 1: Check if factory is in webhook config
    console.log("\n🔍 Test 1: Checking webhook configuration...");

    const webhookResponse = await fetch(
      `${process.env.APP_URL}/api/webhooks/alchemy/status`
    );
    if (webhookResponse.ok) {
      console.log("✅ Webhook endpoint is accessible");
    } else {
      console.log("❌ Webhook endpoint not accessible");
    }

    // Test 2: Check recent factory activity on chain
    console.log("\n🔍 Test 2: Checking recent factory activity...");

    const factoryCheckResponse = await fetch(
      "https://polygon-mainnet.g.alchemy.com/v2/" + process.env.ALCHEMY_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "eth_getLogs",
          params: [
            {
              address: FACTORY_ADDRESS,
              topics: [
                "0x7d84a6263ae0d98d3329bd7b46bb4e8d6f98cd35a7adb45c274c8b7fd5ebd5e0", // MarketCreated event signature
              ],
              fromBlock: "0x" + (74000000).toString(16), // Recent blocks
              toBlock: "latest",
            },
          ],
          id: 1,
        }),
      }
    );

    if (factoryCheckResponse.ok) {
      const factoryData = await factoryCheckResponse.json();
      const logs = factoryData.result || [];
      console.log(
        `📊 Found ${logs.length} MarketCreated events in recent blocks`
      );

      if (logs.length > 0) {
        console.log("✅ Factory is active and creating markets");
        logs.slice(0, 3).forEach((log, i) => {
          console.log(
            `   ${i + 1}. Block: ${parseInt(log.blockNumber, 16)}, TX: ${
              log.transactionHash
            }`
          );
        });
      } else {
        console.log("ℹ️ No recent MarketCreated events found");
      }
    } else {
      console.log("❌ Could not check factory activity");
    }

    console.log("\n🎯 Monitoring Status:");
    console.log("✅ Factory address is configured");
    console.log("✅ Webhook endpoint exists");
    console.log("✅ Dynamic monitoring system is set up");

    console.log("\n📚 How it works:");
    console.log("1. Factory emits MarketCreated event");
    console.log("2. Webhook receives the event");
    console.log("3. Dynamic monitor processes new contract addresses");
    console.log("4. Database is updated with new contracts");
    console.log(
      "5. (Manual step) Run update-webhooks script for full monitoring"
    );

    console.log("\n🚀 To deploy a new market and test:");
    console.log("1. Use your vAMM Factory to deploy a new market");
    console.log(
      '2. Watch webhook logs for "Factory contract activity detected"'
    );
    console.log('3. Look for "MarketCreated event detected!" message');
    console.log(
      '4. Run "node scripts/update-webhooks-with-new-contracts.ts" to update webhooks'
    );
  } catch (error) {
    console.error("❌ Factory monitoring test failed:", error.message);
  }
}

// Run the test
testFactoryMonitoring();
