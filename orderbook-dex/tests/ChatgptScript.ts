const { ethers } = require("hardhat");

async function main() {
  // --- CONFIG ---
  const ORDERBOOK_ADDRESS = "0xYourOrderBookAddress";  // replace with deployed OrderBook address
  const VAULT_ADDRESS = "0xYourVaultAddress";          // replace with deployed Vault address
  const COLLATERAL_TOKEN_ADDRESS = "0xff541e2AEc7716725f8EDD02945A1Fe15664588b"; // your custom token

  const QUANTITY = ethers.utils.parseEther("1");  // 1 unit
  const PRICE = ethers.utils.parseEther("10");    // $10 with 18 decimals
  const EXPIRY = Math.floor(Date.now() / 1000) + 3600; // 1h from now

  // --- SETUP ---
  const [trader] = await ethers.getSigners();
  console.log("Using trader:", trader.address);

  // Load contracts
  const collateral = await ethers.getContractAt("IERC20", COLLATERAL_TOKEN_ADDRESS, trader);
  const vault = await ethers.getContractAt("Vault", VAULT_ADDRESS, trader);
  const orderBook = await ethers.getContractAt("OrderBook", ORDERBOOK_ADDRESS, trader);

  // --- STEP 1: Approve collateral ---
  const approveAmount = ethers.utils.parseEther("100"); // approve more than enough
  const tx1 = await collateral.approve(VAULT_ADDRESS, approveAmount);
  await tx1.wait();
  console.log("Collateral approved for Vault:", approveAmount.toString());

  // --- STEP 2: Allocate collateral to orderbook ---
  const allocateAmount = ethers.utils.parseEther("20"); // deposit margin for orders
  const tx2 = await vault.allocateCollateral(allocateAmount, ORDERBOOK_ADDRESS);
  await tx2.wait();
  console.log("Collateral allocated:", allocateAmount.toString());

  // --- STEP 3: Place buy order ---
  const order = {
    price: PRICE,
    quantity: QUANTITY,
    side: 0,       // 0 = BUY
    expiry: EXPIRY,
    orderType: 0   // 0 = Limit
  };

  const tx3 = await orderBook.addOrder(order);
  const receipt = await tx3.wait();

  console.log("✅ Buy order placed at $10");
  console.log("Tx hash:", receipt.transactionHash);
}

// Run script
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
