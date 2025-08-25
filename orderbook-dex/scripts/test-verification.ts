import { ethers, network } from "hardhat";
import { isVerificationSupported, verifyContract } from "./utils/verification";

/**
 * Test script to verify that the verification system works correctly
 */
async function main() {
  console.log("🔍 Testing contract verification system...");
  console.log(`Network: ${network.name}`);
  console.log(`Verification supported: ${isVerificationSupported()}`);

  if (!isVerificationSupported()) {
    console.log("ℹ️  Verification not supported on this network. Deploy to a testnet to test verification.");
    return;
  }

  // Check for required API keys
  const requiredKeys = {
    polygon: 'POLYGONSCAN_API_KEY',
    polygonMumbai: 'POLYGONSCAN_API_KEY',
    mainnet: 'ETHERSCAN_API_KEY',
    goerli: 'ETHERSCAN_API_KEY',
    sepolia: 'ETHERSCAN_API_KEY',
    arbitrumOne: 'ARBISCAN_API_KEY',
    optimisticEthereum: 'OPTIMISM_API_KEY',
    bsc: 'BSCSCAN_API_KEY',
    bscTestnet: 'BSCSCAN_API_KEY',
    avalanche: 'SNOWTRACE_API_KEY',
  };

  const requiredKey = requiredKeys[network.name as keyof typeof requiredKeys];
  if (requiredKey && !process.env[requiredKey]) {
    console.log(`❌ Error: ${requiredKey} environment variable is required for ${network.name}`);
    console.log(`Please add ${requiredKey}=your_api_key_here to your .env file`);
    return;
  }

  // Deploy a simple test contract
  console.log("\n📦 Deploying test contract...");
  
  const [deployer] = await ethers.getSigners();
  console.log("Deploying with account:", deployer.address);

  // Deploy MockUSDC as a test contract
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = await MockUSDC.deploy();
  await mockUSDC.waitForDeployment();

  const contractAddress = await mockUSDC.getAddress();
  console.log("✅ Test contract deployed at:", contractAddress);

  // Test verification
  console.log("\n🔍 Testing contract verification...");
  
  const success = await verifyContract(
    mockUSDC,
    [], // No constructor arguments for MockUSDC
    "MockUSDC Test",
    "contracts/mocks/MockUSDC.sol:MockUSDC"
  );

  if (success) {
    console.log("\n✅ Verification test completed successfully!");
    console.log(`🔗 View contract on explorer: ${getExplorerUrl(contractAddress)}`);
  } else {
    console.log("\n❌ Verification test failed!");
    console.log("This could be due to:");
    console.log("- Network not supported");
    console.log("- Invalid API key");
    console.log("- Network connectivity issues");
    console.log("- Block explorer rate limiting");
  }

  console.log("\n📋 Verification Test Summary:");
  console.log(`Network: ${network.name}`);
  console.log(`Contract Address: ${contractAddress}`);
  console.log(`Verification Status: ${success ? 'SUCCESS' : 'FAILED'}`);
  console.log(`API Key Configured: ${requiredKey ? (process.env[requiredKey] ? 'YES' : 'NO') : 'N/A'}`);
}

function getExplorerUrl(address: string): string {
  const explorerUrls: { [key: string]: string } = {
    mainnet: `https://etherscan.io/address/${address}`,
    goerli: `https://goerli.etherscan.io/address/${address}`,
    sepolia: `https://sepolia.etherscan.io/address/${address}`,
    polygon: `https://polygonscan.com/address/${address}`,
    polygonMumbai: `https://mumbai.polygonscan.com/address/${address}`,
    arbitrumOne: `https://arbiscan.io/address/${address}`,
    optimisticEthereum: `https://optimistic.etherscan.io/address/${address}`,
    bsc: `https://bscscan.com/address/${address}`,
    bscTestnet: `https://testnet.bscscan.com/address/${address}`,
    avalanche: `https://snowtrace.io/address/${address}`,
  };
  
  return explorerUrls[network.name] || `Contract: ${address}`;
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Verification test failed:", error);
    process.exit(1);
  });
