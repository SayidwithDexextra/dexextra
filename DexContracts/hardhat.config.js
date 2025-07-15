require("@nomicfoundation/hardhat-toolbox");

module.exports = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
      allowUnlimitedContractSize: true,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      allowUnlimitedContractSize: true,
    },
    polygon: {
      url: "https://polygon-rpc.com/", // or use Alchemy/Infura
      chainId: 137,
      gasPrice: 30000000000, // 30 gwei
      accounts: [
        // Add your private key here (use environment variable!)
        // process.env.PRIVATE_KEY
      ],
    },
    mumbai: {
      url: "https://rpc-mumbai.maticvigil.com/",
      chainId: 80001,
      gasPrice: 20000000000,
      accounts: [
        // process.env.PRIVATE_KEY
      ],
    },
  },
  etherscan: {
    apiKey: {
      polygon: process.env.POLYGONSCAN_API_KEY,
      polygonMumbai: process.env.POLYGONSCAN_API_KEY,
    },
  },
};
