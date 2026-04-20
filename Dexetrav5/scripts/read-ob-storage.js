const { ethers } = require("hardhat");
require("dotenv").config({ path: "../.env.local" });

async function main() {
  const orderBook = "0xaB69f1906114D891A6A90212a013fc1aE5A1002a";
  
  console.log("Order Book:", orderBook);
  
  // The storage slot for OrderBookStorage.State
  // STORAGE_SLOT = keccak256("hyperliquid.orderbook.storage.v1")
  const baseSlot = ethers.keccak256(ethers.toUtf8Bytes("hyperliquid.orderbook.storage.v1"));
  console.log("OrderBookStorage base slot:", baseSlot);
  
  // The vault is the FIRST field in the State struct (slot 0 of the struct)
  // So the vault address is stored at baseSlot + 0
  const vaultSlot = baseSlot;
  
  const provider = ethers.provider;
  const vaultValue = await provider.getStorage(orderBook, vaultSlot);
  
  console.log("\nRaw storage value at vault slot:", vaultValue);
  
  // Extract the address (last 40 hex chars = 20 bytes)
  const vaultAddress = "0x" + vaultValue.slice(26);
  console.log("Vault address from storage:", vaultAddress);
  
  console.log("\nExpected vault:", process.env.CORE_VAULT_ADDRESS);
  console.log("Match:", vaultAddress.toLowerCase() === process.env.CORE_VAULT_ADDRESS.toLowerCase());
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
