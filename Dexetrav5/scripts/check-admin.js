const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const [signer] = await ethers.getSigners();
  const coreVault = await ethers.getContractAt(
    [
      "function hasRole(bytes32,address) view returns (bool)",
      "function DEFAULT_ADMIN_ROLE() view returns (bytes32)",
      "function getRoleAdmin(bytes32) view returns (bytes32)",
    ],
    process.env.CORE_VAULT_ADDRESS
  );
  
  const DEFAULT_ADMIN_ROLE = await coreVault.DEFAULT_ADMIN_ROLE();
  console.log("DEFAULT_ADMIN_ROLE:", DEFAULT_ADMIN_ROLE);
  
  const signerHasAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, signer.address);
  console.log("Signer", signer.address, "has admin:", signerHasAdmin);
  
  // Check the deployer from PRIVATE_KEY
  const deployer = new ethers.Wallet(process.env.PRIVATE_KEY);
  const deployerHasAdmin = await coreVault.hasRole(DEFAULT_ADMIN_ROLE, deployer.address);
  console.log("Deployer", deployer.address, "has admin:", deployerHasAdmin);
}

main().catch(e => { console.error(e); process.exit(1); });
