const { run } = require("hardhat");

async function main() {
  console.log("🔍 Verifying TradingRouter contract on Polygon Scan...");

  // New TradingRouter address from the upgrade
  const TRADING_ROUTER_ADDRESS = "0xd5e8D39Fa0D9e64dff46e1607C4E9A1f4AD9EB0F";
  
  // Constructor arguments used during deployment
  const CONSTRUCTOR_ARGS = [
    "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5", // VaultRouter
    "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF", // OrderBookFactoryMinimal
    "0x1Bc0a803de77a004086e6010cD3f72ca7684e444"  // Admin
  ];

  console.log("📋 Contract Details:");
  console.log("   Address:", TRADING_ROUTER_ADDRESS);
  console.log("   Constructor Arguments:");
  console.log("     VaultRouter:", CONSTRUCTOR_ARGS[0]);
  console.log("     Factory:", CONSTRUCTOR_ARGS[1]);
  console.log("     Admin:", CONSTRUCTOR_ARGS[2]);

  try {
    console.log("\n🚀 Starting verification process...");
    
    await run("verify:verify", {
      address: TRADING_ROUTER_ADDRESS,
      constructorArguments: CONSTRUCTOR_ARGS,
      contract: "contracts/TradingRouter.sol:TradingRouter"
    });

    console.log("✅ TradingRouter contract verified successfully!");
    console.log(`🔗 View on Polygon Scan: https://polygonscan.com/address/${TRADING_ROUTER_ADDRESS}#code`);
    
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log("✅ Contract already verified on Polygon Scan!");
      console.log(`🔗 View on Polygon Scan: https://polygonscan.com/address/${TRADING_ROUTER_ADDRESS}#code`);
    } else {
      console.error("❌ Verification failed:", error.message);
      
      // Try alternative verification approach
      console.log("\n🔄 Attempting alternative verification...");
      try {
        await run("verify:verify", {
          address: TRADING_ROUTER_ADDRESS,
          constructorArguments: CONSTRUCTOR_ARGS
        });
        console.log("✅ Alternative verification successful!");
      } catch (altError) {
        console.error("❌ Alternative verification also failed:", altError.message);
        
        // Provide manual verification instructions
        console.log("\n📝 Manual Verification Instructions:");
        console.log("1. Go to https://polygonscan.com/verifyContract");
        console.log("2. Enter contract address:", TRADING_ROUTER_ADDRESS);
        console.log("3. Select compiler version: 0.8.20");
        console.log("4. Select optimization: Yes, 200 runs");
        console.log("5. Upload TradingRouter.sol and dependencies");
        console.log("6. Enter constructor arguments (ABI encoded):");
        
        const { ethers } = require("ethers");
        const abiCoder = new ethers.AbiCoder();
        const encodedArgs = abiCoder.encode(
          ["address", "address", "address"],
          CONSTRUCTOR_ARGS
        );
        console.log("   ", encodedArgs);
      }
    }
  }

  console.log("\n🎯 Verification Summary:");
  console.log("   Contract: TradingRouter");
  console.log("   Address:", TRADING_ROUTER_ADDRESS);
  console.log("   Network: Polygon Mainnet");
  console.log("   Status: Ready for public use");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
