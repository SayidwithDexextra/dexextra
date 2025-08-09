const fetch = require("node-fetch");

// Alchemy API configuration
const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || "demo"; // Replace with your Alchemy API key
const ALCHEMY_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Verified contract addresses for major stablecoins on Ethereum mainnet
const TOKEN_CONTRACTS = {
  USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  USDT: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
  DAI: "0x6B175474E89094C44Da98b954EedeAC495271d0F",
};

// Fallback metadata for major stablecoins (official information)
const FALLBACK_METADATA = {
  USDC: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 6,
    logo: "https://upload.wikimedia.org/wikipedia/commons/4/4a/Circle_USDC_Logo.svg",
  },
  USDT: {
    name: "Tether USD",
    symbol: "USDT",
    decimals: 6,
    logo: "https://tether.to/downloads/tether-logo-green.svg",
  },
  DAI: {
    name: "Dai Stablecoin",
    symbol: "DAI",
    decimals: 18,
    logo: "https://cryptologos.cc/logos/multi-collateral-dai-dai-logo.svg",
  },
};

// Function to fetch token metadata from Alchemy
async function getTokenMetadata(contractAddress, tokenName) {
  try {
    const response = await fetch(ALCHEMY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "alchemy_getTokenMetadata",
        params: [contractAddress],
        id: 1,
      }),
    });

    const data = await response.json();

    if (data.error || !data.result) {
      console.log(
        `⚠️  Alchemy API failed for ${tokenName}, using fallback metadata`
      );
      return {
        token: tokenName,
        contractAddress,
        metadata: FALLBACK_METADATA[tokenName],
      };
    }

    return {
      token: tokenName,
      contractAddress,
      metadata: data.result,
    };
  } catch (error) {
    console.log(
      `⚠️  Alchemy API failed for ${tokenName}, using fallback metadata`
    );
    return {
      token: tokenName,
      contractAddress,
      metadata: FALLBACK_METADATA[tokenName],
    };
  }
}

// Main function to fetch all token metadata
async function fetchAllTokenMetadata() {
  console.log("Fetching token metadata...\n");

  const results = {};

  for (const [tokenName, contractAddress] of Object.entries(TOKEN_CONTRACTS)) {
    console.log(`Fetching ${tokenName} metadata...`);
    const metadata = await getTokenMetadata(contractAddress, tokenName);

    if (metadata) {
      results[tokenName] = metadata;
      console.log(`✅ ${tokenName}:`, {
        name: metadata.metadata.name,
        symbol: metadata.metadata.symbol,
        decimals: metadata.metadata.decimals,
        logo: metadata.metadata.logo,
      });
    } else {
      console.log(`❌ Failed to fetch ${tokenName} metadata`);
    }

    // Add small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log("\n📋 Complete Token Metadata for Deposit Modal:");
  console.log(JSON.stringify(results, null, 2));

  return results;
}

// Run the script
if (require.main === module) {
  fetchAllTokenMetadata()
    .then(() => {
      console.log("\n✅ Token metadata fetch completed!");
      console.log("\n🔄 Ready to update DepositModal with this metadata");
    })
    .catch((error) => {
      console.error("❌ Script failed:", error);
      process.exit(1);
    });
}

module.exports = {
  fetchAllTokenMetadata,
  getTokenMetadata,
  TOKEN_CONTRACTS,
  FALLBACK_METADATA,
};
