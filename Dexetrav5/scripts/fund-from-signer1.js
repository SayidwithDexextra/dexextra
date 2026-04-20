const { ethers } = require("hardhat");

async function main() {
  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const funder = signers[1];

  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "HYPE");
  console.log("\nFunder:", funder.address);
  console.log("Funder balance:", ethers.formatEther(await ethers.provider.getBalance(funder.address)), "HYPE");

  const amount = ethers.parseEther("0.01");
  console.log(`\nSending ${ethers.formatEther(amount)} HYPE to deployer...`);

  const tx = await funder.sendTransaction({
    to: deployer.address,
    value: amount,
  });
  console.log("Tx hash:", tx.hash);
  await tx.wait();
  console.log("✅ Done!");

  console.log("\nNew deployer balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "HYPE");
  console.log("New funder balance:", ethers.formatEther(await ethers.provider.getBalance(funder.address)), "HYPE");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
