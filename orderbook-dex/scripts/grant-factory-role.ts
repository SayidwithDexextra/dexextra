import { ethers } from "hardhat";

async function grantFactoryRole() {
  console.log('🏭 GRANTING FACTORY ROLE TO METRICS MARKET FACTORY');
  console.log('='.repeat(80));

  // Deployed contract addresses
  const contracts = {
    orderRouter: "0x411Ca68a8D3E2717c8436630A11E349CB452a80F",
    metricsMarketFactory: "0xec83CDAf6DE9A6C97363966E2Be1c7CfE680687d"
  };

  // Get signers
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🛣️  OrderRouter: ${contracts.orderRouter}`);
  console.log(`🏭 Factory: ${contracts.metricsMarketFactory}`);

  // Get contract instances
  const OrderRouter = await ethers.getContractFactory("OrderRouter");
  const router = OrderRouter.attach(contracts.orderRouter);

  try {
    // Check current roles
    const FACTORY_ROLE = await router.FACTORY_ROLE();
    const ROUTER_ADMIN_ROLE = await router.ROUTER_ADMIN_ROLE();
    const DEFAULT_ADMIN_ROLE = await router.DEFAULT_ADMIN_ROLE();
    
    console.log(`\n🔑 FACTORY_ROLE: ${FACTORY_ROLE}`);
    console.log(`🔑 ROUTER_ADMIN_ROLE: ${ROUTER_ADMIN_ROLE}`);
    console.log(`🔑 DEFAULT_ADMIN_ROLE: ${DEFAULT_ADMIN_ROLE}`);
    
    // Check if factory already has the role
    const hasFactoryRole = await router.hasRole(FACTORY_ROLE, contracts.metricsMarketFactory);
    console.log(`\n🏭 Factory has FACTORY_ROLE: ${hasFactoryRole}`);
    
    // Check if deployer has admin role
    const hasAdminRole = await router.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
    const hasRouterAdminRole = await router.hasRole(ROUTER_ADMIN_ROLE, deployer.address);
    console.log(`👤 Deployer has DEFAULT_ADMIN_ROLE: ${hasAdminRole}`);
    console.log(`👤 Deployer has ROUTER_ADMIN_ROLE: ${hasRouterAdminRole}`);
    
    if (!hasFactoryRole) {
      console.log('\n🚀 Granting FACTORY_ROLE to MetricsMarketFactory...');
      
      const grantTx = await router.grantRole(FACTORY_ROLE, contracts.metricsMarketFactory);
      console.log(`📝 Transaction hash: ${grantTx.hash}`);
      
      const receipt = await grantTx.wait();
      console.log(`✅ Role granted in block ${receipt?.blockNumber}`);
      console.log(`⛽ Gas used: ${receipt?.gasUsed?.toString()}`);
      
      // Verify role was granted
      const hasRoleAfter = await router.hasRole(FACTORY_ROLE, contracts.metricsMarketFactory);
      console.log(`🏭 Factory has FACTORY_ROLE after grant: ${hasRoleAfter}`);
      
    } else {
      console.log('✅ MetricsMarketFactory already has FACTORY_ROLE');
    }

    console.log('\n🎉 FACTORY ROLE MANAGEMENT COMPLETED');
    
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
  grantFactoryRole()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('💥 Script execution failed:', error);
      process.exit(1);
    });
}

export { grantFactoryRole };
