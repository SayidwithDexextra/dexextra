const { ethers } = require("ethers");

const TX_HASH =
  "0xc481ecb237876e30d9e6a085aa50d48e176b3fde4521cacd63a850a5dc1a32bd";

async function main() {
  console.log("🔍 Checking Transaction Details...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  try {
    // Get transaction receipt
    const receipt = await provider.getTransactionReceipt(TX_HASH);

    if (!receipt) {
      console.log("❌ Transaction not found");
      return;
    }

    console.log("📋 Transaction Details:");
    console.log(`   Hash: ${receipt.hash}`);
    console.log(
      `   Status: ${receipt.status === 1 ? "✅ SUCCESS" : "❌ FAILED"}`
    );
    console.log(`   Block: ${receipt.blockNumber}`);
    console.log(`   Gas Used: ${receipt.gasUsed}`);
    console.log(`   To: ${receipt.to}`);

    console.log("\n📋 Events/Logs:");
    if (receipt.logs.length === 0) {
      console.log(
        "   ⚠️ No events emitted - this might indicate the function reverted silently"
      );
    } else {
      receipt.logs.forEach((log, index) => {
        console.log(`   ${index + 1}. Address: ${log.address}`);
        console.log(`      Topics: ${log.topics.join(", ")}`);
        console.log(`      Data: ${log.data}`);
      });
    }

    // Check current block to see if there's a delay
    const currentBlock = await provider.getBlockNumber();
    const blockDiff = currentBlock - receipt.blockNumber;
    console.log(`\n📋 Confirmation Info:`);
    console.log(`   Transaction Block: ${receipt.blockNumber}`);
    console.log(`   Current Block: ${currentBlock}`);
    console.log(`   Confirmations: ${blockDiff}`);

    if (blockDiff < 10) {
      console.log(
        "   ⚠️ Transaction is very recent - state changes might need more confirmations"
      );
    }
  } catch (error) {
    console.log(`❌ Error: ${error.message}`);
  }
}

main().catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
});
