require("@nomicfoundation/hardhat-toolbox");
require("@nomicfoundation/hardhat-verify");
require("dotenv").config();

const { ALCHEMY_API_KEY, PRIVATE_KEY } = process.env;

// Validate private key
if (!PRIVATE_KEY || PRIVATE_KEY.length < 64) {
  console.warn("⚠️ PRIVATE_KEY environment variable is missing or invalid");
  console.warn(
    "   Please create a .env file with a valid private key to use network deployments"
  );
}

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 1, // Minimum runs for maximum size reduction
      },
      viaIR: true, // Enable intermediate representation for complex contracts
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
    },
    sepolia: {
      url: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts:
        PRIVATE_KEY && PRIVATE_KEY.length >= 64
          ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`]
          : [],
    },
    polygon: {
      url: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
      accounts:
        PRIVATE_KEY && PRIVATE_KEY.length >= 64
          ? [PRIVATE_KEY.startsWith("0x") ? PRIVATE_KEY : `0x${PRIVATE_KEY}`]
          : [],
    },
  },
  etherscan: {
    apiKey: {
      mainnet: process.env.ETHERSCAN_API_KEY,
      sepolia: process.env.ETHERSCAN_API_KEY,
      polygon: process.env.POLYGONSCAN_API_KEY,
      polygonMumbai: process.env.POLYGONSCAN_API_KEY,
    },
  },
  sourcify: {
    // Disabled by default
    // https://github.com/ethereum/sourcify/issues/398
    enabled: false,
  },
};
