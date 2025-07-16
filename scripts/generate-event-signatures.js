#!/usr/bin/env node

/**
 * Generate Event Signatures for Scalable Monitoring
 *
 * Calculates the keccak256 hash of event signatures for use in
 * the scalable event monitoring system.
 */

const { ethers } = require("ethers");

// Event signatures to hash
const events = [
  // Position Events
  "PositionOpened(address,uint256,bool,uint256,uint256,uint256,uint256)",
  "PositionClosed(address,uint256,uint256,uint256,int256,uint256)",
  "PositionIncreased(address,uint256,uint256,uint256,uint256,uint256)",
  "PositionLiquidated(address,uint256,address,uint256,uint256,uint256)",

  // Funding Events
  "FundingUpdated(int256,uint256,int256)",
  "FundingPaid(address,uint256,int256,uint256)",

  // Vault Events
  "CollateralDeposited(address,uint256)",
  "CollateralWithdrawn(address,uint256)",
  "MarginReserved(address,uint256)",
  "MarginReleased(address,uint256)",
  "PnLUpdated(address,int256)",
  "FundingApplied(address,int256,uint256)",
  "UserLiquidated(address,uint256)",

  // Factory Events
  "MarketCreated(bytes32,string,address,address,address,address,uint256,uint8)",

  // Trading Events
  "TradingFeeCollected(address,uint256)",
  "BondingCurveUpdated(uint256,uint256,uint256)",
  "VirtualReservesUpdated(uint256,uint256,uint256)",

  // Administrative Events
  "ParametersUpdated(string,uint256)",
  "AuthorizedAdded(address)",
  "AuthorizedRemoved(address)",
  "Paused()",
  "Unpaused()",
];

console.log("🔢 Generating Event Signatures for Scalable Monitoring\n");

console.log(
  "// Event signatures for monitoring (keccak256 hash of event signatures)"
);
console.log("export const EVENT_SIGNATURES = {");

const signatures = {};

events.forEach((eventSig) => {
  const eventName = eventSig.split("(")[0];
  const hash = ethers.id(eventSig);
  signatures[eventName] = hash;

  console.log(`  ${eventName}: '${hash}',`);
});

console.log("}");

console.log("\n📊 Summary:");
console.log(`Generated ${Object.keys(signatures).length} event signatures`);

console.log("\n🎯 Critical Events for Platform Monitoring:");
const criticalEvents = [
  "PositionOpened",
  "PositionClosed",
  "PositionLiquidated",
  "MarketCreated",
  "CollateralDeposited",
  "TradingFeeCollected",
];

criticalEvents.forEach((eventName) => {
  if (signatures[eventName]) {
    console.log(`✅ ${eventName}: ${signatures[eventName]}`);
  } else {
    console.log(`❌ ${eventName}: NOT FOUND`);
  }
});

console.log("\n💡 Usage:");
console.log("1. Copy the EVENT_SIGNATURES object to scalableEventMonitor.ts");
console.log("2. Create a GraphQL webhook using these signatures");
console.log("3. Monitor ALL contracts with a single webhook");
console.log("4. Scale to unlimited contract deployments");

module.exports = signatures;
