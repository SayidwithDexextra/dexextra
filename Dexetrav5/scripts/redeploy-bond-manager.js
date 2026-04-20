const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);

    // Read existing config from environment
    const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
    const FACTORY_V2 = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
    const OLD_BOND_MANAGER = process.env.BOND_MANAGER_ADDRESS;

    console.log("\n=== Current Configuration ===");
    console.log("CoreVault:", CORE_VAULT);
    console.log("FactoryV2:", FACTORY_V2);
    console.log("Old BondManager:", OLD_BOND_MANAGER);

    if (!CORE_VAULT || !FACTORY_V2) {
        throw new Error("Missing CORE_VAULT_ADDRESS or FUTURES_MARKET_FACTORY_ADDRESS");
    }

    // Get bond config from old manager if available
    let defaultBondAmount = 0; // 0 USDC = disabled
    let minBondAmount = 0;
    let maxBondAmount = 0;

    if (OLD_BOND_MANAGER) {
        try {
            const oldBondManager = await ethers.getContractAt(
                ["function defaultBondAmount() view returns (uint256)", 
                 "function minBondAmount() view returns (uint256)",
                 "function maxBondAmount() view returns (uint256)"],
                OLD_BOND_MANAGER
            );
            defaultBondAmount = await oldBondManager.defaultBondAmount();
            minBondAmount = await oldBondManager.minBondAmount();
            maxBondAmount = await oldBondManager.maxBondAmount();
            console.log("Copied bond config from old manager:", {
                defaultBondAmount: defaultBondAmount.toString(),
                minBondAmount: minBondAmount.toString(),
                maxBondAmount: maxBondAmount.toString()
            });
        } catch (e) {
            console.log("Could not read old bond config, using defaults (0)");
        }
    }

    // Deploy new BondManager with correct factory
    console.log("\n=== Deploying New BondManager ===");
    const BondManager = await ethers.getContractFactory("MarketBondManager");
    const newBondManager = await BondManager.deploy(
        CORE_VAULT,
        FACTORY_V2,  // Use the new factory
        deployer.address,
        defaultBondAmount,
        minBondAmount,
        maxBondAmount
    );
    await newBondManager.waitForDeployment();
    const newBondManagerAddress = await newBondManager.getAddress();
    console.log("New BondManager deployed to:", newBondManagerAddress);

    // Verify factory address in new bond manager
    const storedFactory = await newBondManager.factory();
    console.log("BondManager.factory() =", storedFactory);

    // Grant FACTORY_ROLE on CoreVault to new BondManager
    console.log("\n=== Granting FACTORY_ROLE to new BondManager ===");
    const CoreVaultABI = [
        "function grantRole(bytes32 role, address account)",
        "function FACTORY_ROLE() view returns (bytes32)",
        "function hasRole(bytes32 role, address account) view returns (bool)"
    ];
    const coreVault = new ethers.Contract(CORE_VAULT, CoreVaultABI, deployer);

    const FACTORY_ROLE = await coreVault.FACTORY_ROLE();
    console.log("FACTORY_ROLE:", FACTORY_ROLE);

    const hasRole = await coreVault.hasRole(FACTORY_ROLE, newBondManagerAddress);
    if (!hasRole) {
        const tx = await coreVault.grantRole(FACTORY_ROLE, newBondManagerAddress);
        await tx.wait();
        console.log("Granted FACTORY_ROLE to new BondManager");
    } else {
        console.log("BondManager already has FACTORY_ROLE");
    }

    // Update FactoryV2 to point to new BondManager
    console.log("\n=== Updating FactoryV2 with new BondManager ===");
    const FactoryABI = [
        "function setBondManager(address _bondManager)",
        "function bondManager() view returns (address)"
    ];
    const factory = new ethers.Contract(FACTORY_V2, FactoryABI, deployer);

    const currentBondManager = await factory.bondManager();
    console.log("Current bondManager in factory:", currentBondManager);

    if (currentBondManager.toLowerCase() !== newBondManagerAddress.toLowerCase()) {
        const tx = await factory.setBondManager(newBondManagerAddress);
        await tx.wait();
        console.log("Updated factory.bondManager to:", newBondManagerAddress);
    } else {
        console.log("Factory already pointing to new BondManager");
    }

    console.log("\n=== Summary ===");
    console.log("New BondManager:", newBondManagerAddress);
    console.log("Factory updated: Yes");
    console.log("FACTORY_ROLE granted: Yes");
    console.log("\n⚠️  Update your .env.local:");
    console.log(`BOND_MANAGER_ADDRESS=${newBondManagerAddress}`);
    console.log(`NEXT_PUBLIC_BOND_MANAGER_ADDRESS=${newBondManagerAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
