const { ethers } = require('hardhat');
async function main() {
  // Query the market (DiamondRegistry) for its FacetRegistry
  const market = await ethers.getContractAt(['function facetRegistry() view returns (address)'], '0xade7a2029881a22479a188Ba24F38686454aA069');
  const reg = await market.facetRegistry();
  console.log('FacetRegistry:', reg);
}
main();
