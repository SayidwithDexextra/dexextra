const { ethers } = require("hardhat");

async function main() {
  const provider = ethers.provider;
  
  // Relayer has more funds
  const relayerKey = process.env.RELAYER_PRIVATE_KEY;
  if (!relayerKey) {
    console.error("RELAYER_PRIVATE_KEY not set");
    process.exit(1);
  }
  
  const relayer = new ethers.Wallet(relayerKey, provider);
  const [deployer] = await ethers.getSigners();
  
  console.log("Relayer:", relayer.address);
  console.log("Relayer balance:", ethers.formatEther(await provider.getBalance(relayer.address)), "ETH");
  console.log("Deployer:", deployer.address);
  console.log("Deployer balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");
  
  // Send 0.01 ETH to deployer
  const amount = ethers.parseEther("0.01");
  console.log(`\nSending ${ethers.formatEther(amount)} ETH to deployer...`);
  
  const tx = await relayer.sendTransaction({
    to: deployer.address,
    value: amount
  });
  console.log("Tx hash:", tx.hash);
  await tx.wait();
  
  console.log("Done!");
  console.log("Deployer new balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
