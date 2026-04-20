const { ethers } = require("hardhat");
const path = require("path");

require("dotenv").config({ path: path.join(process.cwd(), ".env.local") });

async function main() {
  const [signer] = await ethers.getSigners();
  const addr = await signer.getAddress();
  
  console.log("Address:", addr);
  console.log("Nonce:", await signer.getNonce());
  
  const coreVault = process.env.CORE_VAULT_ADDRESS;
  console.log("CoreVault:", coreVault);
  
  const cv = new ethers.Contract(coreVault, [
    "function creditExternal(address user, uint256 amount) external",
    "function userCrossChainCredit(address) view returns (uint256)",
  ], signer);
  
  const testUser = "0x724CbE7b515dab1CE4B0e262990d2E3C47c6CA36"; // User001
  const amount = ethers.parseUnits("1000000", 6);
  
  console.log("Testing credit to:", testUser);
  console.log("Amount:", amount.toString());
  
  const before = await cv.userCrossChainCredit(testUser);
  console.log("Before:", ethers.formatUnits(before, 6));
  
  console.log("Sending tx...");
  const tx = await cv.creditExternal(testUser, amount);
  console.log("Tx hash:", tx.hash);
  console.log("Waiting...");
  await tx.wait();
  console.log("Done!");
  
  const after = await cv.userCrossChainCredit(testUser);
  console.log("After:", ethers.formatUnits(after, 6));
}

main().catch(console.error);
