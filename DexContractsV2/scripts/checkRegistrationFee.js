const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking MetricRegistry Registration Requirements...\n");

  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";

  try {
    // Get the factory and metric registry
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );
    const metricRegistryAddress = await factory.metricRegistry();
    console.log("📍 MetricRegistry Address:", metricRegistryAddress);

    const metricRegistry = await ethers.getContractAt(
      "MetricRegistry",
      metricRegistryAddress
    );

    // Try to get registration fee
    try {
      const registrationFee = await metricRegistry.registrationFee();
      console.log(
        "💰 Required Registration Fee:",
        ethers.formatEther(registrationFee),
        "MATIC"
      );
    } catch (error) {
      console.log("⚠️ Could not read registration fee from contract");
    }

    // Try to get minimum stake
    try {
      const minimumStake = await metricRegistry.minimumStake();
      console.log(
        "🔒 Minimum Stake:",
        ethers.formatEther(minimumStake),
        "MATIC"
      );
    } catch (error) {
      console.log("⚠️ Could not read minimum stake from contract");
    }

    // Check owner
    try {
      const owner = await metricRegistry.owner();
      console.log("👑 MetricRegistry Owner:", owner);

      const [signer] = await ethers.getSigners();
      const isOwner = signer.address.toLowerCase() === owner.toLowerCase();
      console.log("🔍 Are you the owner?", isOwner);
    } catch (error) {
      console.log("⚠️ Could not read owner from contract");
    }
  } catch (error) {
    console.error("❌ Error checking registry:", error.message);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
