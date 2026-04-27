const { ethers } = require("hardhat");

async function main() {
  const SPOKE_VAULT = "0x12684fE7d4b44c0Ef02AC2815742b46107E86091";
  const USDC_BRIDGED = "0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8";
  const USDC_NATIVE = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831";

  console.log("=== SpokeVault Configuration (Arbitrum) ===");
  console.log("Vault address:", SPOKE_VAULT);
  console.log("");

  const vault = await ethers.getContractAt("SpokeVault", SPOKE_VAULT);

  // Check allowed tokens
  const bridgedAllowed = await vault.isAllowedToken(USDC_BRIDGED);
  const nativeAllowed = await vault.isAllowedToken(USDC_NATIVE);
  
  console.log("Bridged USDC.e allowed:", bridgedAllowed);
  console.log("Native USDC allowed:", nativeAllowed);
  console.log("");

  // Check roles
  const VAULT_ADMIN_ROLE = await vault.VAULT_ADMIN_ROLE();
  const BRIDGE_INBOX_ROLE = await vault.BRIDGE_INBOX_ROLE();

  console.log("=== Roles ===");
  console.log("VAULT_ADMIN_ROLE:", VAULT_ADMIN_ROLE);
  console.log("BRIDGE_INBOX_ROLE:", BRIDGE_INBOX_ROLE);

  // Check if bridge inbox is configured
  const BRIDGE_INBOX = "0xB6aBe8327560338950183F5066AE2D085b504Fdb";
  const hasBridgeInboxRole = await vault.hasRole(BRIDGE_INBOX_ROLE, BRIDGE_INBOX);
  console.log("Bridge Inbox has role:", hasBridgeInboxRole, "(", BRIDGE_INBOX, ")");
  console.log("");

  // Check vault balances
  const erc20Abi = ["function balanceOf(address) view returns (uint256)"];
  const usdcBridged = new ethers.Contract(USDC_BRIDGED, erc20Abi, ethers.provider);
  const usdcNative = new ethers.Contract(USDC_NATIVE, erc20Abi, ethers.provider);

  console.log("=== Vault Balances ===");
  const bridgedBal = await usdcBridged.balanceOf(SPOKE_VAULT);
  const nativeBal = await usdcNative.balanceOf(SPOKE_VAULT);
  console.log("Bridged USDC.e balance:", ethers.formatUnits(bridgedBal, 6), "USDC.e");
  console.log("Native USDC balance:", ethers.formatUnits(nativeBal, 6), "USDC");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
