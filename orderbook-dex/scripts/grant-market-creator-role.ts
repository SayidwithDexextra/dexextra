import { ethers } from "hardhat";

async function grantMarketCreatorRole() {
  console.log('🔐 GRANTING MARKET CREATOR ROLE');
  console.log('='.repeat(80));

  // Deployed contract addresses
  const contracts = {
    metricsMarketFactory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🏭 Factory: ${contracts.metricsMarketFactory}`);

  // Get contract instance
  const MetricsMarketFactory = await ethers.getContractFactory("MetricsMarketFactory");
  const factory = MetricsMarketFactory.attach(contracts.metricsMarketFactory);

  try {
    // Check current roles
    const MARKET_CREATOR_ROLE = await factory.MARKET_CREATOR_ROLE();
    const DEFAULT_ADMIN_ROLE = await factory.DEFAULT_ADMIN_ROLE();
    
    console.log(`\n🔑 MARKET_CREATOR_ROLE: ${MARKET_CREATOR_ROLE}`);
    console.log(`🔑 DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
    
    // Check if deployer already has the role
    const hasRole = await factory.hasRole(MARKET_CREATOR_ROLE, deployer.address);
    console.log(`\n👤 Deployer has MARKET_CREATOR_ROLE: ${hasRole}`);
    
    if (!hasRole) {
      console.log('\n🚀 Granting MARKET_CREATOR_ROLE to deployer...');
      
      const grantTx = await factory.grantRole(MARKET_CREATOR_ROLE, deployer.address);
      console.log(`📝 Transaction hash: ${grantTx.hash}`);
      
      const receipt = await grantTx.wait();
      console.log(`✅ Role granted in block ${receipt?.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);
      
      // Verify role was granted
      const hasRoleAfter = await factory.hasRole(MARKET_CREATOR_ROLE, deployer.address);
      console.log(`👤 Deployer has MARKET_CREATOR_ROLE after grant: ${hasRoleAfter}`);
      
    } else {
      console.log('✅ Deployer already has MARKET_CREATOR_ROLE');
    }

    // Also check if deployer has admin role
    const hasAdminRole = await factory.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    console.log(`👤 Deployer has DEFAULT_ADMIN_ROLE: ${hasAdminRole}`);

    console.log('\n🎉 ROLE MANAGEMENT COMPLETED');
    
  } catch (error) {
    console.error('❌ Role management failed:', error);
    
    if (error instanceof Error) {
      if (error.message.includes('AccessControl: account')) {
        console.log('💡 Suggestion: The deployer does not have admin privileges to grant roles');
      }
    }
  }
}

// Execute the script
if (require.main === module) {
  grantMarketCreatorRole()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { grantMarketCreatorRole };
