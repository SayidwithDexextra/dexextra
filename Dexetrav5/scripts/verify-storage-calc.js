const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  console.log("CoreVault:", coreVaultAddr);
  console.log("Order Book:", orderBook);
  
  // OZ v5 AccessControlUpgradeable storage slot
  const baseSlot = "0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800";
  
  // Step 1: Compute slot for _roles[ORDERBOOK_ROLE]
  // keccak256(bytes32(role) ++ bytes32(baseSlot))
  const roleSlotData = ethers.solidityPacked(["bytes32", "bytes32"], [ORDERBOOK_ROLE, baseSlot]);
  const roleSlot = ethers.keccak256(roleSlotData);
  console.log("\n1. _roles[ORDERBOOK_ROLE] slot:", roleSlot);
  
  // Step 2: Compute slot for _roles[ORDERBOOK_ROLE].hasRole[orderBook]
  // hasRole mapping is at offset 0 of RoleData, so its slot is roleSlot
  // keccak256(bytes32(address padded to 32) ++ bytes32(roleSlot))
  const hasRoleSlotData = ethers.solidityPacked(["address", "bytes32"], [orderBook, roleSlot]);
  const hasRoleSlot = ethers.keccak256(hasRoleSlotData);
  console.log("2. hasRole[orderBook] slot:", hasRoleSlot);
  
  // Read the storage
  const provider = ethers.provider;
  const value = await provider.getStorage(coreVaultAddr, hasRoleSlot);
  console.log("3. Storage value:", value);
  console.log("4. Has role (storage):", value !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  
  // Also try with different encoding (using bytes32-padded address)
  const addrPadded = ethers.zeroPadValue(orderBook, 32);
  const hasRoleSlotData2 = ethers.concat([addrPadded, roleSlot]);
  const hasRoleSlot2 = ethers.keccak256(hasRoleSlotData2);
  console.log("\n5. Alternative slot (concat method):", hasRoleSlot2);
  const value2 = await provider.getStorage(coreVaultAddr, hasRoleSlot2);
  console.log("6. Storage value:", value2);
  
  // Verify via hasRole
  const cv = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    coreVaultAddr
  );
  const hasViaCall = await cv.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("\n7. hasRole() call result:", hasViaCall);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
