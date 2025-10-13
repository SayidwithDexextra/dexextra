const { ethers } = require("ethers");

/**
 * Script to verify if contracts are actually deployed at the expected addresses
 */

const CONTRACTS = {
  tradingRouter: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
  orderBookFactory: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
  aluminumOrderBook: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
  vaultRouter: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
  upgradeManager: "0xD1b426e3BB28E773cFB318Fc982b07d1c500171b",
  mockUSDC: "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289",
};

async function main() {
  console.log("🔍 Checking Contract Deployments...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  for (const [name, address] of Object.entries(CONTRACTS)) {
    console.log(`📋 Checking ${name}: ${address}`);

    try {
      // Check if there's code at the address
      const code = await provider.getCode(address);

      if (code === "0x") {
        console.log(`   ❌ NO CONTRACT CODE - Address is EOA or empty!`);
      } else {
        console.log(`   ✅ Contract exists (${code.length} bytes)`);

        // Try to get basic info
        try {
          const balance = await provider.getBalance(address);
          console.log(`   💰 Balance: ${ethers.formatEther(balance)} MATIC`);
        } catch (err) {
          console.log(`   ⚠️  Could not get balance: ${err.message}`);
        }
      }
    } catch (err) {
      console.log(`   ❌ Error checking contract: ${err.message}`);
    }

    console.log("");
  }

  // Check if we can call basic view functions
  console.log("📋 Testing Basic Contract Calls...\n");

  // Test Factory
  try {
    const factoryABI = [
      "function getAllMarkets() external view returns (bytes32[])",
    ];
    const factory = new ethers.Contract(
      CONTRACTS.orderBookFactory,
      factoryABI,
      provider
    );
    const markets = await factory.getAllMarkets();
    console.log(
      `✅ Factory.getAllMarkets() works - Found ${markets.length} markets`
    );
  } catch (err) {
    console.log(`❌ Factory.getAllMarkets() failed: ${err.message}`);
  }

  // Test TradingRouter with minimal ABI
  try {
    const routerABI = ["function factory() external view returns (address)"];
    const router = new ethers.Contract(
      CONTRACTS.tradingRouter,
      routerABI,
      provider
    );
    const factoryAddr = await router.factory();
    console.log(`✅ TradingRouter.factory() works - Returns: ${factoryAddr}`);
  } catch (err) {
    console.log(`❌ TradingRouter.factory() failed: ${err.message}`);
  }
}

main()
  .then(() => {
    console.log("✅ Contract deployment check completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Script error:", error);
    process.exit(1);
  });
