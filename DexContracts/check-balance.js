const { Web3 } = require("web3");

const web3 = new Web3("http://127.0.0.1:8545");

async function checkBalance(address) {
  try {
    const balance = await web3.eth.getBalance(address);
    const ethBalance = web3.utils.fromWei(balance, "ether");
    console.log(`💰 Balance for ${address}: ${ethBalance} ETH`);
    return ethBalance;
  } catch (error) {
    console.error("❌ Error checking balance:", error.message);
    return null;
  }
}

async function checkAllBalances() {
  console.log("🔍 Checking balances...");

  // Your Zerion wallet
  const yourAddress = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
  await checkBalance(yourAddress);

  // First few Ganache accounts
  const accounts = await web3.eth.getAccounts();
  console.log("\n📋 Ganache accounts:");
  for (let i = 0; i < Math.min(3, accounts.length); i++) {
    await checkBalance(accounts[i]);
  }
}

if (require.main === module) {
  checkAllBalances().catch(console.error);
}

module.exports = { checkBalance, checkAllBalances };
