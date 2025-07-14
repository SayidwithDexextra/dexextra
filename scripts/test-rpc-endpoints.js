const { ethers } = require("ethers");

// List of Polygon RPC endpoints to test
const rpcEndpoints = [
  "https://polygon-rpc.com/",
  "https://rpc.ankr.com/polygon",
  "https://polygon.blockpi.network/v1/rpc/public",
  "https://polygon-pokt.nodies.app",
  "https://rpc-mainnet.matic.quiknode.pro",
  "https://matic-mainnet.chainstacklabs.com",
  "https://polygon-mainnet.public.blastapi.io",
  "https://polygon.rpc.blxrbdn.com",
  "https://rpc-mainnet.maticvigil.com",
  "https://poly-rpc.gateway.pokt.network",
];

async function testRpcEndpoint(url) {
  try {
    console.log(`\n🔍 Testing: ${url}`);

    const provider = new ethers.JsonRpcProvider(url);

    // Test basic connectivity
    const startTime = Date.now();
    const network = await provider.getNetwork();
    const endTime = Date.now();

    // Test getting latest block
    const blockNumber = await provider.getBlockNumber();

    console.log(`✅ SUCCESS:`);
    console.log(`   Chain ID: ${network.chainId}`);
    console.log(`   Network: ${network.name || "unknown"}`);
    console.log(`   Latest Block: ${blockNumber}`);
    console.log(`   Response Time: ${endTime - startTime}ms`);

    return {
      url,
      success: true,
      chainId: network.chainId.toString(),
      responseTime: endTime - startTime,
    };
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    return { url, success: false, error: error.message };
  }
}

async function testAllEndpoints() {
  console.log("🚀 Testing Polygon RPC Endpoints...\n");

  const results = [];

  for (const url of rpcEndpoints) {
    const result = await testRpcEndpoint(url);
    results.push(result);

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log("\n📊 SUMMARY:");
  console.log("============");

  const working = results.filter((r) => r.success);
  const failed = results.filter((r) => !r.success);

  if (working.length > 0) {
    console.log(`\n✅ Working endpoints (${working.length}):`);
    working
      .sort((a, b) => a.responseTime - b.responseTime)
      .forEach((r) => {
        console.log(`   ${r.url} (${r.responseTime}ms)`);
      });

    console.log(`\n🏆 FASTEST: ${working[0].url}`);
    console.log(`\n💡 Update your .env.local file:`);
    console.log(`RPC_URL=${working[0].url}`);
    console.log(
      `WS_RPC_URL=${working[0].url
        .replace("https:", "wss:")
        .replace("http:", "ws:")}`
    );
  }

  if (failed.length > 0) {
    console.log(`\n❌ Failed endpoints (${failed.length}):`);
    failed.forEach((r) => {
      console.log(`   ${r.url} - ${r.error}`);
    });
  }
}

// Test a specific oracle contract
async function testOracleContract(rpcUrl, oracleAddress) {
  try {
    console.log(`\n🔮 Testing Oracle Contract: ${oracleAddress}`);
    console.log(`Using RPC: ${rpcUrl}`);

    const provider = new ethers.JsonRpcProvider(rpcUrl);

    // Check if contract exists
    const code = await provider.getCode(oracleAddress);
    if (code === "0x") {
      console.log("❌ No contract found at this address");
      return;
    }

    console.log("✅ Contract exists");

    // Test oracle ABI
    const oracleABI = [
      "function getPrice() external view returns (uint256)",
      "function getPriceWithTimestamp() external view returns (uint256, uint256)",
      "function isActive() external view returns (bool)",
    ];

    const oracle = new ethers.Contract(oracleAddress, oracleABI, provider);

    try {
      const isActive = await oracle.isActive();
      console.log(`✅ isActive(): ${isActive}`);
    } catch (e) {
      console.log(`❌ isActive() failed: ${e.message}`);
    }

    try {
      const price = await oracle.getPrice();
      console.log(`✅ getPrice(): ${ethers.formatEther(price)} ETH`);
    } catch (e) {
      console.log(`❌ getPrice() failed: ${e.message}`);
    }

    try {
      const priceData = await oracle.getPriceWithTimestamp();
      console.log(
        `✅ getPriceWithTimestamp(): price=${ethers.formatEther(
          priceData[0]
        )}, timestamp=${priceData[1]}`
      );
    } catch (e) {
      console.log(`❌ getPriceWithTimestamp() failed: ${e.message}`);
    }
  } catch (error) {
    console.log(`❌ Oracle test failed: ${error.message}`);
  }
}

// Main execution
async function main() {
  await testAllEndpoints();

  // Test the specific oracle from your code
  const workingRpc = "https://rpc.ankr.com/polygon"; // Known working endpoint
  const oracleAddress = "0xB65258446bd83916Bd455bB3dBEdCb9BA106d551";

  await testOracleContract(workingRpc, oracleAddress);
}

main().catch(console.error);
