const { ethers } = require("hardhat");

async function main() {
  const provider = ethers.provider;
  
  const addresses = {
    SANDBOX_OOV3: "0x0F5341665c9cc2bB663333b2f197A65E862b51b8",
    DISPUTE_RELAY: "0x94E2545BefE6085D719D733F2777ed8386ef803B",
  };
  
  console.log("\n=== Contract Code Check ===\n");
  
  for (const [name, addr] of Object.entries(addresses)) {
    const code = await provider.getCode(addr);
    const hasCode = code && code !== "0x" && code.length > 2;
    console.log(`${name} (${addr}):`);
    console.log(`  Has code: ${hasCode}`);
    if (hasCode) {
      console.log(`  Code length: ${code.length} chars`);
    }
  }
}

main().catch(console.error);
