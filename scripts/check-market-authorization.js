const { ethers } = require("ethers");

const VAULT_ROUTER_ADDRESS = "0xd97d644cFb69ab409de2d4eE413fACB93CCD2ff7";
const ALUMINUM_V2_MARKET_ID =
  "0xe9ce0bf5211b5af4539f87e2de07adc71914168eb8474e50ec4ea33f565d46d5";

const VAULT_ROUTER_ABI = [
  {
    inputs: [{ name: "marketId", type: "bytes32" }],
    name: "authorizedMarkets",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
];

async function main() {
  console.log("🔍 Checking Market Authorization Status...\n");

  const provider = new ethers.JsonRpcProvider("https://polygon-rpc.com/");

  // Check if contract exists
  const code = await provider.getCode(VAULT_ROUTER_ADDRESS);
  if (code === "0x") {
    console.log("❌ VaultRouter contract not found");
    return;
  }
  console.log(`✅ VaultRouter contract exists (${code.length} bytes)`);

  // Create contract instance
  const vaultRouter = new ethers.Contract(
    VAULT_ROUTER_ADDRESS,
    VAULT_ROUTER_ABI,
    provider
  );

  try {
    console.log(
      `📋 Checking authorization for market ID: ${ALUMINUM_V2_MARKET_ID}`
    );
    console.log(`📋 Symbol: Aluminum V2`);

    const isAuthorized = await vaultRouter.authorizedMarkets(
      ALUMINUM_V2_MARKET_ID
    );

    console.log(
      `\n🔐 Authorization Status: ${
        isAuthorized ? "✅ AUTHORIZED" : "❌ NOT AUTHORIZED"
      }`
    );

    if (!isAuthorized) {
      console.log(
        "\n💡 Solution: The market needs to be authorized in VaultRouter"
      );
      console.log("   This can be done by calling:");
      console.log(
        `   vaultRouter.setMarketAuthorization("${ALUMINUM_V2_MARKET_ID}", true)`
      );
      console.log(
        "\n   This requires DEFAULT_ADMIN_ROLE on the VaultRouter contract"
      );
    } else {
      console.log("\n✅ Market is properly authorized for trading!");
    }
  } catch (error) {
    console.log(`❌ Error checking authorization: ${error.message}`);
  }
}

main().catch((error) => {
  console.error("💥 Script failed:", error);
  process.exit(1);
});
