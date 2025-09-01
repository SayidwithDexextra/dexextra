import { ethers } from "hardhat";

/**
 * Test script to verify Ganache blockchain connection and basic functionality
 * Usage: npx hardhat run scripts/test-ganache.ts --network ganache
 */
async function main() {
  console.log("🔗 Testing Ganache Connection...");
  console.log("================================");
  
  try {
    // Get network info
    const network = await ethers.provider.getNetwork();
    console.log(`✅ Connected to network: ${network.name} (Chain ID: ${network.chainId})`);
    
    // Get block number
    const blockNumber = await ethers.provider.getBlockNumber();
    console.log(`📦 Current block number: ${blockNumber}`);
    
    // Get gas price
    const gasPrice = await ethers.provider.getFeeData();
    console.log(`⛽ Gas price: ${ethers.formatUnits(gasPrice.gasPrice || 0, "gwei")} gwei`);
    
    // Get accounts
    const accounts = await ethers.getSigners();
    console.log(`👥 Available accounts: ${accounts.length}`);
    
    console.log("\n💰 Account Balances:");
    console.log("====================");
    for (let i = 0; i < Math.min(5, accounts.length); i++) {
      const balance = await ethers.provider.getBalance(accounts[i].address);
      console.log(`Account ${i}: ${accounts[i].address}`);
      console.log(`  Balance: ${ethers.formatEther(balance)} ETH`);
      console.log("");
    }
    
    // Test a simple transaction
    console.log("💸 Testing Simple Transaction...");
    console.log("=================================");
    if (accounts.length >= 2) {
      const sender = accounts[0];
      const receiver = accounts[1];
      
      const initialBalance = await ethers.provider.getBalance(receiver.address);
      console.log(`📥 Receiver initial balance: ${ethers.formatEther(initialBalance)} ETH`);
      
      // Send 0.1 ETH
      console.log("📤 Sending 0.1 ETH...");
      const tx = await sender.sendTransaction({
        to: receiver.address,
        value: ethers.parseEther("0.1"),
        gasLimit: 21000
      });
      
      console.log(`🔄 Transaction submitted: ${tx.hash}`);
      console.log("⏳ Waiting for confirmation...");
      
      const receipt = await tx.wait();
      console.log(`✅ Transaction confirmed in block: ${receipt?.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt?.gasUsed.toString()}`);
      
      const finalBalance = await ethers.provider.getBalance(receiver.address);
      console.log(`📥 Receiver final balance: ${ethers.formatEther(finalBalance)} ETH`);
      
      const difference = finalBalance - initialBalance;
      console.log(`💵 Amount received: ${ethers.formatEther(difference)} ETH`);
    }
    
    // Test contract deployment capability
    console.log("\n🏗️  Testing Contract Deployment...");
    console.log("===================================");
    
    // Deploy a simple test contract (MockUSDC)
    console.log("🚀 Deploying MockUSDC contract...");
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const mockUSDC = await MockUSDC.deploy();
    await mockUSDC.waitForDeployment();
    
    const contractAddress = await mockUSDC.getAddress();
    console.log(`✅ MockUSDC deployed to: ${contractAddress}`);
    
    // Test contract interaction
    console.log("🔄 Testing contract interaction...");
    const name = await mockUSDC.name();
    const symbol = await mockUSDC.symbol();
    const decimals = await mockUSDC.decimals();
    
    console.log(`📝 Token name: ${name}`);
    console.log(`🏷️  Token symbol: ${symbol}`);
    console.log(`🔢 Token decimals: ${decimals}`);
    
    // Test minting
    console.log("🪙 Testing token minting...");
    const mintAmount = ethers.parseUnits("1000", 6); // 1000 USDC
    await mockUSDC.mint(accounts[0].address, mintAmount);
    
    const balance = await mockUSDC.balanceOf(accounts[0].address);
    console.log(`💰 Minted balance: ${ethers.formatUnits(balance, 6)} USDC`);
    
    console.log("\n🎉 All Tests Passed!");
    console.log("====================");
    console.log("✅ Ganache connection successful");
    console.log("✅ Account access working");
    console.log("✅ Transaction processing working");
    console.log("✅ Contract deployment working");
    console.log("✅ Contract interaction working");
    
    console.log("\n📋 Next Steps:");
    console.log("================");
    console.log("1. Deploy the full OrderBook DEX system:");
    console.log("   npx hardhat run scripts/deploy.ts --network ganache");
    console.log("");
    console.log("2. Get test USDC tokens:");
    console.log("   npx hardhat run scripts/faucet.ts --network ganache");
    console.log("");
    console.log("3. Configure your main app with deployed contract addresses");
    
  } catch (error) {
    console.error("❌ Test failed:", error);
    
    if (error instanceof Error) {
      if (error.message.includes("ECONNREFUSED")) {
        console.error("\n🔧 Troubleshooting:");
        console.error("- Ensure Ganache is running on http://127.0.0.1:7545");
        console.error("- Check if the port 7545 is correct");
        console.error("- Verify Ganache network settings");
      } else if (error.message.includes("insufficient funds")) {
        console.error("\n🔧 Troubleshooting:");
        console.error("- Check if accounts have sufficient ETH balance");
        console.error("- Verify the private key in .env file");
      }
    }
    
    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Ganache test failed:", error);
    process.exit(1);
  });





