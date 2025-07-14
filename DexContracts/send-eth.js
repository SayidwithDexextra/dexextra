const { Web3 } = require("web3");

// Connect to local Ganache instance
const web3 = new Web3("http://127.0.0.1:8545");

async function sendTestEth() {
  try {
    console.log("🚀 Connecting to Ganache...");

    // Get accounts from Ganache
    const accounts = await web3.eth.getAccounts();
    console.log(`📋 Available accounts: ${accounts.length}`);
    console.log(`💰 Sender account: ${accounts[0]}`);

    // Your Zerion wallet address
    const yourZerionAddress = "0x428d7cBd7feccf01a80dACE3d70b8eCf06451500";
    console.log(`🎯 Target wallet: ${yourZerionAddress}`);

    // Check sender balance
    const senderBalance = await web3.eth.getBalance(accounts[0]);
    console.log(
      `💵 Sender balance: ${web3.utils.fromWei(senderBalance, "ether")} ETH`
    );

    // Check target balance before
    const targetBalanceBefore = await web3.eth.getBalance(yourZerionAddress);
    console.log(
      `🏦 Target balance before: ${web3.utils.fromWei(
        targetBalanceBefore,
        "ether"
      )} ETH`
    );

    // Send 10 ETH to your Zerion wallet
    console.log("📤 Sending 10 ETH...");
    const tx = await web3.eth.sendTransaction({
      from: accounts[0],
      to: yourZerionAddress,
      value: web3.utils.toWei("10", "ether"),
      gas: 21000,
      gasPrice: web3.utils.toWei("20", "gwei"), // Use legacy gas pricing
    });

    console.log(`✅ Transaction sent!`);
    console.log(`🔗 Transaction hash: ${tx.transactionHash}`);
    console.log(`⛽ Gas used: ${tx.gasUsed}`);

    // Check target balance after
    const targetBalanceAfter = await web3.eth.getBalance(yourZerionAddress);
    console.log(
      `🏦 Target balance after: ${web3.utils.fromWei(
        targetBalanceAfter,
        "ether"
      )} ETH`
    );

    console.log("🎉 Transfer completed successfully!");
  } catch (error) {
    console.error("❌ Error sending test ETH:", error.message);

    // Check if Ganache is running
    try {
      await web3.eth.net.isListening();
      console.log("✅ Ganache connection is working");
    } catch (connectionError) {
      console.error(
        "🔌 Connection to Ganache failed. Make sure Ganache is running on port 8545"
      );
    }
  }
}

// Also create a function to send multiple smaller amounts
async function sendMultipleAmounts() {
  try {
    const accounts = await web3.eth.getAccounts();
    const yourZerionAddress = "0x60D1b2c4B2960e4ab7d7382D6b18Ee6ab872796B";

    // Send 5 ETH, 3 ETH, and 2 ETH in separate transactions
    const amounts = ["5", "3", "2"];

    for (let i = 0; i < amounts.length; i++) {
      console.log(
        `📤 Sending ${amounts[i]} ETH (transaction ${i + 1}/${
          amounts.length
        })...`
      );

      const tx = await web3.eth.sendTransaction({
        from: accounts[i], // Use different sender accounts
        to: yourZerionAddress,
        value: web3.utils.toWei(amounts[i], "ether"),
        gas: 21000,
        gasPrice: web3.utils.toWei("20", "gwei"), // Use legacy gas pricing
      });

      console.log(`✅ Transaction ${i + 1} hash: ${tx.transactionHash}`);
    }

    const finalBalance = await web3.eth.getBalance(yourZerionAddress);
    console.log(
      `🏦 Final balance: ${web3.utils.fromWei(finalBalance, "ether")} ETH`
    );
  } catch (error) {
    console.error("❌ Error in multiple transfers:", error.message);
  }
}

// Run the main function
if (require.main === module) {
  console.log("🎯 Starting test ETH transfer to Zerion wallet...");
  sendTestEth()
    .then(() => {
      console.log("✨ Script completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("💥 Script failed:", error);
      process.exit(1);
    });
}

module.exports = { sendTestEth, sendMultipleAmounts };
