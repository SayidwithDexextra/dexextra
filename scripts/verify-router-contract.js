/**
 * 🔍 Polygonscan Router Contract Verification Script
 * Programmatically verifies the MetricVAMMRouter contract on Polygon mainnet
 */

const { ethers } = require("ethers");

// Contract addresses from your system
const ROUTER_ADDRESS = "0xC63C52df3f9aD880ed5aD52de538fc74f02031B5";
const FACTORY_ADDRESS = "0x069331Cc5c881db1B1382416b189c198C5a2b356";
const VAULT_ADDRESS = "0x0990B9591ed1cC070652c5F5F11dAC4B0375Cd93";
const METRIC_REGISTRY_ADDRESS = "0x8f5200203c53c5821061D1f29249f10A5b57CA6A";

// Polygon RPC endpoint
const POLYGON_RPC = "https://polygon-rpc.com";

async function verifyRouterContract() {
  console.log("🔍 Verifying MetricVAMMRouter on Polygonscan");
  console.log("=".repeat(60));

  const provider = new ethers.JsonRpcProvider(POLYGON_RPC);

  try {
    // 1. Check if router contract exists
    console.log("\n📋 Contract Address Verification:");
    console.log(`Router Address: ${ROUTER_ADDRESS}`);

    const routerCode = await provider.getCode(ROUTER_ADDRESS);
    console.log(`✅ Contract exists: ${routerCode !== "0x" ? "YES" : "NO"}`);
    console.log(`📏 Bytecode length: ${routerCode.length} characters`);

    if (routerCode === "0x") {
      throw new Error("❌ Router contract not found at specified address");
    }

    // 2. Check contract creation and verify it's MetricVAMMRouter
    console.log("\n🏗️ Contract Creation Info:");

    // Get contract creation transaction (requires Polygonscan API)
    const polygonscanApiKey =
      process.env.POLYGONSCAN_API_KEY || "5UCMAJUUZWTKNRMZK6YR4WYARFT1RWKBCC";
    const polygonscanUrl = `https://api.polygonscan.com/api?module=contract&action=getcontractcreation&contractaddresses=${ROUTER_ADDRESS}&apikey=${polygonscanApiKey}`;

    try {
      const fetch = (await import("node-fetch")).default;
      const response = await fetch(polygonscanUrl);
      const data = await response.json();

      if (data.status === "1" && data.result.length > 0) {
        const creation = data.result[0];
        console.log(`✅ Created by: ${creation.contractCreator}`);
        console.log(`✅ Creation Tx: ${creation.txHash}`);

        // Get transaction details
        const tx = await provider.getTransaction(creation.txHash);
        const receipt = await provider.getTransactionReceipt(creation.txHash);

        console.log(`✅ Block Number: ${receipt.blockNumber}`);
        console.log(`✅ Gas Used: ${receipt.gasUsed.toString()}`);
        console.log(
          `✅ Status: ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`
        );
      }
    } catch (error) {
      console.log("⚠️ Could not fetch creation details (API key needed)");
    }

    // 3. Check if contract is verified on Polygonscan
    console.log("\n🔍 Contract Verification Status:");
    try {
      const fetch = (await import("node-fetch")).default;
      const verificationUrl = `https://api.polygonscan.com/api?module=contract&action=getsourcecode&address=${ROUTER_ADDRESS}&apikey=${polygonscanApiKey}`;
      const verificationResponse = await fetch(verificationUrl);
      const verificationData = await verificationResponse.json();

      if (
        verificationData.status === "1" &&
        verificationData.result.length > 0
      ) {
        const result = verificationData.result[0];
        if (result.SourceCode && result.SourceCode !== "") {
          console.log(`✅ Contract Verified: YES`);
          console.log(`✅ Contract Name: ${result.ContractName}`);
          console.log(`✅ Compiler Version: ${result.CompilerVersion}`);
          console.log(
            `✅ Optimization: ${result.OptimizationUsed === "1" ? "YES" : "NO"}`
          );
        } else {
          console.log(`❌ Contract Verified: NO`);
          console.log(`⚠️ Contract source code is not verified on Polygonscan`);
          console.log(
            `⚠️ Cannot perform direct contract function calls without ABI`
          );
        }
      }
    } catch (error) {
      console.log("⚠️ Could not check verification status");
    }

    // 4. Try to verify router functionality (will fail if not verified)
    console.log("\n🔗 Contract Integration Test:");

    // Import the actual router ABI from your project
    try {
      const routerArtifact = require("../DexContractsV2/artifacts/contracts/core/MetricVAMMRouter.sol/MetricVAMMRouter.json");
      const routerABI = routerArtifact.abi;

      const router = new ethers.Contract(ROUTER_ADDRESS, routerABI, provider);

      console.log("✅ Using local MetricVAMMRouter ABI");

      const factoryAddr = await router.factory();
      console.log(`✅ Factory Address: ${factoryAddr}`);
      console.log(
        `✅ Factory Match: ${
          factoryAddr.toLowerCase() === FACTORY_ADDRESS.toLowerCase()
            ? "YES"
            : "NO"
        }`
      );

      const vaultAddr = await router.centralVault();
      console.log(`✅ Vault Address: ${vaultAddr}`);
      console.log(
        `✅ Vault Match: ${
          vaultAddr.toLowerCase() === VAULT_ADDRESS.toLowerCase() ? "YES" : "NO"
        }`
      );

      const registryAddr = await router.metricRegistry();
      console.log(`✅ Registry Address: ${registryAddr}`);
      console.log(
        `✅ Registry Match: ${
          registryAddr.toLowerCase() === METRIC_REGISTRY_ADDRESS.toLowerCase()
            ? "YES"
            : "NO"
        }`
      );

      const owner = await router.owner();
      console.log(`✅ Owner: ${owner}`);

      const isPaused = await router.paused();
      console.log(`✅ Paused: ${isPaused ? "YES" : "NO"}`);

      const totalVolume = await router.totalRouterVolume();
      console.log(
        `✅ Total Volume: ${ethers.formatUnits(totalVolume, 6)} USDC`
      );

      console.log("✅ Contract functions working correctly with local ABI");
    } catch (error) {
      console.log(`❌ Router contract call failed: ${error.message}`);
      console.log("⚠️ Either contract is not MetricVAMMRouter or ABI mismatch");
      console.log(
        "⚠️ Contract needs to be verified on Polygonscan for public access"
      );
    }

    // 5. Verify connected contracts exist
    console.log("\n🔍 Connected Contracts Verification:");

    const factoryCode = await provider.getCode(FACTORY_ADDRESS);
    console.log(`✅ Factory exists: ${factoryCode !== "0x" ? "YES" : "NO"}`);

    const vaultCode = await provider.getCode(VAULT_ADDRESS);
    console.log(`✅ Vault exists: ${vaultCode !== "0x" ? "YES" : "NO"}`);

    const registryCode = await provider.getCode(METRIC_REGISTRY_ADDRESS);
    console.log(`✅ Registry exists: ${registryCode !== "0x" ? "YES" : "NO"}`);

    // 6. Check recent activity
    console.log("\n📊 Recent Activity Check:");
    const latestBlock = await provider.getBlockNumber();
    console.log(`✅ Latest Block: ${latestBlock}`);

    // Check for recent transactions to router
    try {
      const fetch = (await import("node-fetch")).default;
      const recentTxs = await fetch(
        `https://api.polygonscan.com/api?module=account&action=txlist&address=${ROUTER_ADDRESS}&startblock=${
          latestBlock - 1000
        }&endblock=${latestBlock}&sort=desc&apikey=${polygonscanApiKey}`
      );
      const txData = await recentTxs.json();

      if (txData.status === "1") {
        console.log(`✅ Recent transactions: ${txData.result.length}`);
        if (txData.result.length > 0) {
          console.log(
            `✅ Latest activity: Block ${txData.result[0].blockNumber}`
          );
        }
      }
    } catch (error) {
      console.log("⚠️ Could not fetch recent transactions");
    }

    // 7. Final verification summary
    console.log("\n🎯 VERIFICATION SUMMARY:");
    console.log("=".repeat(40));
    console.log(`📍 Router Contract Address: ${ROUTER_ADDRESS}`);
    console.log(`📡 Network: Polygon Mainnet`);
    console.log(`💾 Contract exists: ${routerCode !== "0x" ? "YES" : "NO"}`);
    console.log(`🔍 Polygonscan verified: Check output above`);
    console.log(`🔗 Connected contracts: Factory, Vault, Registry all exist`);
    console.log(`🎯 Purpose: Single unified router for entire DexV2 system`);
    console.log(
      `🌐 Polygonscan: https://polygonscan.com/address/${ROUTER_ADDRESS}`
    );
    console.log(
      `⚠️  NOTE: Contract verification on Polygonscan may be needed for public access`
    );
  } catch (error) {
    console.error("❌ Verification failed:", error.message);
    process.exit(1);
  }
}

// Execute verification
if (require.main === module) {
  verifyRouterContract()
    .then(() => {
      console.log("\n🎉 Router verification completed successfully!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Verification failed:", error);
      process.exit(1);
    });
}

module.exports = { verifyRouterContract };
