/**
 * Test Script: Mark Price Accuracy Verification
 *
 * This script tests the new mark price implementation to ensure
 * it's correctly fetching prices from individual VAMM contracts.
 */

const { createPublicClient, http, parseEther, formatEther } = require("viem");
const { polygon } = require("viem/chains");

// VAMM Mark Price ABI
const VAMM_MARK_PRICE_ABI = [
  {
    name: "getMetricMarkPrice",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    name: "getMetricFundingRate",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "metricId", type: "bytes32" }],
    outputs: [{ name: "", type: "int256" }],
  },
];

// Create metric ID from symbol
function symbolToMetricId(symbol) {
  const encoder = new TextEncoder();
  const data = encoder.encode(symbol.toLowerCase());
  const hash = new Uint8Array(32);
  for (let i = 0; i < Math.min(data.length, 32); i++) {
    hash[i] = data[i];
  }
  return `0x${Array.from(hash)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}`;
}

async function testMarkPriceAccuracy() {
  console.log("🧪 Testing Mark Price Accuracy...\n");

  // Create public client
  const client = createPublicClient({
    chain: polygon,
    transport: http(),
  });

  // Test data - add your deployed VAMM addresses here
  const testCases = [
    {
      symbol: "GOLD",
      vammAddress: "0x487f1baE58CE513B39889152E96Eb18a346c75b1", // Replace with actual address
      expectedPrice: 2400, // Expected approximate price
    },
    // Add more test cases as needed
  ];

  for (const testCase of testCases) {
    console.log(`📊 Testing ${testCase.symbol}...`);
    console.log(`   VAMM Address: ${testCase.vammAddress}`);

    try {
      const metricId = symbolToMetricId(testCase.symbol);
      console.log(`   Metric ID: ${metricId}`);

      // Test mark price call
      const markPrice = await client.readContract({
        address: testCase.vammAddress,
        abi: VAMM_MARK_PRICE_ABI,
        functionName: "getMetricMarkPrice",
        args: [metricId],
      });

      const formattedPrice = formatEther(markPrice);
      console.log(`   ✅ Mark Price: $${formattedPrice}`);

      // Test funding rate call
      try {
        const fundingRate = await client.readContract({
          address: testCase.vammAddress,
          abi: VAMM_MARK_PRICE_ABI,
          functionName: "getMetricFundingRate",
          args: [metricId],
        });

        const formattedRate = (Number(fundingRate) / 10000).toString();
        console.log(`   ✅ Funding Rate: ${formattedRate}%`);
      } catch (error) {
        console.log(`   ⚠️ Funding Rate: Not available (${error.message})`);
      }

      // Validate price reasonableness
      const priceValue = parseFloat(formattedPrice);
      if (priceValue > 0 && priceValue < 1000000) {
        console.log(`   ✅ Price validation: PASSED`);
      } else {
        console.log(`   ❌ Price validation: FAILED (price seems unrealistic)`);
      }
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }

    console.log("");
  }

  console.log("🎯 Mark price accuracy test completed!");
}

// Run the test
if (require.main === module) {
  testMarkPriceAccuracy().catch(console.error);
}

module.exports = { testMarkPriceAccuracy, symbolToMetricId };
