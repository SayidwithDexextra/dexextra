#!/usr/bin/env tsx

/**
 * Enable Dynamic Contract Monitoring Script
 * 
 * This script adds the vAMM Factory contract to webhook monitoring
 * and initializes the dynamic contract monitor system for real-time
 * detection of new contract deployments.
 */

require("dotenv").config({ path: ".env.local" });
require("dotenv").config();

async function enableDynamicMonitoring() {
  try {
    console.log("🚀 Enabling Dynamic Contract Monitoring System...\n");

    // Dynamic imports for ESM modules
    const { getDynamicContractMonitor } = await import("../src/services/dynamicContractMonitor");

    // Initialize and configure dynamic monitoring
    console.log("🔧 Initializing Dynamic Contract Monitor...");
    const dynamicMonitor = await getDynamicContractMonitor();
    
    // Get monitoring status
    const status = dynamicMonitor.getStatus();
    
    console.log("\n📊 Dynamic Monitoring Status:");
    console.log(`   • Factory Address: ${status.factoryAddress}`);
    console.log(`   • Monitored Contracts: ${status.monitoredContractsCount}`);
    console.log(`   • Is Monitoring: ${status.isMonitoring}`);
    
    if (status.monitoredContractsCount > 0) {
      console.log("\n📋 Currently Monitored Contracts:");
      status.monitoredContracts.forEach((address, index) => {
        console.log(`   ${index + 1}. ${address}`);
      });
    }
    
    console.log("\n✅ Dynamic Contract Monitoring System Enabled!");
    console.log("\n🎯 What this enables:");
    console.log("   • Automatic detection of new vAMM/Vault deployments");
    console.log("   • Real-time webhook updates with new contract addresses");
    console.log("   • Immediate event monitoring for newly deployed contracts");
    console.log("   • Factory contract monitoring for MarketCreated events");
    
    console.log("\n🧪 Test Dynamic Monitoring:");
    console.log("   1. Deploy a new market via your vAMM Factory");
    console.log("   2. Watch for 'MarketCreated event detected!' in webhook logs");
    console.log("   3. New contracts will be automatically added to monitoring");
    console.log("   4. Position events from new contracts will be captured immediately");

  } catch (error) {
    console.error("❌ Failed to enable dynamic monitoring:", error);
    process.exit(1);
  }
}

// Run the script
enableDynamicMonitoring(); 