const { saveDeploymentToSupabase } = require("./save_to_supabase.js");

async function main() {
  console.log("💾 Saving Polygon Mainnet deployment data to Supabase...\n");

  // Actual deployment data from the successful deployment
  const deploymentData = {
    network: "polygon",
    chainId: 137,
    deployer: "0x14A2b07Eec1F8D1Ef0f9deEef9a352c432269cdb",
    contracts: {
      SimpleUSDC: "0x59d8f917b25f26633d173262A59136Eb326a76c1",
      SimplePriceOracle: "0x7c63Ac8d8489a21cB12c7088b377732CC1208beC",
      SimpleVault: "0x3e2928b4123AF4e42F9373b57fb1DD68Fd056bc9",
      SimpleVAMM: "0xfEAA2a60449E11935C636b9E42866Fd0cBbdF2ed",
    },
    deploymentTime: "2025-07-18T02:28:54.281Z",
    initialPrice: "100",
    initialSupply: "1000000000",
    txHashes: {
      usdc: "0xa9a5a96f2f87055851f23ee132cad2dc62d4bbf8a3680cf7b8b5c9f4d3a50196",
      oracle:
        "0x7401dc6268c2f119e9389af93394b16640df8aa9702b5313bca665dbdb7f2b17",
      vault:
        "0x08078887a0cc7562b1e62bf0c587ef9ace151bb6c3612fc02506564404bf86d0",
      vamm: "0xe900e947d786472bf22f8ed4407c854595b1d39ada48d130c0170ffb70c03c3e",
    },
  };

  try {
    const result = await saveDeploymentToSupabase(deploymentData);

    console.log("\n🎉 Successfully saved deployment data to Supabase!");
    console.log("✅ Deployment ID:", result.deploymentId);
    console.log("✅ Market ID:", result.marketId);
    console.log("✅ Contracts updated:", result.contractsUpdated);

    console.log("\n📝 Next steps:");
    console.log("1. Frontend has been updated with new contract addresses");
    console.log("2. Deployment data is saved to Supabase");
    console.log("3. Traditional futures market is ready for testing!");
  } catch (error) {
    console.error("❌ Error saving to Supabase:", error);
    console.log(
      "\n📝 If Supabase tables don't exist yet, here's the data to save manually:"
    );
    console.log(JSON.stringify(deploymentData, null, 2));
  }
}

if (require.main === module) {
  main()
    .then(() => {
      console.log("✅ Save script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("❌ Save script failed:", error);
      process.exit(1);
    });
}

module.exports = main;
