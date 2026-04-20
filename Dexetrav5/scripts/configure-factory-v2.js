const { ethers } = require("hardhat");

async function main() {
    const [deployer] = await ethers.getSigners();
    const FACTORY = '0xFdca656410a8552d58d0437486A19d8cf273f1E8';
    const FACET_REGISTRY = process.env.FACET_REGISTRY_ADDRESS;
    const INIT_FACET = process.env.ORDER_BOOK_INIT_FACET;
    const BOND_MANAGER = process.env.MARKET_BOND_MANAGER_ADDRESS;
    const CORE_VAULT = process.env.CORE_VAULT_ADDRESS;
    
    console.log('Deployer:', deployer.address);
    console.log('Configuring factory:', FACTORY);
    console.log('FACET_REGISTRY:', FACET_REGISTRY);
    console.log('INIT_FACET:', INIT_FACET);
    console.log('BOND_MANAGER:', BOND_MANAGER);
    console.log('CORE_VAULT:', CORE_VAULT);
    
    const factory = await ethers.getContractAt([
        'function setFacetRegistry(address)',
        'function setInitFacet(address)',
        'function setBondManager(address)',
        'function facetRegistry() view returns (address)',
        'function initFacetAddress() view returns (address)',
        'function bondManager() view returns (address)',
    ], FACTORY, deployer);
    
    // Set FacetRegistry
    console.log('\nSetting facetRegistry:', FACET_REGISTRY);
    let tx = await factory.setFacetRegistry(FACET_REGISTRY);
    await tx.wait();
    console.log('Done');
    
    // Set InitFacet
    console.log('Setting initFacet:', INIT_FACET);
    tx = await factory.setInitFacet(INIT_FACET);
    await tx.wait();
    console.log('Done');
    
    // Set BondManager
    console.log('Setting bondManager:', BOND_MANAGER);
    tx = await factory.setBondManager(BOND_MANAGER);
    await tx.wait();
    console.log('Done');
    
    // Grant roles on CoreVault
    console.log('\nGranting roles on CoreVault...');
    const vault = await ethers.getContractAt([
        'function grantRole(bytes32, address)',
        'function FACTORY_ROLE() view returns (bytes32)',
        'function SETTLEMENT_ROLE() view returns (bytes32)',
        'function hasRole(bytes32, address) view returns (bool)'
    ], CORE_VAULT, deployer);
    
    const FACTORY_ROLE = await vault.FACTORY_ROLE();
    const SETTLEMENT_ROLE = await vault.SETTLEMENT_ROLE();
    
    if (!(await vault.hasRole(FACTORY_ROLE, FACTORY))) {
        tx = await vault.grantRole(FACTORY_ROLE, FACTORY);
        await tx.wait();
        console.log('Granted FACTORY_ROLE');
    } else {
        console.log('Already has FACTORY_ROLE');
    }
    
    if (!(await vault.hasRole(SETTLEMENT_ROLE, FACTORY))) {
        tx = await vault.grantRole(SETTLEMENT_ROLE, FACTORY);
        await tx.wait();
        console.log('Granted SETTLEMENT_ROLE');
    } else {
        console.log('Already has SETTLEMENT_ROLE');
    }
    
    // Verify
    console.log('\n=== Verification ===');
    console.log('facetRegistry:', await factory.facetRegistry());
    console.log('initFacetAddress:', await factory.initFacetAddress());
    console.log('bondManager:', await factory.bondManager());
    console.log('\nFactory configured successfully!');
    console.log('\n⚠️  Update your .env.local:');
    console.log('FUTURES_MARKET_FACTORY_ADDRESS=' + FACTORY);
    console.log('NEXT_PUBLIC_FUTURES_MARKET_FACTORY_ADDRESS=' + FACTORY);
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
