#!/usr/bin/env node

const { ethers } = require("ethers");
const path = require("path");

// Colors for console output
const colors = {
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  reset: "\x1b[0m",
  bold: "\x1b[1m",
};

const log = {
  error: (msg) => console.log(`${colors.red}❌ ${msg}${colors.reset}`),
  success: (msg) => console.log(`${colors.green}✅ ${msg}${colors.reset}`),
  warning: (msg) => console.log(`${colors.yellow}⚠️  ${msg}${colors.reset}`),
  info: (msg) => console.log(`${colors.blue}ℹ️  ${msg}${colors.reset}`),
  title: (msg) =>
    console.log(`${colors.bold}${colors.blue}\n🔍 ${msg}${colors.reset}`),
  fix: (msg) => console.log(`${colors.green}🔧 FIX: ${msg}${colors.reset}`),
};

async function makeRequest(url, options = {}) {
  try {
    const response = await fetch(url, options);
    return await response.json();
  } catch (error) {
    return { error: error.message };
  }
}

async function diagnoseEventSystem() {
  log.title("DexExtra Event System Diagnostic");
  console.log(
    "This script will identify and fix issues with event monitoring\n"
  );

  const issues = [];
  const fixes = [];

  // Check 1: Development Server Running
  log.title("1. Checking Development Server");
  try {
    const healthCheck = await makeRequest(
      "http://localhost:3000/api/events/status"
    );
    if (healthCheck.error) {
      log.error("Development server not responding");
      issues.push("dev-server-down");
      fixes.push("Start the development server with: npm run dev");
    } else {
      log.success("Development server is running");
    }
  } catch (error) {
    log.error("Cannot connect to development server");
    issues.push("dev-server-down");
  }

  // Check 2: Environment Configuration
  log.title("2. Checking Environment Configuration");

  // Load environment variables
  require("dotenv").config({ path: ".env.local" });

  const requiredEnvVars = {
    RPC_URL: process.env.RPC_URL,
    WS_RPC_URL: process.env.WS_RPC_URL,
    CHAIN_ID: process.env.CHAIN_ID,
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  };

  let envConfigured = true;
  Object.entries(requiredEnvVars).forEach(([key, value]) => {
    if (!value || value.includes("placeholder")) {
      log.error(`${key} not configured`);
      envConfigured = false;
      issues.push(`env-${key.toLowerCase()}`);
    } else {
      log.success(`${key}: ${value.substring(0, 50)}...`);
    }
  });

  if (!envConfigured) {
    fixes.push("Create .env.local file with proper configuration");
  }

  // Check 3: RPC Connectivity
  log.title("3. Testing RPC Connectivity");
  const rpcUrl =
    process.env.RPC_URL ||
    "https://polygon-mainnet.g.alchemy.com/v2/KKxzX7tzui3wBU9NTnBLHuZki7c4kHSm";

  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const network = await provider.getNetwork();
    const blockNumber = await provider.getBlockNumber();

    log.success(`Connected to Chain ID: ${network.chainId}`);
    log.success(`Current block: ${blockNumber}`);

    // Check if chain ID matches configuration
    const expectedChainId = parseInt(process.env.CHAIN_ID || "137");
    if (Number(network.chainId) !== expectedChainId) {
      log.warning(
        `Chain ID mismatch: expected ${expectedChainId}, got ${network.chainId}`
      );
      issues.push("chain-id-mismatch");
      fixes.push(`Update CHAIN_ID in .env.local to ${network.chainId}`);
    }
  } catch (error) {
    log.error(`RPC connection failed: ${error.message}`);
    issues.push("rpc-connection-failed");
    fixes.push("Check RPC_URL in .env.local or use a different RPC provider");
  }

  // Check 4: Event Listener Status
  log.title("4. Checking Event Listener Status");
  try {
    const statusResponse = await makeRequest(
      "http://localhost:3000/api/events/status"
    );

    if (statusResponse.success) {
      const { eventListener, contracts } = statusResponse.status;

      if (eventListener.isRunning) {
        log.success("Event listener is running");
        log.info(`Monitoring ${eventListener.contractsMonitored} contracts`);
        log.info(`WebSocket connected: ${eventListener.wsConnected}`);
        log.info(`Clients connected: ${eventListener.clientsConnected}`);
      } else {
        log.error("Event listener is not running");
        issues.push("event-listener-stopped");
        fixes.push("Start event listener via API");
      }

      if (contracts.total === 0) {
        log.error("No contracts registered for monitoring");
        issues.push("no-contracts-registered");
        fixes.push("Register contracts for monitoring");
      } else {
        log.success(`${contracts.total} contracts registered`);
        contracts.list.forEach((contract) => {
          log.info(
            `  - ${contract.name} (${contract.type}): ${contract.address}`
          );
        });
      }
    } else {
      log.error(`Status check failed: ${statusResponse.error}`);
      issues.push("status-check-failed");
    }
  } catch (error) {
    log.error(`Cannot check event listener status: ${error.message}`);
    issues.push("status-api-error");
  }

  // Check 5: Database Connectivity
  log.title("5. Testing Database Connectivity");
  try {
    const eventsResponse = await makeRequest(
      "http://localhost:3000/api/events?limit=1"
    );

    if (eventsResponse.success) {
      log.success("Database connectivity OK");
      if (eventsResponse.events && eventsResponse.events.length > 0) {
        log.success(`Found ${eventsResponse.events.length} recent events`);
      } else {
        log.warning("No events found in database");
        issues.push("no-events-in-database");
      }
    } else {
      log.error(`Database query failed: ${eventsResponse.error}`);
      issues.push("database-connection-failed");
      fixes.push("Check Supabase configuration and database setup");
    }
  } catch (error) {
    log.error(`Database connectivity test failed: ${error.message}`);
    issues.push("database-api-error");
  }

  // Check 6: SSE Stream Connectivity
  log.title("6. Testing Real-time Event Stream");
  // Note: This is a simplified check since we can't easily test SSE in Node.js
  log.info("SSE stream test would require browser environment");
  log.info("Check browser console for SSE connection issues");

  // Apply Automatic Fixes
  log.title("7. Applying Automatic Fixes");

  if (issues.includes("event-listener-stopped")) {
    try {
      log.info("Starting event listener...");
      const startResponse = await makeRequest(
        "http://localhost:3000/api/events/trigger",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "start" }),
        }
      );

      if (startResponse.success) {
        log.success("Event listener started successfully");
      } else {
        log.error(`Failed to start event listener: ${startResponse.error}`);
      }
    } catch (error) {
      log.error(`Error starting event listener: ${error.message}`);
    }
  }

  if (issues.includes("no-contracts-registered")) {
    log.info("Attempting to register sample contracts...");
    // This would need actual contract addresses from your deployment
    log.warning(
      "Manual contract registration required - see create-market wizard"
    );
  }

  // Generate Report
  log.title("8. Diagnostic Summary");

  if (issues.length === 0) {
    log.success("🎉 No issues found! Event system should be working properly.");

    // Test with simulation
    try {
      log.info("Running simulation test...");
      const simResponse = await makeRequest(
        "http://localhost:3000/api/events/trigger",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "simulate" }),
        }
      );

      if (simResponse.success) {
        log.success(
          "✨ Simulation test passed! Check your transaction table for the test event."
        );
      }
    } catch (error) {
      log.warning("Simulation test failed, but core system appears healthy");
    }
  } else {
    log.error(`Found ${issues.length} issues:`);
    issues.forEach((issue, index) => {
      log.error(`  ${index + 1}. ${issue}`);
    });

    console.log(`\n${colors.bold}🔧 Recommended Fixes:${colors.reset}`);
    fixes.forEach((fix, index) => {
      log.fix(`${index + 1}. ${fix}`);
    });
  }

  // Manual Fix Instructions
  console.log(`\n${colors.bold}📋 Manual Steps (if needed):${colors.reset}`);
  console.log("1. Ensure .env.local is properly configured");
  console.log("2. Deploy contracts using the vAMM wizard");
  console.log("3. Register contracts via create-market process");
  console.log("4. Check browser console for frontend errors");
  console.log("5. Verify wallet is connected to correct network");

  console.log(`\n${colors.bold}🧪 Test Commands:${colors.reset}`);
  console.log("• npm run test-events     - Run event system test");
  console.log("• npm run test-polygon    - Test blockchain connectivity");
  console.log("• curl http://localhost:3000/api/events/status - Check status");

  return { issues, fixes };
}

// Run diagnostics
if (require.main === module) {
  diagnoseEventSystem().catch(console.error);
}

module.exports = { diagnoseEventSystem };
