const { ethers } = require("ethers");

// Test script to verify logIndex extraction works correctly
async function testLogIndexExtraction() {
  console.log("🧪 Testing logIndex extraction...");

  // Connect to your RPC provider
  const provider = new ethers.JsonRpcProvider(
    process.env.RPC_URL || "http://127.0.0.1:8545"
  );

  try {
    // Get current block
    const currentBlock = await provider.getBlockNumber();
    console.log(`Current block: ${currentBlock}`);

    // Query recent blocks for events
    const fromBlock = Math.max(0, currentBlock - 100);
    const toBlock = currentBlock;

    console.log(`Querying blocks ${fromBlock} to ${toBlock} for events...`);

    const logs = await provider.getLogs({
      fromBlock,
      toBlock,
    });

    console.log(`Found ${logs.length} logs in recent blocks`);

    // Check logIndex properties in the logs
    logs.slice(0, 10).forEach((log, i) => {
      console.log(`\nLog ${i + 1}:`);
      console.log(`  Transaction: ${log.transactionHash}`);
      console.log(`  Block: ${log.blockNumber}`);
      console.log(`  log.logIndex: ${log.logIndex}`);
      console.log(`  log.index: ${log.index}`);
      console.log(`  logIndex type: ${typeof log.logIndex}`);
      console.log(`  index type: ${typeof log.index}`);

      // Test our extraction logic
      let extractedLogIndex = log.logIndex;
      if (extractedLogIndex === null || extractedLogIndex === undefined) {
        extractedLogIndex = log.index;
      }
      console.log(`  ✅ Extracted logIndex: ${extractedLogIndex}`);
    });

    // Check if we have transactions with multiple events
    const txWithMultipleEvents = {};
    logs.forEach((log) => {
      const tx = log.transactionHash;
      if (!txWithMultipleEvents[tx]) {
        txWithMultipleEvents[tx] = [];
      }
      txWithMultipleEvents[tx].push({
        logIndex: log.logIndex || log.index,
        address: log.address,
      });
    });

    console.log("\n📊 Transactions with multiple events:");
    Object.entries(txWithMultipleEvents)
      .filter(([_, events]) => events.length > 1)
      .slice(0, 5)
      .forEach(([tx, events]) => {
        console.log(`  ${tx}:`);
        events.forEach((event, i) => {
          console.log(
            `    Event ${i}: logIndex=${
              event.logIndex
            }, contract=${event.address.slice(0, 10)}...`
          );
        });
      });
  } catch (error) {
    console.error("❌ Test failed:", error);
  }
}

// Run the test
testLogIndexExtraction();
