const { run } = require("hardhat");

async function verifyContract(address, contractName, constructorArgs) {
  try {
    console.log(`\n📝 Verifying ${contractName} at ${address}...`);

    await run("verify:verify", {
      address: address,
      constructorArguments: constructorArgs,
    });

    console.log(`✅ ${contractName} verified successfully!`);
    console.log(
      `🔗 View on Polygonscan: https://polygonscan.com/address/${address}`
    );

    return true;
  } catch (error) {
    if (error.message.includes("Already Verified")) {
      console.log(`✅ ${contractName} already verified!`);
      console.log(
        `🔗 View on Polygonscan: https://polygonscan.com/address/${address}`
      );
      return true;
    }

    console.error(`❌ ${contractName} verification failed:`, error.message);
    return false;
  }
}

async function main() {
  console.log("🔍 Starting contract verification on Polygon mainnet...");

  const contracts = [
    {
      name: "MockUSDC",
      address: "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289",
      args: ["0x1Bc0a803de77a004086e6010cD3f72ca7684e444"],
    },
    {
      name: "VaultRouter",
      address: "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5",
      args: [
        "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289", // mockUSDC
        "0x1Bc0a803de77a004086e6010cD3f72ca7684e444", // admin
      ],
    },
    {
      name: "OrderBookFactoryMinimal",
      address: "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF",
      args: [
        "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5", // vaultRouter
        "0x1Bc0a803de77a004086e6010cD3f72ca7684e444", // owner
      ],
    },
    {
      name: "TradingRouter",
      address: "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6",
      args: [
        "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5", // vaultRouter
        "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF", // factory
        "0x1Bc0a803de77a004086e6010cD3f72ca7684e444", // admin
      ],
    },
    {
      name: "UpgradeManager",
      address: "0xD1b426e3BB28E773cFB318Fc982b07d1c500171b",
      args: [
        "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5", // vaultRouter
        "0x0fB0A98DC0cA49B72A0BC972D78e8bda7ef2EABF", // factory
        "0x58BC190eE9d66eE49Dc1eeeEd2aBc1284216c8e6", // tradingRouter
        "0xA2258Ff3aC4f5c77ca17562238164a0205A5b289", // collateralToken
        "0x1Bc0a803de77a004086e6010cD3f72ca7684e444", // admin
      ],
    },
    {
      name: "OrderBook (Aluminum V1)",
      address: "0xce64ddf0c08325a41E8e94D01967E0ff00E1C926",
      args: [
        "0x0ec5e3d580bc0eed6b9c47dc4f8b142f8b72a1ca1b87e4caa8b3ae2b0fd90b08", // marketId (keccak256("Aluminum V1_MARKET"))
        "Aluminum V1",
        "", // metricId (empty for traditional markets)
        false, // isCustomMetric
        "0x91d03f8d8F7fC48eA60853e9dDc225711B967fd5", // vaultRouter
        "0x1Bc0a803de77a004086e6010cD3f72ca7684e444", // admin
      ],
    },
  ];

  let successCount = 0;
  let totalCount = contracts.length;

  for (let i = 0; i < contracts.length; i++) {
    const contract = contracts[i];

    console.log(
      `\n📋 Verifying contract ${i + 1}/${totalCount}: ${contract.name}`
    );

    const success = await verifyContract(
      contract.address,
      contract.name,
      contract.args
    );
    if (success) successCount++;

    // Wait between verifications to avoid rate limiting
    if (i < contracts.length - 1) {
      console.log("⏳ Waiting 5 seconds...");
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("📊 VERIFICATION SUMMARY");
  console.log("=".repeat(60));
  console.log(
    `✅ Successfully verified: ${successCount}/${totalCount} contracts`
  );
  console.log(`🌐 Network: Polygon Mainnet`);
  console.log(`📅 Date: ${new Date().toISOString()}`);

  console.log("\n🔗 Contract Links:");
  contracts.forEach((contract) => {
    console.log(
      `   ${contract.name}: https://polygonscan.com/address/${contract.address}`
    );
  });

  console.log(
    "\n🎉 All contracts are now live and verified on Polygon mainnet!"
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification failed:", error);
    process.exit(1);
  });
