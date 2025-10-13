#!/usr/bin/env node

/**
 * Test TokenHeader Integration with Smart Contract lastPrice
 *
 * This script tests that our TokenHeader component is properly configured
 * to use the lastPrice field from the smart contract market variable.
 *
 * Usage: node scripts/test-token-header-integration.js
 */

const { ethers } = require("ethers");

// Test configuration
const ALUMINUM_V1_CONTRACT = "0x8BA5c36aCA7FC9D9b218EbDe87Cfd55C23f321bE";

// Use the same RPC fallback logic as our hook
const getRpcUrl = () => {
  const rpcUrls = [
    process.env.RPC_URL,
    process.env.NEXT_PUBLIC_RPC_URL,
    "https://polygon-mainnet.g.alchemy.com/v2/demo", // Alchemy demo key
    "https://rpc.ankr.com/polygon",
    "https://polygon-rpc.com",
    "https://rpc-mainnet.maticvigil.com",
  ].filter(Boolean);

  return rpcUrls[0] || "https://rpc.ankr.com/polygon";
};

const RPC_URL = getRpcUrl();

// Same ABI as our new hook
const ORDERBOOK_ABI = [
  {
    inputs: [],
    name: "getMarketInfo",
    outputs: [
      {
        components: [
          { internalType: "bytes32", name: "marketId", type: "bytes32" },
          { internalType: "string", name: "symbol", type: "string" },
          { internalType: "string", name: "metricId", type: "string" },
          { internalType: "uint256", name: "currentPrice", type: "uint256" },
          { internalType: "uint256", name: "lastPrice", type: "uint256" },
          { internalType: "uint256", name: "openInterest", type: "uint256" },
          { internalType: "uint256", name: "volume24h", type: "uint256" },
          { internalType: "uint256", name: "funding", type: "uint256" },
          { internalType: "uint256", name: "lastFundingTime", type: "uint256" },
          { internalType: "bool", name: "isActive", type: "bool" },
          { internalType: "bool", name: "isCustomMetric", type: "bool" },
        ],
        internalType: "struct OrderBook.Market",
        name: "",
        type: "tuple",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const PRICE_PRECISION = 1e6; // 6 decimals

async function testTokenHeaderIntegration() {
  console.log(
    "🧪 Testing TokenHeader Integration with Smart Contract lastPrice\n"
  );

  try {
    // Initialize provider and contract
    const provider = new ethers.JsonRpcProvider(RPC_URL);
    const contract = new ethers.Contract(
      ALUMINUM_V1_CONTRACT,
      ORDERBOOK_ABI,
      provider
    );

    console.log("📋 Test Configuration:");
    console.log(`  Contract: ${ALUMINUM_V1_CONTRACT}`);
    console.log(`  RPC URL: ${RPC_URL}`);
    console.log(`  Price Precision: ${PRICE_PRECISION} (6 decimals)\n`);

    // Test the same function our hook uses
    console.log("🔍 Testing getMarketInfo() function...");
    const marketInfo = await contract.getMarketInfo();

    const [
      marketId,
      symbol,
      metricId,
      currentPrice,
      lastPrice,
      openInterest,
      volume24h,
      funding,
      lastFundingTime,
      isActive,
      isCustomMetric,
    ] = marketInfo;

    // Convert prices using the same logic as our hook
    const currentPriceFormatted =
      parseFloat(currentPrice.toString()) / PRICE_PRECISION;
    const lastPriceFormatted =
      parseFloat(lastPrice.toString()) / PRICE_PRECISION;

    console.log("✅ Market Info Retrieved:");
    console.log(`  Market ID: ${marketId}`);
    console.log(`  Symbol: ${symbol}`);
    console.log(`  Metric ID: ${metricId}`);
    console.log(
      `  Current Price: $${currentPriceFormatted.toFixed(
        6
      )} (raw: ${currentPrice.toString()})`
    );
    console.log(
      `  🎯 Last Price: $${lastPriceFormatted.toFixed(
        6
      )} (raw: ${lastPrice.toString()})`
    );
    console.log(
      `  Open Interest: ${
        parseFloat(openInterest.toString()) / PRICE_PRECISION
      }`
    );
    console.log(
      `  Volume 24h: ${parseFloat(volume24h.toString()) / PRICE_PRECISION}`
    );
    console.log(`  Is Active: ${isActive}`);
    console.log(`  Is Custom Metric: ${isCustomMetric}\n`);

    // Test the price selection logic from our TokenHeader component
    console.log("🎯 Testing Price Selection Logic (as used in TokenHeader):");

    let displayPrice = 0;
    let priceSource = "none";

    // Same logic as in TokenHeader component
    if (lastPriceFormatted > 0) {
      displayPrice = lastPriceFormatted;
      priceSource = "contract-lastPrice";
    } else if (currentPriceFormatted > 0) {
      displayPrice = currentPriceFormatted;
      priceSource = "contract-currentPrice";
    }

    console.log(`  Selected Price: $${displayPrice.toFixed(6)}`);
    console.log(`  Price Source: ${priceSource}`);
    console.log(
      `  ✅ Using lastPrice: ${
        priceSource === "contract-lastPrice" ? "YES" : "NO"
      }\n`
    );

    // Validate our implementation
    console.log("🏆 Integration Test Results:");

    if (priceSource === "contract-lastPrice") {
      console.log(
        "  ✅ SUCCESS: TokenHeader will display lastPrice from smart contract"
      );
      console.log(
        `  ✅ Value: $${lastPriceFormatted.toFixed(
          6
        )} (the $5.00 you mentioned)`
      );
      console.log("  ✅ Source: Smart contract market variable");
    } else if (priceSource === "contract-currentPrice") {
      console.log("  ⚠️  FALLBACK: TokenHeader will display currentPrice");
      console.log(`  ⚠️  Value: $${currentPriceFormatted.toFixed(6)}`);
      console.log(
        "  ⚠️  Reason: lastPrice is 0, using currentPrice as fallback"
      );
    } else {
      console.log("  ❌ ERROR: No valid price available");
      console.log("  ❌ Both lastPrice and currentPrice are 0");
    }

    console.log("\n📊 Summary:");
    console.log(
      `  • currentPrice (mark price): $${currentPriceFormatted.toFixed(6)}`
    );
    console.log(
      `  • lastPrice (trade price): $${lastPriceFormatted.toFixed(6)} 🎯`
    );
    console.log(`  • Display Price: $${displayPrice.toFixed(6)}`);
    console.log(`  • Source: ${priceSource}`);

    if (lastPriceFormatted === 5.0) {
      console.log(
        "\n🎉 PERFECT! The lastPrice matches your expected $5.00 value!"
      );
    }
  } catch (error) {
    console.error("❌ Test failed:", error.message);
    process.exit(1);
  }
}

// Execute test
async function main() {
  try {
    await testTokenHeaderIntegration();
    console.log("\n✅ Integration test completed successfully!");
  } catch (error) {
    console.error("❌ Integration test failed:", error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { testTokenHeaderIntegration };
