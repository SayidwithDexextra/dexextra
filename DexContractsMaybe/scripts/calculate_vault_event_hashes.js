const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Calculating Event Hashes for SimpleVault Contract\n");

  // Define the vault event signatures
  const vaultEventSignatures = [
    "CollateralDeposited(address,uint256)",
    "CollateralWithdrawn(address,uint256)",
    "MarginReserved(address,uint256)",
    "MarginReleased(address,uint256)",
    "PnLUpdated(address,int256)",
  ];

  console.log("📋 Vault Event Signatures and Their Hashes:\n");
  console.log("=".repeat(60));

  const vaultEventHashes = {};

  vaultEventSignatures.forEach((signature) => {
    const hash = ethers.id(signature);
    vaultEventHashes[signature] = hash;

    console.log(`Event: ${signature}`);
    console.log(`Hash:  ${hash}`);
    console.log("-".repeat(60));
  });

  console.log("\n🎯 SimpleVault Event Topics (for webhook filters):");
  Object.entries(vaultEventHashes).forEach(([signature, hash]) => {
    const eventName = signature.split("(")[0];
    console.log(`  ${eventName}: ${hash}`);
  });

  console.log("\n📊 Complete Vault Events JSON:");
  console.log(
    JSON.stringify(
      {
        contractAddress: "0x2C8d16222d4A1065285f28FA7fB7C6cF5cf7094e",
        events: Object.entries(vaultEventHashes).map(([signature, hash]) => ({
          name: signature.split("(")[0],
          signature: signature,
          topic0: hash,
        })),
      },
      null,
      2
    )
  );

  console.log("\n💰 Key Vault Events for Monitoring:");
  console.log(
    `  CollateralDeposited: ${vaultEventHashes["CollateralDeposited(address,uint256)"]}`
  );
  console.log(
    `  CollateralWithdrawn: ${vaultEventHashes["CollateralWithdrawn(address,uint256)"]}`
  );
  console.log(
    `  MarginReserved:      ${vaultEventHashes["MarginReserved(address,uint256)"]}`
  );
  console.log(
    `  MarginReleased:      ${vaultEventHashes["MarginReleased(address,uint256)"]}`
  );

  console.log("\n✅ Vault event hashes calculated successfully!");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Error calculating vault event hashes:", error);
    process.exit(1);
  });
