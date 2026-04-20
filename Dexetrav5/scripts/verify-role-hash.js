const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  // Compute the expected hash
  const computedHash = ethers.keccak256(ethers.toUtf8Bytes("ORDERBOOK_ROLE"));
  console.log("Computed keccak256('ORDERBOOK_ROLE'):", computedHash);
  
  // Get the actual hash from the contract
  const coreVault = await ethers.getContractAt(
    ["function ORDERBOOK_ROLE() view returns (bytes32)"],
    process.env.CORE_VAULT_ADDRESS
  );
  
  const contractHash = await coreVault.ORDERBOOK_ROLE();
  console.log("Contract's ORDERBOOK_ROLE():        ", contractHash);
  
  console.log("\nMatch:", computedHash === contractHash);
  
  // Also check what role the error is reporting
  const errorRole = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  console.log("\nError's reported role:              ", errorRole);
  console.log("Error role matches contract hash:", errorRole === contractHash.toLowerCase());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
