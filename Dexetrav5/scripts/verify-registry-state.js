const { ethers } = require("hardhat");

async function main() {
  console.log("\n🔍 Verifying FacetRegistry State\n");
  console.log("═".repeat(70));

  const registryAddr = "0xdcbbD419f642c9b0481384f46E52f660AE8acEc9";
  
  // Expected new addresses from today's deployment
  const expectedPlacement = "0x8F0caf1dA416994880E72A673f05a8A1d67c6327";
  const expectedMeta = "0x43Cddf01c45CC87a543f198829fb1AbE61D3CDf3";

  // Key function selectors to check
  const selectors = {
    // OBOrderPlacementFacet
    "placeMarginLimitOrder(uint256,uint256,bool)": { expected: expectedPlacement },
    "placeMarginMarketOrder(uint256,bool)": { expected: expectedPlacement },
    "cancelOrder(uint256)": { expected: expectedPlacement },
    
    // MetaTradeFacet  
    "metaPlaceMarginLimit((address,uint256,uint256,bool,uint256,uint256),bytes)": { expected: expectedMeta },
    "metaPlaceMarginMarket((address,uint256,bool,uint256,uint256),bytes)": { expected: expectedMeta },
    "sessionPlaceMarginLimit(bytes32,address,uint256,uint256,bool,bytes32[])": { expected: expectedMeta },
    "sessionPlaceMarginMarket(bytes32,address,uint256,bool,bytes32[])": { expected: expectedMeta },
    "createSession((address,address,uint256,uint256,uint256,bytes32,bytes32,bytes32[],uint256),bytes)": { expected: expectedMeta },
  };

  const registry = await ethers.getContractAt(
    [
      "function getFacet(bytes4 selector) view returns (address)",
      "function selectorToFacet(bytes4 selector) view returns (address)",
      "function version() view returns (uint256)",
      "function selectorCount() view returns (uint256)"
    ],
    registryAddr
  );
  
  const version = await registry.version();
  const count = await registry.selectorCount();
  console.log(`Registry version: ${version}`);
  console.log(`Total selectors: ${count}\n`);

  console.log(`FacetRegistry: ${registryAddr}\n`);
  console.log("Checking selectors...\n");

  let allMatch = true;

  for (const [sig, info] of Object.entries(selectors)) {
    const selector = ethers.id(sig).slice(0, 10);
    const actual = await registry.getFacet(selector);
    const match = actual.toLowerCase() === info.expected.toLowerCase();
    
    const status = match ? "✅" : "❌";
    const shortActual = `${actual.slice(0, 10)}...${actual.slice(-6)}`;
    const shortExpected = `${info.expected.slice(0, 10)}...${info.expected.slice(-6)}`;
    
    console.log(`${status} ${selector} ${sig.split("(")[0]}`);
    console.log(`   Actual:   ${shortActual}`);
    if (!match) {
      console.log(`   Expected: ${shortExpected}`);
      allMatch = false;
    }
    console.log();
  }

  console.log("═".repeat(70));
  if (allMatch) {
    console.log("✅ All selectors point to the NEW facet addresses!");
    console.log(`   OBOrderPlacementFacet: ${expectedPlacement}`);
    console.log(`   MetaTradeFacet:        ${expectedMeta}`);
  } else {
    console.log("❌ Some selectors don't match expected addresses");
  }
  console.log("═".repeat(70) + "\n");
}

main().catch(console.error);
