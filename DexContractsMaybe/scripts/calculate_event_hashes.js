const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Calculating Event Hashes for SimpleVAMM Contract\n");

  // Define the event signatures
  const eventSignatures = [
    "AuthorizedAdded(address)",
    "AuthorizedRemoved(address)",
    "PositionClosed(address,uint256,uint256,uint256,int256)",
    "PositionOpened(address,uint256,bool,uint256,uint256,uint256)",
    "PriceUpdated(uint256,int256)",
  ];

  console.log("📋 Event Signatures and Their Hashes:\n");
  console.log("=".repeat(60));

  const eventHashes = {};

  eventSignatures.forEach((signature) => {
    const hash = ethers.id(signature);
    eventHashes[signature] = hash;

    console.log(`Event: ${signature}`);
    console.log(`Hash:  ${hash}`);
    console.log("-".repeat(60));
  });

  console.log("\n🎯 For Alchemy Webhook Configuration:\n");

  // Format for easy copy-paste into Alchemy webhook setup
  console.log("Event Topics (for webhook filters):");
  Object.entries(eventHashes).forEach(([signature, hash]) => {
    const eventName = signature.split("(")[0];
    console.log(`  ${eventName}: ${hash}`);
  });

  console.log("\n📊 JSON Format for Webhook Setup:");
  console.log(
    JSON.stringify(
      {
        contractAddress: "0x487f1baE58CE513B39889152E96Eb18a346c75b1",
        events: Object.entries(eventHashes).map(([signature, hash]) => ({
          name: signature.split("(")[0],
          signature: signature,
          topic0: hash,
        })),
      },
      null,
      2
    )
  );

  console.log("\n🔧 Key Trading Events (Most Important for Monitoring):");
  console.log(
    `  PositionOpened:  ${eventHashes["PositionOpened(address,uint256,bool,uint256,uint256,uint256)"]}`
  );
  console.log(
    `  PositionClosed:  ${eventHashes["PositionClosed(address,uint256,uint256,uint256,int256)"]}`
  );
  console.log(
    `  PriceUpdated:    ${eventHashes["PriceUpdated(uint256,int256)"]}`
  );

  console.log("\n✅ Event hashes calculated successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error calculating event hashes:", error);
    process.exit(1);
  });
