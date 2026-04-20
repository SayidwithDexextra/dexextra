const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const BOND_MANAGER = "0x1B9Ba95d67a59dE2457565b49bc4917887346Eb9";
    const NEW_FACTORY = "0xFdca656410a8552d58d0437486A19d8cf273f1E8";

    const manager = await ethers.getContractAt(
        ["function setFactory(address)", "function factory() view returns (address)"],
        BOND_MANAGER,
        deployer
    );

    console.log("Current factory:", await manager.factory());
    console.log("Updating to:", NEW_FACTORY);

    const tx = await manager.setFactory(NEW_FACTORY);
    console.log("TX:", tx.hash);
    await tx.wait();
    console.log("Confirmed!");

    console.log("New factory:", await manager.factory());
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
