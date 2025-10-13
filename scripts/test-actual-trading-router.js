const { ethers } = require("ethers");

/**
 * Test the actual TradingRouter contract with minimal assumptions
 * to see what functions actually exist
 */

const TRADING_ROUTER_ADDRESS = "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6";
const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

async function main() {
  console.log("🔍 Testing Actual TradingRouter Contract...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  // Test with raw calls first
  console.log("📋 Step 1: Raw Contract Calls");

  const tests = [
    {
      name: "factory()",
      selector: "0xc45a0155", // factory() selector
    },
    {
      name: "isPaused()",
      selector: "0xb187bd26", // isPaused() selector
    },
    {
      name: "vaultRouter()",
      selector: "0x3a1dd34b", // vaultRouter() selector
    },
  ];

  for (const test of tests) {
    try {
      const result = await provider.call({
        to: TRADING_ROUTER_ADDRESS,
        data: test.selector,
      });

      if (result !== "0x") {
        console.log(`   ✅ ${test.name} - Raw result: ${result}`);

        // Try to decode as address for factory() and vaultRouter()
        if (test.name.includes("Router") || test.name.includes("factory")) {
          try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
              ["address"],
              result
            );
            console.log(`      Decoded address: ${decoded[0]}`);
          } catch {}
        }
      } else {
        console.log(`   ❌ ${test.name} - No result`);
      }
    } catch (err) {
      console.log(`   ❌ ${test.name} - Error: ${err.message}`);
    }
  }

  // Test getMultiMarketPrices with raw call
  console.log("\n📋 Step 2: Test getMultiMarketPrices Raw Call");

  try {
    // Function selector for getMultiMarketPrices(bytes32[])
    const selector = "0x1ab460c8";

    // Encode the parameters: bytes32[] with one element
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32[]"],
      [[ALUMINUM_MARKET_ID]]
    );

    const calldata = selector + encoded.slice(2); // Remove 0x from encoded data

    console.log(`   Calling with data: ${calldata}`);

    const result = await provider.call({
      to: TRADING_ROUTER_ADDRESS,
      data: calldata,
    });

    if (result !== "0x") {
      console.log(`   ✅ Raw call succeeded: ${result}`);

      // Try to decode as (uint256[], uint256[])
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint256[]", "uint256[]"],
          result
        );
        console.log(`   📊 Decoded prices:`);
        console.log(`      bestBids: [${decoded[0]}]`);
        console.log(`      bestAsks: [${decoded[1]}]`);
      } catch (decodeErr) {
        console.log(`   ⚠️  Could not decode result: ${decodeErr.message}`);
      }
    } else {
      console.log(`   ❌ Raw call returned empty result`);
    }
  } catch (err) {
    console.log(`   ❌ Raw call failed: ${err.message}`);

    // Let's try to understand the error better
    if (err.message.includes("revert")) {
      console.log(
        `   💡 Contract reverted - this means the function exists but failed`
      );
    } else if (err.message.includes("missing revert data")) {
      console.log(
        `   💡 Missing revert data - function might not exist or have permission issues`
      );
    }
  }

  // Test with ethers Contract interface
  console.log("\n📋 Step 3: Test with Ethers Contract Interface");

  const minimalABI = [
    "function getMultiMarketPrices(bytes32[] marketIds) external view returns (uint256[] bestBids, uint256[] bestAsks)",
  ];

  try {
    const contract = new ethers.Contract(
      TRADING_ROUTER_ADDRESS,
      minimalABI,
      provider
    );
    const result = await contract.getMultiMarketPrices([ALUMINUM_MARKET_ID]);

    console.log(`   ✅ Contract call succeeded:`);
    console.log(`      bestBids: [${result[0]}]`);
    console.log(`      bestAsks: [${result[1]}]`);
  } catch (err) {
    console.log(`   ❌ Contract call failed: ${err.message}`);
  }

  console.log("\n📋 Summary:");
  console.log("   If raw calls work but ethers calls fail, it's an ABI issue");
  console.log("   If raw calls also fail, it's a contract/permission issue");
}

main()
  .then(() => {
    console.log("\n✅ TradingRouter actual test completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
