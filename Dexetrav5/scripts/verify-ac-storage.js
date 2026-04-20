const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const coreVaultAddr = process.env.CORE_VAULT_ADDRESS;
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  const ORDERBOOK_ROLE = "0xe7d7e4bf430fa940e5a18beda68ad1833bb0bb84161df1150cd5a705786bf6e7";
  
  console.log("CoreVault:", coreVaultAddr);
  console.log("Order Book:", orderBook);
  console.log("ORDERBOOK_ROLE:", ORDERBOOK_ROLE);
  
  // OpenZeppelin v5 AccessControlUpgradeable storage namespace
  // keccak256(abi.encode(uint256(keccak256("openzeppelin.storage.AccessControl")) - 1)) & ~bytes32(uint256(0xff))
  const namespace = ethers.keccak256(ethers.toUtf8Bytes("openzeppelin.storage.AccessControl"));
  console.log("\nAccessControl namespace raw:", namespace);
  
  // Compute the base slot (with -1 and masking)
  const namespaceBigInt = BigInt(namespace) - 1n;
  const masked = namespaceBigInt & ~BigInt(0xff);
  const baseSlot = "0x" + masked.toString(16).padStart(64, "0");
  console.log("AccessControl base slot:", baseSlot);
  
  // _roles mapping is at offset 0 from base slot
  // _roles[role].members[account] is at keccak256(account, keccak256(role, baseSlot))
  
  // First level: slot for _roles[ORDERBOOK_ROLE]
  const roleSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "bytes32"], [ORDERBOOK_ROLE, baseSlot])
  );
  console.log("Slot for _roles[ORDERBOOK_ROLE]:", roleSlot);
  
  // The RoleData struct has: mapping(address => bool) members, bytes32 adminRole
  // members is at offset 0 of RoleData
  // So _roles[role].members[account] is at keccak256(account, roleSlot)
  
  const memberSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(["address", "bytes32"], [orderBook, roleSlot])
  );
  console.log("Slot for _roles[ORDERBOOK_ROLE].members[orderBook]:", memberSlot);
  
  // Read the storage
  const provider = ethers.provider;
  const value = await provider.getStorage(coreVaultAddr, memberSlot);
  console.log("\nStorage value:", value);
  console.log("Has role (storage):", value !== "0x0000000000000000000000000000000000000000000000000000000000000000");
  
  // Also verify via contract call
  const cv = await ethers.getContractAt(
    ["function hasRole(bytes32,address) view returns (bool)"],
    coreVaultAddr
  );
  const hasViaCall = await cv.hasRole(ORDERBOOK_ROLE, orderBook);
  console.log("Has role (hasRole):", hasViaCall);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
