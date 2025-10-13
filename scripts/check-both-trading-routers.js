const { ethers } = require("ethers");

/**
 * Check both TradingRouter addresses to see which one is the correct one
 */

const ROUTER_ADDRESSES = {
  original: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
  redeployed: "0xd5e8D39Fa0D9e64dff46e1607C4E9A1f4AD9EB0F",
};

const ALUMINUM_MARKET_ID =
  "0x41e77fd5318a7e3c379ff8fe985be494211c1b2a0a0fa1fa2f99ac7d5060892a";

async function testRouter(name, address) {
  console.log(`\n🔍 Testing ${name}: ${address}`);

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  // Check if contract exists
  const code = await provider.getCode(address);
  if (code === "0x") {
    console.log(`   ❌ No contract code at address`);
    return;
  }
  console.log(`   ✅ Contract exists (${code.length} bytes)`);

  // Test basic functions
  const tests = [
    {
      name: "factory()",
      selector: "0xc45a0155",
    },
    {
      name: "isPaused()",
      selector: "0xb187bd26",
    },
    {
      name: "vaultRouter()",
      selector: "0x3a1dd34b",
    },
  ];

  for (const test of tests) {
    try {
      const result = await provider.call({
        to: address,
        data: test.selector,
      });

      if (result !== "0x") {
        console.log(`   ✅ ${test.name} works`);

        // Decode addresses
        if (test.name.includes("Router") || test.name.includes("factory")) {
          try {
            const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
              ["address"],
              result
            );
            console.log(`      → ${decoded[0]}`);
          } catch {}
        }
      } else {
        console.log(`   ❌ ${test.name} - No result`);
      }
    } catch (err) {
      console.log(`   ❌ ${test.name} - ${err.message.split("(")[0]}`);
    }
  }

  // Test getMultiMarketPrices
  console.log(`   Testing getMultiMarketPrices...`);
  try {
    const selector = "0x1ab460c8";
    const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32[]"],
      [[ALUMINUM_MARKET_ID]]
    );
    const calldata = selector + encoded.slice(2);

    const result = await provider.call({
      to: address,
      data: calldata,
    });

    if (result !== "0x") {
      console.log(`   ✅ getMultiMarketPrices works`);
      try {
        const decoded = ethers.AbiCoder.defaultAbiCoder().decode(
          ["uint256[]", "uint256[]"],
          result
        );
        console.log(
          `      → bestBids: [${decoded[0]}], bestAsks: [${decoded[1]}]`
        );
      } catch {}
    } else {
      console.log(`   ❌ getMultiMarketPrices - No result`);
    }
  } catch (err) {
    console.log(`   ❌ getMultiMarketPrices - ${err.message.split("(")[0]}`);
  }
}

async function main() {
  console.log("🔍 Comparing Both TradingRouter Contracts...\n");

  await testRouter("Original", ROUTER_ADDRESSES.original);
  await testRouter("Redeployed", ROUTER_ADDRESSES.redeployed);

  console.log("\n📋 Summary:");
  console.log("   The working TradingRouter should:");
  console.log("   ✅ Have contract code");
  console.log("   ✅ Respond to factory() and isPaused()");
  console.log("   ✅ Have getMultiMarketPrices() that works");
}

main()
  .then(() => {
    console.log("\n✅ Comparison completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
