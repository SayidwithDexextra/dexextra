import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  const routerAddr = process.env.ORDER_ROUTER_ADDRESS || "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";
  const vaultAddr = process.env.CENTRAL_VAULT_ADDRESS || "0x602B4B1fe6BBC10096970D4693D94376527D04ab";
  const mockUSDC = process.env.MOCK_USDC_ADDRESS || "0x194b4517a61D569aC8DBC47a22ed6F665B77a331";
  const obV4 = process.env.OB_SILVER_V4 || "0x0900D4f3C7CF7d8f55709019330cCE110bC76DEf"; // Meridian
  const v4MetricIdOnChain = process.env.METRIC_ID_SILVER_V4 || "SILVER_Relayed_Meridian_2025_85969";
  const obV3 = process.env.OB_SILVER_V3 || "0xc0A3126CA127f569fd8D607540b3B903716E2e08"; // Aurora

  console.log("👤 Deployer:", deployer.address);

  const Router = await ethers.getContractFactory("OrderRouter");
  const Vault = await ethers.getContractFactory("CentralVault");
  const ERC20 = await ethers.getContractFactory("MockUSDC");

  const router = Router.attach(routerAddr);
  const vault = Vault.attach(vaultAddr);
  const usdc = ERC20.attach(mockUSDC);

  // 1) Authorize orderbooks in vault
  console.log("🔑 Authorizing order books in CentralVault...");
  await (await vault.setMarketAuthorization(obV3, true)).wait();
  await (await vault.setMarketAuthorization(obV4, true)).wait();
  console.log("✅ Authorized OBs in vault");

  // 2) Register new metric aliases on router
  console.log("🧭 Registering metric aliases on router (idempotent)...");
  try { await (await router.registerMarket("SILVER_V3", obV3)).wait(); } catch { console.log("ℹ️ SILVER_V3 already registered"); }
  try { await (await router.registerMarket("SILVER_V4", obV4)).wait(); } catch { console.log("ℹ️ SILVER_V4 already registered"); }
  console.log("✅ Router markets ensured");

  // 3) Fund deployer with USDC and deposit into vault
  console.log("💰 Minting and depositing USDC...");
  const mintAmount = 100_000n * 10n ** 6n; // 100,000 USDC
  await (await usdc.mint(deployer.address, mintAmount)).wait();
  // Approve max
  const maxUint = (1n<<255n) - 1n; // large allowance
  await (await usdc.approve(vaultAddr, maxUint)).wait();
  const allowance: bigint = await (usdc as any).allowance(deployer.address, vaultAddr);
  const balance: bigint = await (usdc as any).balanceOf(deployer.address);
  console.log("🔎 USDC allowance:", allowance.toString());
  console.log("🔎 USDC balance:", balance.toString());
  // Check primary collateral
  const [token, isErc20] = await (vault as any).getPrimaryCollateralToken();
  console.log("🔎 Vault primary collateral:", token, "ERC20:", isErc20);
  if (token.toLowerCase() !== mockUSDC.toLowerCase()) {
    console.log("⚠️ Primary collateral differs from MockUSDC; deposit may not satisfy collateral checks.");
  }
  // Deposit 1,000 USDC
  await (await vault.deposit(mockUSDC, 1_000n * 10n ** 6n)).wait();
  console.log("✅ Deployer deposited 1,000 USDC");

  // 4) Place a test LIMIT BUY via relayed signature for SILVER_V4
  console.log("📝 Placing relayed LIMIT BUY on SILVER_V4...");
  const nonce: bigint = await router.getNonce(deployer.address);
  const order = {
    orderId: 0n,
    trader: deployer.address,
    metricId: v4MetricIdOnChain,
    orderType: 1, // LIMIT
    side: 0, // BUY
    quantity: ethers.parseEther("1.0"),
    price: ethers.parseEther("10.00"),
    filledQuantity: 0n,
    timestamp: 0n,
    expiryTime: 0n,
    status: 0, // PENDING
    timeInForce: 0, // GTC
    stopPrice: 0n,
    icebergQty: 0n,
    postOnly: false,
    metadataHash: ethers.zeroPadValue(ethers.hexlify(ethers.toUtf8Bytes("TEST_V4_ORDER")), 32),
  } as const;

  // EIP-712 signature using hardhat signer
  const domain = {
    name: "DexextraOrderRouter",
    version: "1",
    chainId: 137,
    verifyingContract: routerAddr,
  };
  const types = {
    Order: [
      { name: 'orderId', type: 'uint256' },
      { name: 'trader', type: 'address' },
      { name: 'metricId', type: 'string' },
      { name: 'orderType', type: 'uint8' },
      { name: 'side', type: 'uint8' },
      { name: 'quantity', type: 'uint256' },
      { name: 'price', type: 'uint256' },
      { name: 'filledQuantity', type: 'uint256' },
      { name: 'timestamp', type: 'uint256' },
      { name: 'expiryTime', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'timeInForce', type: 'uint8' },
      { name: 'stopPrice', type: 'uint256' },
      { name: 'icebergQty', type: 'uint256' },
      { name: 'postOnly', type: 'bool' },
      { name: 'metadataHash', type: 'bytes32' },
      { name: 'nonce', type: 'uint256' },
    ],
  } as const;

  const value: any = { ...order, nonce };
  let signature: string;
  if (typeof (deployer as any).signTypedData === 'function') {
    signature = await (deployer as any).signTypedData(domain as any, types as any, value);
  } else {
    signature = await (deployer as any)._signTypedData(domain, types as any, value);
  }
  const tx = await router.placeOrderWithSig(order as any, signature as any);
  console.log("🔗 Tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ Confirmed in block", rc?.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


