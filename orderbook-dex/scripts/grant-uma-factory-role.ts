import { ethers } from "hardhat";

async function grantUmaFactoryRole() {
  console.log('🔐 GRANT UMA FACTORY_ROLE TO NEW FACTORY');
  console.log('='.repeat(80));

  const umaOracleManager = process.env.UMA_ORACLE_MANAGER_ADDRESS || "0x9Fc90Cd2E4345a51b55EC6ecEeDf31051Db20cD4";
  const newFactory = process.env.NEW_FACTORY_ADDRESS || "";

  if (!newFactory) {
    throw new Error('NEW_FACTORY_ADDRESS env required');
  }

  const [deployer] = await ethers.getSigners();
  console.log(`👤 Deployer: ${deployer.address}`);
  console.log(`🧠 UMAOracleManager: ${umaOracleManager}`);
  console.log(`🏭 New Factory: ${newFactory}`);

  const UMA = await ethers.getContractFactory("UMAOracleManager");
  const uma = UMA.attach(umaOracleManager);

  const adminRole = await uma.ORACLE_ADMIN_ROLE();
  const isAdmin = await uma.hasRole(adminRole, deployer.address);
  console.log(`🔎 Deployer has ORACLE_ADMIN_ROLE: ${isAdmin}`);
  if (!isAdmin) {
    throw new Error('Deployer lacks ORACLE_ADMIN_ROLE on UMAOracleManager');
  }

  console.log('🚀 Granting FACTORY_ROLE to new factory...');
  const tx = await uma.grantFactoryRole(newFactory);
  console.log(`📝 Tx: ${tx.hash}`);
  const receipt = await tx.wait();
  console.log(`✅ Granted in block ${receipt?.blockNumber}`);
}

if (require.main === module) {
  grantUmaFactoryRole()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('💥 Script failed:', err);
      process.exit(1);
    });
}

export { grantUmaFactoryRole };







