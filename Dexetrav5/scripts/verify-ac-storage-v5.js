const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  console.log("CoreVault:", coreVaultAddr);
  console.log("Order Book:", orderBook);
  console.log("ORDERBOOK_ROLE:", ORDERBOOK_ROLE);
  
  // OZ v5 AccessControlUpgradeable storage:
  // bytes32 private constant AccessControlStorageLocation = 0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b6268002;
  const baseSlot = "0x02dd7bc7dec4dceedda775e58dd541e08a116c6c53815c0bd028192f7b626800";
  console.log("\nAccessControl base slot (OZ v5):", baseSlot);
  
  // The storage struct is:
  // struct AccessControlStorage {
  //     mapping(bytes32 role => RoleData) _roles;
  // }
  // struct RoleData {
  //     mapping(address account => bool) hasRole;
  //     bytes32 adminRole;
  // }
  
  // _roles is at offset 0 of the storage struct (base slot)
  // _roles[role] is at keccak256(role . baseSlot)
  const roleSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [ORDERBOOK_ROLE, baseSlot])
  );
  console.log("Slot for _roles[ORDERBOOK_ROLE]:", roleSlot);
  
  // hasRole mapping is at offset 0 of RoleData, so it's at roleSlot
  // hasRole[account] is at keccak256(account . roleSlot)
  const hasRoleSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [orderBook, roleSlot])
  );
  console.log("Slot for _roles[ORDERBOOK_ROLE].hasRole[orderBook]:", hasRoleSlot);
  
  // Read the storage
  const provider = ethers.provider;
  const value = await provider.getStorage(coreVaultAddr, hasRoleSlot);
  console.log("\nStorage value:", value);
  console.log("Has role (storage):", value !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  
  // Verify via contract call
  const cv = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    coreVaultAddr
  );
  const hasViaCall = await cv.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("Has role (hasRole):", hasViaCall);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
