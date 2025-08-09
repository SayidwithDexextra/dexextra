const { ethers } = require("hardhat");

async function main() {
  console.log("🔍 Checking MetricVAMMFactory Owner...\n");

  // Contract addresses
  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";
  const USER_ADDRESS = "0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb";

  console.log("📍 Factory Address:", FACTORY_ADDRESS);
  console.log("👤 Your Address:", USER_ADDRESS);

  try {
    // Get the factory contract (read-only)
    const factory = await ethers.getContractAt(
      "MetricVAMMFactory",
      FACTORY_ADDRESS
    );

    // Check owner
    console.log("\n🔍 Checking contract details...");
    const owner = await factory.owner();
    console.log("👑 Factory Owner:", owner);

    // Check if user is already authorized
    const isAuthorized = await factory.authorizedDeployers(USER_ADDRESS);
    console.log("🔐 Your Authorization Status:", isAuthorized);

    // Check if user is the owner
    const isOwner = USER_ADDRESS.toLowerCase() === owner.toLowerCase();
    console.log("👑 Are you the owner?", isOwner);

    console.log("\n📋 SUMMARY:");
    console.log("=".repeat(50));

    if (isOwner) {
      console.log("✅ You are the factory owner!");
      console.log(
        "💡 You can authorize yourself by running the authorization script with your private key."
      );
    } else if (isAuthorized) {
      console.log("✅ You are already authorized to deploy VAMMs!");
      console.log(
        "💡 You should be able to use the VAMMWizard without issues."
      );
    } else {
      console.log("❌ You are not authorized to deploy VAMMs.");
      console.log(
        `💡 Contact the factory owner (${owner}) to get authorization.`
      );
      console.log("   Or ask them to run this script:");
      console.log(
        `   await factory.setAuthorizedDeployer("${USER_ADDRESS}", true)`
      );
    }

    // Additional info
    console.log("\n🛠️ NEXT STEPS:");
    if (isOwner) {
      console.log("1. Add your private key to the .env file");
      console.log("2. Add your Alchemy API key to the .env file");
      console.log(
        "3. Run: npx hardhat run scripts/authorizeDeployer.js --network polygon"
      );
    } else if (!isAuthorized) {
      console.log("1. Contact the factory owner to authorize your address");
      console.log("2. Or use a different wallet that is already authorized");
    } else {
      console.log(
        "1. You're already authorized! Try using the VAMMWizard again."
      );
    }
  } catch (error) {
    console.error("❌ Error checking factory:", error.message);

    if (error.message.includes("network")) {
      console.log(
        "\n💡 Network connection issue. Make sure you have internet access."
      );
    } else if (error.message.includes("contract")) {
      console.log(
        "\n💡 Contract not found. The factory address might be incorrect."
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
