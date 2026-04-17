const { ethers } = require("hardhat");

function getSelectorsFromAbi(abi) {
  const iface = new ethers.Interface(abi);
  return iface.fragments
    .filter(f => f.type === 'function')
    .map(f => iface.getFunction(f.name).selector);
}

async function main() {
  // Use relayer key which has more funds, but must be admin of registry
  const provider = ethers.provider;
  const registryAddress = process.env.FACET_REGISTRY_ADDRESS || "0xdcbbD419f642c9b0481384f46E52f660AE8acEc9";
  
  // Check who is admin
  const adminCheckAbi = ["function admin() view returns (address)"];
  const registryCheck = new ethers.Contract(registryAddress, adminCheckAbi, provider);
  const adminAddr = await registryCheck.admin();
  console.log("Registry admin:", adminAddr);
  
  // Get the deployer (admin)
  const [deployer] = await ethers.getSigners();
  console.log("Using account:", deployer.address);
  console.log("Account balance:", ethers.formatEther(await provider.getBalance(deployer.address)), "ETH");

  if (deployer.address.toLowerCase() !== adminAddr.toLowerCase()) {
    console.error("ERROR: Signer is not the registry admin!");
    console.log("You need to either:");
    console.log("  1. Use ADMIN_PRIVATE_KEY that matches the registry admin");
    console.log("  2. Transfer admin to another address with more funds");
    process.exit(1);
  }

  const lifecycleFacetAddress = process.env.MARKET_LIFECYCLE_FACET;

  if (!lifecycleFacetAddress || !ethers.isAddress(lifecycleFacetAddress)) {
    console.error("MARKET_LIFECYCLE_FACET not set");
    process.exit(1);
  }

  const registryAbi = [
    "function registerFacet(address _facet, bytes4[] calldata _selectors) external",
    "function selectorCount() view returns (uint256)",
    "function version() view returns (uint256)",
    "function admin() view returns (address)"
  ];

  const registry = new ethers.Contract(registryAddress, registryAbi, deployer);

  // Load artifact
  const artifact = await hre.artifacts.readArtifact("MarketLifecycleFacet");
  const selectors = getSelectorsFromAbi(artifact.abi);

  console.log(`\nRegistering MarketLifecycleFacet:`);
  console.log(`  Registry: ${registryAddress}`);
  console.log(`  Facet: ${lifecycleFacetAddress}`);
  console.log(`  Selectors: ${selectors.length}`);

  // Estimate gas first
  const gasEstimate = await registry.registerFacet.estimateGas(lifecycleFacetAddress, selectors);
  console.log(`  Gas estimate: ${gasEstimate.toString()}`);

  const tx = await registry.registerFacet(lifecycleFacetAddress, selectors, {
    gasLimit: gasEstimate * 12n / 10n // 20% buffer
  });
  console.log(`  Tx sent: ${tx.hash}`);
  
  await tx.wait();
  console.log(`  ✅ Registered ${selectors.length} selectors`);

  // Verify
  const totalSelectors = await registry.selectorCount();
  const version = await registry.version();
  console.log(`\nRegistry now has ${totalSelectors} selectors (version ${version})`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
