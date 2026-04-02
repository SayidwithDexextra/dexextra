const { ethers } = require("hardhat");
async function main() {
  const ob = new ethers.Contract(
    "0x53e735fA72f8E7037892D60Dc4893E9E7a533ecF",
    ["function owner() view returns (address)"],
    ethers.provider
  );
  const owner = await ob.owner();
  const [deployer] = await ethers.getSigners();
  console.log("OrderBook owner:", owner);
  console.log("Current deployer (ADMIN_PRIVATE_KEY):", deployer.address);
  console.log("Match:", owner.toLowerCase() === deployer.address.toLowerCase());
}
main().catch(console.error);
