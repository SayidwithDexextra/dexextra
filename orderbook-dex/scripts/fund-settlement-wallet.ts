import { ethers } from "hardhat";

async function fundSettlementWallet() {
  console.log('💰 FUNDING SETTLEMENT WALLET FOR LIVE TRANSACTIONS');
  console.log('='.repeat(80));

  // Settlement wallet address (from environment)
  const settlementWalletAddress = "0x1Bc0a803de77a004086e6010cD3f72ca7684e444";

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🤖 Settlement Wallet: ${settlementWalletAddress}`);
  console.log(`⛽ Network: ${(await ethers.provider.getNetwork()).name} (Chain ID: ${(await ethers.provider.getNetwork()).chainId})`);

  try {
    // Check current balances
    const deployerBalance = await ethers.provider.getBalance(deployer.address);
    const settlementBalance = await ethers.provider.getBalance(settlementWalletAddress);
    
    console.log(`💰 Current balances:`);
    console.log(`  - Deployer: ${ethers.formatEther(deployerBalance)} MATIC`);
    console.log(`  - Settlement Wallet: ${ethers.formatEther(settlementBalance)} MATIC`);

    // Fund settlement wallet if it has less than 0.01 MATIC
    const minimumBalance = ethers.parseEther("0.01"); // 0.01 MATIC
    const fundingAmount = ethers.parseEther("0.1");   // Fund with 0.1 MATIC

    if (settlementBalance < minimumBalance) {
      console.log(`📤 Settlement wallet needs funding (has ${ethers.formatEther(settlementBalance)} MATIC, needs ${ethers.formatEther(minimumBalance)} MATIC)`);
      
      // Check if deployer has enough balance
      if (deployerBalance < fundingAmount) {
        console.log(`❌ Deployer has insufficient balance to fund settlement wallet`);
        console.log(`  - Required: ${ethers.formatEther(fundingAmount)} MATIC`);
        console.log(`  - Available: ${ethers.formatEther(deployerBalance)} MATIC`);
        return;
      }

      console.log(`💸 Sending ${ethers.formatEther(fundingAmount)} MATIC to settlement wallet...`);
      
      const fundingTx = await deployer.sendTransaction({
        to: settlementWalletAddress,
        value: fundingAmount,
        gasLimit: 21000
      });
      
      console.log(`⏳ Funding transaction sent: ${fundingTx.hash}`);
      console.log(`🌐 View on PolyScan: https://polygonscan.com/tx/${fundingTx.hash}`);
      
      const receipt = await fundingTx.wait();
      console.log(`✅ Funding confirmed in block: ${receipt?.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);

      // Check new balance
      const newBalance = await ethers.provider.getBalance(settlementWalletAddress);
      console.log(`💰 Settlement wallet new balance: ${ethers.formatEther(newBalance)} MATIC`);
      
    } else {
      console.log(`✅ Settlement wallet has sufficient balance: ${ethers.formatEther(settlementBalance)} MATIC`);
    }

    console.log('\n🎯 FUNDING PROCESS COMPLETED');
    console.log('✅ Settlement wallet ready for live blockchain transactions');

  } catch (error) {
    console.error(`❌ Funding failed: ${(error as Error).message}`);
  }

  console.log('='.repeat(80));
}

// Execute the function
if (require.main === module) {
  fundSettlementWallet()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

export default fundSettlementWallet;



