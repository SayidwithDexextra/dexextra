const { ethers } = require("hardhat");
async function main() {
  const [signer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(signer.address);
  console.log("Address:", signer.address);
  console.log("Balance:", ethers.formatEther(balance), "HYPE");
  console.log("Balance (wei):", balance.toString());
}
main().catch(console.error);
