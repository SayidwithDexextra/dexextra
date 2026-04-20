const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("Deployer:", deployer.address);
    console.log("Balance:", ethers.formatEther(await ethers.provider.getBalance(deployer.address)), "ETH");

    // Current config from env
    const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
    const OLD_FACTORY = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
    const FACET_REGISTRY = process.env.FACET_REGISTRY_ADDRESS;
    const INIT_FACET = process.env.ORDER_BOOK_INIT_FACET;
    const BOND_MANAGER = process.env.MARKET_BOND_MANAGER_ADDRESS || process.env.BOND_MANAGER_ADDRESS;

    console.log("\n=== Current Configuration ===");
    console.log("CoreVault:", CORE_VAULT);
    console.log("Old Factory:", OLD_FACTORY);
    console.log("FacetRegistry:", FACET_REGISTRY);
    console.log("InitFacet:", INIT_FACET);
    console.log("BondManager:", BOND_MANAGER);

    if (!CORE_VAULT) throw new Error("Missing CORE_VAULT_ADDRESS");

    // Read fee recipient from old factory if available
    let feeRecipient = deployer.address;
    let marketCreationFee = 100n * 10n**6n; // 100 USDC default
    
    if (OLD_FACTORY) {
        try {
            const oldFactory = await ethers.getContractAt([
                "function feeRecipient() view returns (address)",
                "function marketCreationFee() view returns (uint256)"
            ], OLD_FACTORY);
            feeRecipient = await oldFactory.feeRecipient();
            marketCreationFee = await oldFactory.marketCreationFee();
            console.log("Copied feeRecipient:", feeRecipient);
            console.log("Copied marketCreationFee:", marketCreationFee.toString());
        } catch (e) {
            console.log("Could not read old factory config, using defaults");
        }
    }

    // Deploy new factory (constructor takes vault, admin, feeRecipient)
    console.log("\n=== Deploying FuturesMarketFactoryV2 ===");
    const Factory = await ethers.getContractFactory("FuturesMarketFactoryV2");
    const newFactory = await Factory.deploy(CORE_VAULT, deployer.address, feeRecipient);
    await newFactory.waitForDeployment();
    const newFactoryAddress = await newFactory.getAddress();
    console.log("New FuturesMarketFactoryV2 deployed to:", newFactoryAddress);

    // Configure the factory
    console.log("\n=== Configuring Factory ===");

    // Set market creation fee
    let tx = await newFactory.setMarketCreationFee(marketCreationFee);
    await tx.wait();
    console.log("Set marketCreationFee:", marketCreationFee.toString());

    // Set FacetRegistry
    if (FACET_REGISTRY) {
        tx = await newFactory.setFacetRegistry(FACET_REGISTRY);
        await tx.wait();
        console.log("Set facetRegistry:", FACET_REGISTRY);
    }

    // Set InitFacet
    if (INIT_FACET) {
        tx = await newFactory.setInitFacet(INIT_FACET);
        await tx.wait();
        console.log("Set initFacetAddress:", INIT_FACET);
    }

    // Set BondManager
    if (BOND_MANAGER) {
        tx = await newFactory.setBondManager(BOND_MANAGER);
        await tx.wait();
        console.log("Set bondManager:", BOND_MANAGER);
    }

    // Grant FACTORY_ROLE on CoreVault
    console.log("\n=== Granting Roles ===");
    const VaultABI = [
        "function grantRole(bytes32 role, address account)",
        "function FACTORY_ROLE() view returns (bytes32)",
        "function SETTLEMENT_ROLE() view returns (bytes32)",
        "function hasRole(bytes32 role, address account) view returns (bool)"
    ];
    const vault = new ethers.Contract(CORE_VAULT, VaultABI, deployer);

    const FACTORY_ROLE = await vault.FACTORY_ROLE();
    const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();

    // FACTORY_ROLE
    if (!(await vault.hasRole(FACTORY_ROLE, newFactoryAddress))) {
        tx = await vault.grantRole(FACTORY_ROLE, newFactoryAddress);
        await tx.wait();
        console.log("Granted FACTORY_ROLE");
    } else {
        console.log("Already has FACTORY_ROLE");
    }

    // SETTLEMENT_ROLE
    if (!(await vault.hasRole(SETTLEMENT_ROLE, newFactoryAddress))) {
        tx = await vault.grantRole(SETTLEMENT_ROLE, newFactoryAddress);
        await tx.wait();
        console.log("Granted SETTLEMENT_ROLE");
    } else {
        console.log("Already has SETTLEMENT_ROLE");
    }

    // Verify configuration
    console.log("\n=== Verification ===");
    console.log("vault:", await newFactory.vault());
    console.log("feeRecipient:", await newFactory.feeRecipient());
    console.log("bondManager:", await newFactory.bondManager());
    console.log("facetRegistry:", await newFactory.facetRegistry());
    console.log("initFacetAddress:", await newFactory.initFacetAddress());

    console.log("\n=== Summary ===");
    console.log("New FuturesMarketFactoryV2:", newFactoryAddress);
    console.log("\n⚠️  Update your .env.local:");
    console.log(`FUTURES_MARKET_FACTORY_ADDRESS=${newFactoryAddress}`);
    console.log(`NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=${newFactoryAddress}`);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
