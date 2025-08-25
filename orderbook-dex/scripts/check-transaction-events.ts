import { ethers } from "hardhat";

const TX_HASH = "0xdd48a6f78df2f08596465992c0771319654c512ca293789d3f4d546d11105b1b";
const ORDER_ROUTER_ADDRESS = "0x516a1790a04250FC6A5966A528D02eF20E1c1891";

async function main() {
  console.log("🔍 Analyzing Transaction Events and Topics");
  console.log("=========================================");
  console.log(`Transaction: ${TX_HASH}`);
  
  const provider = ethers.provider;
  const orderRouter = await ethers.getContractAt("OrderRouter", ORDER_ROUTER_ADDRESS);
  
  // Get transaction receipt
  const receipt = await provider.getTransactionReceipt(TX_HASH);
  if (!receipt) {
    console.error("❌ Transaction not found");
    return;
  }
  
  console.log(`\n📋 Transaction Details:`);
  console.log(`  Block: ${receipt.blockNumber}`);
  console.log(`  Gas Used: ${receipt.gasUsed.toString()}`);
  console.log(`  Status: ${receipt.status === 1 ? "Success" : "Failed"}`);
  console.log(`  Logs Count: ${receipt.logs.length}`);
  
  console.log(`\n🏷️  All Event Topics and Hashes:`);
  console.log("================================");
  
  for (let i = 0; i < receipt.logs.length; i++) {
    const log = receipt.logs[i];
    console.log(`\nLog ${i}:`);
    console.log(`  Address: ${log.address}`);
    console.log(`  Topics:`);
    
    for (let j = 0; j < log.topics.length; j++) {
      console.log(`    [${j}] ${log.topics[j]}`);
    }
    
    console.log(`  Data: ${log.data}`);
    
    // Try to decode if it's from OrderRouter
    if (log.address.toLowerCase() === ORDER_ROUTER_ADDRESS.toLowerCase()) {
      try {
        const parsed = orderRouter.interface.parseLog(log);
        if (parsed) {
          console.log(`  🎯 Decoded Event: ${parsed.name}`);
          console.log(`  📊 Event Signature: ${orderRouter.interface.getEvent(parsed.name).topicHash}`);
          console.log(`  📋 Args:`, parsed.args);
          
          if (parsed.name === "OrderPlaced") {
            console.log(`\n✅ ORDER PLACED EVENT FOUND!`);
            console.log(`   Event Hash: ${parsed.topic}`);
            console.log(`   Order ID: ${parsed.args[0].toString()}`);
            console.log(`   Trader: ${parsed.args[1]}`);
            console.log(`   Metric ID: ${parsed.args[2]}`);
            console.log(`   Order Type: ${parsed.args[3]} (${parsed.args[3] === 1 ? "LIMIT" : "MARKET"})`);
            console.log(`   Side: ${parsed.args[4]} (${parsed.args[4] === 0 ? "BUY" : "SELL"})`);
            console.log(`   Quantity: ${ethers.formatEther(parsed.args[5])} units`);
            console.log(`   Price: ${ethers.formatEther(parsed.args[6])} ETH`);
          }
        }
      } catch (error) {
        console.log(`  ❌ Could not decode: ${error.message}`);
      }
    }
  }
  
  // Show event signatures for reference
  console.log(`\n📖 OrderRouter Event Signatures:`);
  console.log("=================================");
  
  const events = [
    "OrderPlaced",
    "OrderCancelled", 
    "OrderExecuted",
    "OrderMatched"
  ];
  
  for (const eventName of events) {
    try {
      const eventFragment = orderRouter.interface.getEvent(eventName);
      console.log(`${eventName}:`);
      console.log(`  Topic Hash: ${eventFragment.topicHash}`);
      console.log(`  Signature: ${eventFragment.format()}`);
    } catch (error) {
      console.log(`${eventName}: Not found in interface`);
    }
  }
  
  // Also check OrderBook events
  console.log(`\n📖 OrderBook Event Signatures:`);
  console.log("==============================");
  
  try {
    const orderBook = await ethers.getContractAt("OrderBook", "0x0000000000000000000000000000000000000000"); // Just for interface
    
    const obEvents = [
      "OrderAdded",
      "OrderRemoved",
      "OrderMatched", 
      "OrderExecuted"
    ];
    
    for (const eventName of obEvents) {
      try {
        const eventFragment = orderBook.interface.getEvent(eventName);
        console.log(`${eventName}:`);
        console.log(`  Topic Hash: ${eventFragment.topicHash}`);
        console.log(`  Signature: ${eventFragment.format()}`);
      } catch (error) {
        console.log(`${eventName}: Not found in OrderBook interface`);
      }
    }
  } catch (error) {
    console.log("Could not load OrderBook interface");
  }
}

main()
  .then(() => {
    console.log("\n✅ Event analysis completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
