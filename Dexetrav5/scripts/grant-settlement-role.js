const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    const VAULT = "0x8DF1752FbBC364fD4aF7cBA8a1F8B1B345F767f1";
    const FACTORY = "0x60f1703C16D3E2aB55e87CA1845cc43D9Da46439";

    const vaultABI = [
        "function grantRole(bytes32 role, address account)",
        "function SETTLEMENT_ROLE() view returns (bytes32)",
        "function hasRole(bytes32 role, address account) view returns (bool)"
    ];

    const vault = new ethers.Contract(VAULT, vaultABI, deployer);

    const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();
    console.log("SETTLEMENT_ROLE:", SETTLEMENT_ROLE);

    const hasBefore = await vault.hasRole(SETTLEMENT_ROLE, FACTORY);
    console.log("Factory has SETTLEMENT_ROLE before:", hasBefore);

    if (!hasBefore) {
        console.log("Granting SETTLEMENT_ROLE to factory...");
        const tx = await vault.grantRole(SETTLEMENT_ROLE, FACTORY);
        console.log("TX hash:", tx.hash);
        await tx.wait();
        console.log("Transaction confirmed");
    }

    const hasAfter = await vault.hasRole(SETTLEMENT_ROLE, FACTORY);
    console.log("Factory has SETTLEMENT_ROLE after:", hasAfter);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
