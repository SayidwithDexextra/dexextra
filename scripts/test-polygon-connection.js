const https = require("https");
require("dotenv").config({ path: ".env.local" });

// Test Polygon RPC connection
async function testPolygonConnection() {
  console.log("🔗 Testing Polygon Mainnet Connection...\n");

  const rpcUrl = process.env.RPC_URL || "wss://polygon-mainnet.g.alchemy.com/v2/KKxzX7tzui3wBU9NTnBLHuZki7c4kHSm";
  const chainId = process.env.CHAIN_ID || "137";

  console.log("Configuration:");
  console.log(`  RPC URL: ${rpcUrl}`);
  console.log(`  Chain ID: ${chainId}`);
  console.log(`  Network: ${process.env.DEFAULT_NETWORK || "polygon"}\n`);

  // Test 1: Basic RPC connectivity
  console.log("🧪 Test 1: Basic RPC Connectivity");
  try {
    const result = await makeRpcCall(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_chainId",
      params: [],
      id: 1,
    });

    const receivedChainId = parseInt(result.result, 16);
    console.log(`✅ Connected! Chain ID: ${receivedChainId}`);

    if (receivedChainId === 137) {
      console.log("✅ Confirmed: Connected to Polygon Mainnet\n");
    } else {
      console.log(
        `⚠️  Warning: Expected chain ID 137, got ${receivedChainId}\n`
      );
    }
  } catch (error) {
    console.log("❌ Connection failed:", error.message);
    return false;
  }

  // Test 2: Latest block number
  console.log("🧪 Test 2: Latest Block Number");
  try {
    const result = await makeRpcCall(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_blockNumber",
      params: [],
      id: 2,
    });

    const blockNumber = parseInt(result.result, 16);
    console.log(`✅ Latest block: ${blockNumber.toLocaleString()}`);

    // Check if block is recent (within last hour)
    const now = Math.floor(Date.now() / 1000);
    const blockTime = await getBlockTime(rpcUrl, result.result);
    const timeDiff = now - blockTime;

    if (timeDiff < 3600) {
      // 1 hour
      console.log(`✅ Block is recent (${Math.floor(timeDiff)} seconds ago)\n`);
    } else {
      console.log(
        `⚠️  Warning: Block is ${Math.floor(timeDiff / 60)} minutes old\n`
      );
    }
  } catch (error) {
    console.log("❌ Failed to get block number:", error.message);
  }

  // Test 3: Gas price
  console.log("🧪 Test 3: Current Gas Price");
  try {
    const result = await makeRpcCall(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_gasPrice",
      params: [],
      id: 3,
    });

    const gasPrice = parseInt(result.result, 16);
    const gasPriceGwei = gasPrice / 1e9;
    const estimatedCost = (gasPrice * 21000) / 1e18; // Basic transfer cost

    console.log(`✅ Gas Price: ${gasPriceGwei.toFixed(2)} Gwei`);
    console.log(
      `💰 Est. transfer cost: ${estimatedCost.toFixed(6)} MATIC (~$${(
        estimatedCost * 0.5
      ).toFixed(4)})\n`
    );
  } catch (error) {
    console.log("❌ Failed to get gas price:", error.message);
  }

  // Test 4: Network version
  console.log("🧪 Test 4: Network Version");
  try {
    const result = await makeRpcCall(rpcUrl, {
      jsonrpc: "2.0",
      method: "net_version",
      params: [],
      id: 4,
    });

    console.log(`✅ Network Version: ${result.result}\n`);
  } catch (error) {
    console.log("❌ Failed to get network version:", error.message);
  }

  console.log("🎉 Polygon connection test completed!");
  console.log("\n📋 Next Steps:");
  console.log("1. Make sure your wallet is connected to Polygon Mainnet");
  console.log("2. Ensure you have MATIC tokens for gas fees");
  console.log("3. Use the Network Selector in the app to switch networks");
  console.log("\n🚀 You're ready to use DexExtra on Polygon!");

  return true;
}

// Helper function to make RPC calls
function makeRpcCall(url, data) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(data);

    const options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(postData),
      },
    };

    const req = https.request(url, options, (res) => {
      let responseData = "";

      res.on("data", (chunk) => {
        responseData += chunk;
      });

      res.on("end", () => {
        try {
          const response = JSON.parse(responseData);
          if (response.error) {
            reject(new Error(`RPC Error: ${response.error.message}`));
          } else {
            resolve(response);
          }
        } catch (error) {
          reject(new Error(`Invalid JSON response: ${error.message}`));
        }
      });
    });

    req.on("error", (error) => {
      reject(new Error(`Network error: ${error.message}`));
    });

    req.setTimeout(10000, () => {
      reject(new Error("Request timeout"));
    });

    req.write(postData);
    req.end();
  });
}

// Helper function to get block timestamp
async function getBlockTime(rpcUrl, blockNumber) {
  try {
    const result = await makeRpcCall(rpcUrl, {
      jsonrpc: "2.0",
      method: "eth_getBlockByNumber",
      params: [blockNumber, false],
      id: 5,
    });

    return parseInt(result.result.timestamp, 16);
  } catch (error) {
    return 0;
  }
}

// Test alternative RPC endpoints
async function testAlternativeRpcs() {
  console.log("\n🔄 Testing Alternative RPC Endpoints...\n");

  const rpcs = [
    { name: "Polygon Official", url: "https://polygon-rpc.com/" },
    { name: "Matic Network", url: "https://rpc-mainnet.matic.network/" },
    { name: "MaticVigil", url: "https://rpc-mainnet.maticvigil.com/" },
    { name: "Terminet", url: "https://polygonapi.terminet.io/rpc" },
  ];

  console.log("Testing public RPC endpoints:");

  for (const rpc of rpcs) {
    try {
      const start = Date.now();
      const result = await makeRpcCall(rpc.url, {
        jsonrpc: "2.0",
        method: "eth_chainId",
        params: [],
        id: 1,
      });
      const duration = Date.now() - start;

      const chainId = parseInt(result.result, 16);
      if (chainId === 137) {
        console.log(`✅ ${rpc.name}: ${duration}ms`);
      } else {
        console.log(`❌ ${rpc.name}: Wrong chain (${chainId})`);
      }
    } catch (error) {
      console.log(`❌ ${rpc.name}: ${error.message}`);
    }
  }

  console.log("\n💡 Tip: Use the fastest RPC for best performance!");
}

// Run the tests
async function main() {
  try {
    await testPolygonConnection();
    await testAlternativeRpcs();
  } catch (error) {
    console.error("Test failed:", error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { testPolygonConnection, testAlternativeRpcs };
