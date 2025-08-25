import { ethers } from "hardhat";
import * as fs from "fs";

/**
 * MockUSDC Faucet Script
 * 
 * This script allows users to easily mint MockUSDC tokens for testing
 * Usage: npx hardhat run scripts/faucet.ts --network <network>
 */

interface DeploymentData {
  contracts: {
    mockUSDC?: string;
  };
}

async function main() {
  console.log("🚰 MockUSDC Faucet Script");
  console.log("========================");

  // Get signer
  const [signer] = await ethers.getSigners();
  console.log("Using account:", signer.address);
  console.log("Account balance:", ethers.formatEther(await signer.provider.getBalance(signer.address)), "ETH");

  // Try to load deployment data
  let mockUSDCAddress: string | undefined;
  
  // Check if deployment file exists
  const deploymentFiles = fs.readdirSync("deployments/").filter(f => f.startsWith("deployment-") && f.endsWith(".json"));
  
  if (deploymentFiles.length > 0) {
    // Use the most recent deployment
    const latestDeployment = deploymentFiles.sort().reverse()[0];
    console.log(`\n📄 Loading deployment from: ${latestDeployment}`);
    
    const deploymentData: DeploymentData = JSON.parse(
      fs.readFileSync(`deployments/${latestDeployment}`, "utf8")
    );
    
    mockUSDCAddress = deploymentData.contracts.mockUSDC;
  }

  // If no deployment found, check environment variable
  if (!mockUSDCAddress) {
    mockUSDCAddress = process.env.MOCK_USDC_ADDRESS;
  }

  if (!mockUSDCAddress) {
    console.log("❌ MockUSDC address not found!");
    console.log("Please provide MockUSDC address via:");
    console.log("1. Deploy the contracts first (npm run deploy:localhost)");
    console.log("2. Set MOCK_USDC_ADDRESS environment variable");
    console.log("3. Pass address as command line argument");
    process.exit(1);
  }

  console.log("📍 MockUSDC Address:", mockUSDCAddress);

  // Connect to MockUSDC contract
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const mockUSDC = MockUSDC.attach(mockUSDCAddress);

  // Check current balance
  const currentBalance = await mockUSDC.balanceOf(signer.address);
  console.log("💰 Current USDC balance:", ethers.formatUnits(currentBalance, 6), "USDC");

  // Parse command line arguments for custom amounts and recipients
  const args = process.argv.slice(2);
  let amount = "1000"; // Default 1000 USDC
  let recipients: string[] = [signer.address];

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--amount" && args[i + 1]) {
      amount = args[i + 1];
      i++; // Skip next argument
    } else if (args[i] === "--to" && args[i + 1]) {
      recipients = [args[i + 1]];
      i++; // Skip next argument
    } else if (args[i] === "--recipients" && args[i + 1]) {
      recipients = args[i + 1].split(",");
      i++; // Skip next argument
    }
  }

  console.log("\n🎯 Faucet Configuration:");
  console.log("Amount per recipient:", amount, "USDC");
  console.log("Recipients:", recipients.length);

  // Convert amount to proper decimals
  const mintAmount = ethers.parseUnits(amount, 6);

  try {
    if (recipients.length === 1) {
      // Single recipient
      console.log("\n🚰 Minting tokens...");
      const tx = await mockUSDC.mint(recipients[0], mintAmount);
      console.log("Transaction hash:", tx.hash);
      
      await tx.wait();
      console.log("✅ Successfully minted", amount, "USDC to", recipients[0]);
      
      // Show new balance
      const newBalance = await mockUSDC.balanceOf(recipients[0]);
      console.log("💰 New balance:", ethers.formatUnits(newBalance, 6), "USDC");
      
    } else {
      // Multiple recipients
      console.log("\n🚰 Batch minting to", recipients.length, "addresses...");
      const tx = await mockUSDC.batchMintEqual(recipients, mintAmount);
      console.log("Transaction hash:", tx.hash);
      
      await tx.wait();
      console.log("✅ Successfully minted", amount, "USDC to each of", recipients.length, "addresses");
      
      // Show total minted
      const totalMinted = BigInt(recipients.length) * mintAmount;
      console.log("📊 Total minted:", ethers.formatUnits(totalMinted, 6), "USDC");
    }

  } catch (error) {
    console.error("❌ Minting failed:", error);
    process.exit(1);
  }

  // Display faucet functions available
  console.log("\n🔧 Available Faucet Functions:");
  console.log("- faucet(): Mint 1000 USDC to caller");
  console.log("- mintStandard(address): Mint 1000 USDC to address");
  console.log("- mintLarge(address): Mint 1,000,000 USDC to address");
  console.log("- mint(address, amount): Mint custom amount to address");
  console.log("- batchMint(addresses[], amounts[]): Batch mint different amounts");
  console.log("- batchMintEqual(addresses[], amount): Batch mint equal amounts");
  console.log("- airdrop(addresses[], amount): Airdrop equal amounts");

  console.log("\n📖 Usage Examples:");
  console.log("# Mint 1000 USDC to yourself:");
  console.log("npx hardhat run scripts/faucet.ts --network localhost");
  console.log("");
  console.log("# Mint custom amount:");
  console.log("npx hardhat run scripts/faucet.ts --network localhost -- --amount 5000");
  console.log("");
  console.log("# Mint to specific address:");
  console.log("npx hardhat run scripts/faucet.ts --network localhost -- --to 0x742d35Cc6634C0532925a3b8D");
  console.log("");
  console.log("# Mint to multiple addresses:");
  console.log("npx hardhat run scripts/faucet.ts --network localhost -- --recipients 0xaddr1,0xaddr2,0xaddr3 --amount 2000");

  // Show contract info
  console.log("\n📋 Contract Information:");
  console.log("Name:", await mockUSDC.name());
  console.log("Symbol:", await mockUSDC.symbol());
  console.log("Decimals:", await mockUSDC.decimals());
  console.log("Total Supply:", ethers.formatUnits(await mockUSDC.totalSupply(), 6), "USDC");

  console.log("\n✨ Faucet operation completed!");
}

// Handle different ways the script might be called
async function handleFaucetCommands() {
  const args = process.argv.slice(2);
  
  // Check for special commands
  if (args.includes("--help") || args.includes("-h")) {
    console.log("MockUSDC Faucet Help");
    console.log("===================");
    console.log("");
    console.log("Usage: npx hardhat run scripts/faucet.ts --network <network> [options]");
    console.log("");
    console.log("Options:");
    console.log("  --amount <amount>     Amount of USDC to mint (default: 1000)");
    console.log("  --to <address>        Recipient address (default: deployer)");
    console.log("  --recipients <list>   Comma-separated list of addresses");
    console.log("  --help, -h           Show this help message");
    console.log("");
    console.log("Examples:");
    console.log("  npx hardhat run scripts/faucet.ts --network localhost");
    console.log("  npx hardhat run scripts/faucet.ts --network localhost -- --amount 5000");
    console.log("  npx hardhat run scripts/faucet.ts --network localhost -- --to 0x123... --amount 2000");
    console.log("  npx hardhat run scripts/faucet.ts --network localhost -- --recipients 0x123,0x456 --amount 1000");
    return;
  }

  await main();
}

// Run the script
handleFaucetCommands()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Faucet failed:", error);
    process.exit(1);
  });
