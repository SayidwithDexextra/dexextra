const { ethers } = require("ethers");
require("dotenv").config({ path: ".env.local" });

const ERC20_ABI = [
  "function balanceOf(address account) external view returns (uint256)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function decimals() external view returns (uint8)",
  "function symbol() external view returns (string)",
];

// Contract addresses from the error
const CONTRACTS = {
  USDC: "0xbD3F940783C47649e439A946d84508503D87976D",
  VAULT: "0x82045733a87751b759e2aeff4a405938829c4cc9", // Spender from the error
};

const USER_ADDRESS = "0x14a2b07eec1f8d1ef0f9deeef9a352c432269cdb"; // From the error

async function diagnoseApprovalError() {
  console.log("🔍 APPROVAL ERROR DIAGNOSTIC SCRIPT");
  console.log("=====================================\n");

  console.log("📋 Configuration from Error:");
  console.log(`   User Address: ${USER_ADDRESS}`);
  console.log(`   Token (USDC): ${CONTRACTS.USDC}`);
  console.log(`   Spender (Vault): ${CONTRACTS.VAULT}`);
  console.log(`   Approval Amount: ~105.6 USDC\n`);

  // Load environment variables
  const config = {
    rpcUrl: process.env.RPC_URL || "https://polygon-rpc.com/",
    wsRpcUrl: process.env.WS_RPC_URL || "wss://polygon-rpc.com/",
    chainId: process.env.CHAIN_ID || "137",
    defaultNetwork: process.env.DEFAULT_NETWORK || "polygon",
  };

  console.log("🔧 Environment Configuration:");
  console.log(`   RPC URL: ${config.rpcUrl}`);
  console.log(`   Chain ID: ${config.chainId}`);
  console.log(`   Default Network: ${config.defaultNetwork}\n`);

  // Test multiple Polygon RPC endpoints if the primary one fails
  const polygonRpcEndpoints = [
    config.rpcUrl,
    "https://polygon-rpc.com/",
    "https://rpc.ankr.com/polygon",
    "https://polygon.blockpi.network/v1/rpc/public",
    "https://polygon-mainnet.public.blastapi.io",
    "https://rpc-mainnet.maticvigil.com/",
  ];

  console.log("🧪 Test 1: RPC Connectivity (Polygon Mainnet)");
  console.log("----------------------------------------------");

  let provider;
  let workingRpcUrl = null;

  for (const rpcUrl of polygonRpcEndpoints) {
    try {
      console.log(`   Trying: ${rpcUrl}`);
      const testProvider = new ethers.JsonRpcProvider(rpcUrl);
      const network = await testProvider.getNetwork();

      if (network.chainId === 137n) {
        console.log(
          `   ✅ Connected to Polygon Mainnet (Chain ID: ${network.chainId})`
        );
        const blockNumber = await testProvider.getBlockNumber();
        console.log(`   ✅ Latest block: ${blockNumber}`);
        provider = testProvider;
        workingRpcUrl = rpcUrl;
        break;
      } else {
        console.log(`   ❌ Wrong network: Chain ID ${network.chainId}`);
      }
    } catch (error) {
      console.log(`   ❌ Failed: ${error.message}`);
    }
  }

  if (!provider) {
    console.log("\n❌ Could not connect to any Polygon RPC endpoint");
    console.log("💡 Possible solutions:");
    console.log("   - Check your internet connection");
    console.log("   - Try using an Alchemy or Infura API key");
    console.log("   - Verify your firewall/VPN settings");
    return;
  }

  if (workingRpcUrl !== config.rpcUrl) {
    console.log(
      `\n💡 Recommendation: Update your .env.local with working RPC:`
    );
    console.log(`   RPC_URL=${workingRpcUrl}`);
  }

  // Test 2: Token Contract Check
  console.log("\n🧪 Test 2: Token Contract Verification");
  console.log("--------------------------------------");

  let tokenContract;
  try {
    tokenContract = new ethers.Contract(CONTRACTS.USDC, ERC20_ABI, provider);
    const symbol = await tokenContract.symbol();
    const decimals = await tokenContract.decimals();
    console.log(`✅ Token contract found: ${symbol} with ${decimals} decimals`);
  } catch (error) {
    console.log(`❌ Token contract error: ${error.message}`);
    console.log("💡 Contract might not be deployed on this network\n");
    return;
  }

  // Test 3: User Balance Check
  console.log("\n🧪 Test 3: User Balance Verification");
  console.log("------------------------------------");

  try {
    const balance = await tokenContract.balanceOf(USER_ADDRESS);
    const balanceFormatted = ethers.formatUnits(balance, 6);
    console.log(`✅ User balance: ${balanceFormatted} USDC`);

    if (balance === 0n) {
      console.log("⚠️  User has no USDC balance");
    }
  } catch (error) {
    console.log(`❌ Balance check failed: ${error.message}`);
  }

  // Test 4: Current Allowance Check
  console.log("\n🧪 Test 4: Current Allowance Check");
  console.log("----------------------------------");

  try {
    const allowance = await tokenContract.allowance(
      USER_ADDRESS,
      CONTRACTS.VAULT
    );
    const allowanceFormatted = ethers.formatUnits(allowance, 6);
    console.log(`✅ Current allowance: ${allowanceFormatted} USDC`);

    if (allowance > 0n) {
      console.log("ℹ️  User already has some allowance set");
    }
  } catch (error) {
    console.log(`❌ Allowance check failed: ${error.message}`);
  }

  // Test 5: Simulate Approval Transaction
  console.log("\n🧪 Test 5: Approval Gas Estimation");
  console.log("----------------------------------");

  try {
    const approvalAmount = ethers.parseUnits("105.6", 6);
    const gasEstimate = await tokenContract.approve.estimateGas(
      CONTRACTS.VAULT,
      approvalAmount
    );
    console.log(`✅ Estimated gas: ${gasEstimate.toString()}`);

    const feeData = await provider.getFeeData();
    if (feeData.gasPrice) {
      const estimatedCost = gasEstimate * feeData.gasPrice;
      console.log(
        `✅ Estimated cost: ${ethers.formatEther(estimatedCost)} ETH`
      );
    }
  } catch (error) {
    console.log(`❌ Gas estimation failed: ${error.message}`);
    console.log("💡 This indicates the transaction would fail");
  }

  // Test 6: Network Compatibility Check
  console.log("\n🧪 Test 6: Network Compatibility");
  console.log("--------------------------------");

  const networkMappings = {
    1: { name: "Ethereum Mainnet", expectedToken: "USDC" },
    137: { name: "Polygon Mainnet", expectedToken: "USDC" },
    8453: { name: "Base Mainnet", expectedToken: "USDC" },
    31337: { name: "Hardhat Local", expectedToken: "MockUSDC" },
  };

  const currentNetwork = await provider.getNetwork();
  const networkInfo = networkMappings[currentNetwork.chainId.toString()];

  if (networkInfo) {
    console.log(`✅ Connected to ${networkInfo.name}`);
    console.log(`✅ Expected token type: ${networkInfo.expectedToken}`);
  } else {
    console.log(`⚠️  Unknown network: Chain ID ${currentNetwork.chainId}`);
  }

  // Provide recommendations
  console.log("\n💡 RECOMMENDATIONS:");
  console.log("==================");

  console.log("\n1. **Check Network Configuration:**");
  console.log(
    "   - Ensure your wallet is connected to the same network as your contracts"
  );
  console.log(
    "   - Verify your .env.local file has the correct network settings"
  );

  console.log("\n2. **Verify Contract Addresses:**");
  console.log(
    "   - Make sure the contract addresses in your app match the deployed contracts"
  );
  console.log("   - Check if contracts are deployed on the current network");

  console.log("\n3. **Try Alternative Solutions:**");
  console.log("   - Switch to a different RPC endpoint");
  console.log("   - Use a lower approval amount (e.g., exact amount needed)");
  console.log("   - Clear browser cache and reconnect wallet");
  console.log("   - Try the transaction during lower network congestion");

  console.log("\n4. **Environment Setup for Polygon Mainnet:**");
  if (currentNetwork.chainId === 137n) {
    console.log("   ✅ Confirmed: Connected to Polygon Mainnet");
    console.log("   - Your .env.local should have:");
    console.log("     DEFAULT_NETWORK=polygon");
    console.log("     CHAIN_ID=137");
    console.log(`     RPC_URL=${workingRpcUrl || "https://polygon-rpc.com/"}`);
    console.log("     WS_RPC_URL=wss://polygon-rpc.com/");
  } else if (currentNetwork.chainId === 8453n) {
    console.log("   ⚠️  You're connected to Base, but should be on Polygon");
    console.log("   - Switch your wallet to Polygon Mainnet");
    console.log("   - Update your .env.local for Polygon:");
    console.log("     DEFAULT_NETWORK=polygon");
    console.log("     CHAIN_ID=137");
    console.log("     RPC_URL=https://polygon-rpc.com/");
  } else {
    console.log(
      `   ⚠️  Connected to Chain ID ${currentNetwork.chainId}, expected Polygon (137)`
    );
    console.log("   - Switch your wallet to Polygon Mainnet");
  }

  console.log("\n5. **Polygon-Specific Solutions:**");
  console.log("   - Ensure you have MATIC tokens for gas fees");
  console.log(
    "   - Try during low network congestion (usually late UTC hours)"
  );
  console.log("   - Consider using a premium RPC endpoint (Alchemy/Infura)");
  console.log("   - Check if contracts are verified on Polygonscan");

  console.log("\n🔧 Next Steps for Polygon:");
  console.log(
    "   1. Verify your wallet is connected to Polygon Mainnet (Chain ID: 137)"
  );
  console.log("   2. Ensure you have MATIC for gas fees (minimum 0.001 MATIC)");
  console.log("   3. Update .env.local with working Polygon RPC endpoint");
  console.log("   4. Restart your development server: npm run dev");
  console.log("   5. Try the approval transaction again");

  if (workingRpcUrl && workingRpcUrl !== config.rpcUrl) {
    console.log("\n🎯 Quick Fix - Update your .env.local:");
    console.log("   Replace your current RPC_URL with:");
    console.log(`   RPC_URL=${workingRpcUrl}`);
  }
}

// Run the diagnostic
diagnoseApprovalError().catch(console.error);
