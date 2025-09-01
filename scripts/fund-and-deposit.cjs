require("dotenv").config({ path: ".env.local" });
const { ethers } = require("ethers");

async function main() {
  const RPC_URL = process.env.RPC_URL || "https://polygon-rpc.com";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const pk1 = process.env.SETTLEMENT_PRIVATE_KEY;
  const pk2 = process.env.SECOND_PRIVATE_KEY || process.env.TEST_PRIVATE_KEY;
  if (!pk1 || !pk2)
    throw new Error("Missing SETTLEMENT_PRIVATE_KEY or SECOND_PRIVATE_KEY");

  const signer1 = new ethers.Wallet(pk1, provider);
  const signer2 = new ethers.Wallet(pk2, provider);

  const vaultAddr =
    process.env.CENTRAL_VAULT_ADDRESS ||
    "0x602B4B1fe6BBC10096970D4693D94376527D04ab";
  const usdcAddr =
    process.env.MOCK_USDC_ADDRESS ||
    "0x194b4517a61D569aC8DBC47a22ed6F665B77a331";

  const erc20Abi = [
    "function mint(address to, uint256 amount) external",
    "function balanceOf(address) view returns (uint256)",
    "function approve(address,uint256) returns (bool)",
  ];
  const vaultAbi = ["function deposit(address asset, uint256 amount) external"];

  const usdc1 = new ethers.Contract(usdcAddr, erc20Abi, signer1);
  const usdc2 = new ethers.Contract(usdcAddr, erc20Abi, signer2);
  const vault1 = new ethers.Contract(vaultAddr, vaultAbi, signer1);
  const vault2 = new ethers.Contract(vaultAddr, vaultAbi, signer2);

  const amount = ethers.parseUnits(process.env.DEPOSIT_USDC || "1000", 6);

  console.log("Minting to signer1:", signer1.address);
  await (await usdc1.mint(signer1.address, amount)).wait();
  console.log("Approving vault from signer1");
  await (await usdc1.approve(vaultAddr, amount)).wait();
  console.log("Depositing from signer1");
  await (await vault1.deposit(usdcAddr, amount)).wait();

  console.log("Minting to signer2:", signer2.address);
  await (await usdc2.mint(signer2.address, amount)).wait();
  console.log("Approving vault from signer2");
  await (await usdc2.approve(vaultAddr, amount)).wait();
  console.log("Depositing from signer2");
  await (await vault2.deposit(usdcAddr, amount)).wait();

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});





