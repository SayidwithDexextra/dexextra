const { ethers } = require("hardhat");

async function main() {
  console.log("🔐 Authorizing VAMM Deployer...\n");

  // Get the deployer (should be the owner of the factory)
  const signers = await ethers.getSigners();

  if (signers.length === 0) {
    console.error("❌ No signers found. Check your private key in .env file.");
    console.error(
      "   Make sure PRIVATE_KEY is set and is a valid 64-character hex string."
    );
    process.exit(1);
  }

  const [deployer] = signers;
  console.log("📍 Authorizing with owner account:", deployer.address);

  try {
    const balance = await deployer.provider.getBalance(deployer.address);
    console.log("💰 Owner balance:", ethers.formatEther(balance), "MATIC\n");
  } catch (error) {
    console.log("💰 Owner balance: Unable to fetch balance\n");
  }

  // Contract addresses - Update these with your deployed contract addresses
  const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356"; // Your factory address from the error

  // Address to authorize - Replace this with the wallet address you want to authorize
  const USER_ADDRESS_TO_AUTHORIZE =
    "0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb"; // Replace with the actual wallet address

  if (USER_ADDRESS_TO_AUTHORIZE === "YOUR_WALLET_ADDRESS_HERE") {
    console.error(
      "❌ Please update USER_ADDRESS_TO_AUTHORIZE with the actual wallet address you want to authorize"
    );
    process.exit(1);
  }

  // Get the factory contract
  const factory = await ethers.getContractAt(
    "MetricVAMMFactory",
    FACTORY_ADDRESS
  );

  // Check current authorization status
  const isCurrentlyAuthorized = await factory.authorizedDeployers(
    USER_ADDRESS_TO_AUTHORIZE
  );
  console.log(
    `📋 Current authorization status for ${USER_ADDRESS_TO_AUTHORIZE}: ${isCurrentlyAuthorized}`
  );

  if (isCurrentlyAuthorized) {
    console.log("✅ Address is already authorized!");
    return;
  }

  // Authorize the user address
  console.log(
    `🔓 Authorizing ${USER_ADDRESS_TO_AUTHORIZE} as a VAMM deployer...`
  );

  try {
    const authorizeTx = await factory.setAuthorizedDeployer(
      USER_ADDRESS_TO_AUTHORIZE,
      true
    );
    await authorizeTx.wait();

    console.log("✅ Authorization transaction completed!");
    console.log(`📝 Transaction hash: ${authorizeTx.hash}`);

    // Verify authorization
    const isNowAuthorized = await factory.authorizedDeployers(
      USER_ADDRESS_TO_AUTHORIZE
    );
    console.log(
      `🔍 Verification - Address is now authorized: ${isNowAuthorized}`
    );

    if (isNowAuthorized) {
      console.log(
        "\n🎉 SUCCESS! The address is now authorized to deploy VAMMs."
      );
      console.log(
        "💡 You can now use the VAMMWizard to deploy contracts without authorization errors."
      );
    } else {
      console.log(
        "\n❌ ERROR: Authorization failed. Please check the transaction and try again."
      );
    }
  } catch (error) {
    console.error("❌ Authorization failed:", error.message);

    if (error.message.includes("only owner")) {
      console.log(
        "\n💡 SOLUTION: This script must be run by the owner of the MetricVAMMFactory contract."
      );
      console.log(
        "   Either run this script with the owner's private key, or ask the owner to authorize your address."
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
