require("dotenv").config({ path: ".env.local" });
const { ethers } = require("ethers");

async function main() {
  const RPC_URL = process.env.RPC_URL || "https://polygon-rpc.com";
  const provider = new ethers.JsonRpcProvider(RPC_URL);

  const routerAddr =
    process.env.ORDER_ROUTER_ADDRESS ||
    "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";
  const obAddr =
    process.env.OB_SILVER_V4 || "0x0900D4f3C7CF7d8f55709019330cCE110bC76DEf";

  const settlementPk = process.env.SETTLEMENT_PRIVATE_KEY;
  const traderPk =
    process.env.TRADER_PK ||
    process.env.SECOND_PRIVATE_KEY ||
    process.env.TEST_PRIVATE_KEY;
  if (!settlementPk || !traderPk)
    throw new Error(
      "Missing SETTLEMENT_PRIVATE_KEY or TRADER_PK/SECOND_PRIVATE_KEY"
    );

  const relayer = new ethers.Wallet(settlementPk, provider);
  const trader = new ethers.Wallet(traderPk, provider);

  // Read on-chain metricId from the OrderBook
  const obAbi = ["function getMetricId() view returns (string)"];
  const ob = new ethers.Contract(obAddr, obAbi, provider);
  const metricIdOnChain = await ob.getMetricId();

  const routerAbi = [
    "function getNonce(address trader) view returns (uint256)",
    {
      inputs: [
        {
          components: [
            { name: "orderId", type: "uint256" },
            { name: "trader", type: "address" },
            { name: "metricId", type: "string" },
            { name: "orderType", type: "uint8" },
            { name: "side", type: "uint8" },
            { name: "quantity", type: "uint256" },
            { name: "price", type: "uint256" },
            { name: "filledQuantity", type: "uint256" },
            { name: "timestamp", type: "uint256" },
            { name: "expiryTime", type: "uint256" },
            { name: "status", type: "uint8" },
            { name: "timeInForce", type: "uint8" },
            { name: "stopPrice", type: "uint256" },
            { name: "icebergQty", type: "uint256" },
            { name: "postOnly", type: "bool" },
            { name: "metadataHash", type: "bytes32" },
          ],
          name: "order",
          type: "tuple",
        },
        { name: "signature", type: "bytes" },
      ],
      name: "placeOrderWithSig",
      outputs: [{ name: "orderId", type: "uint256" }],
      stateMutability: "nonpayable",
      type: "function",
    },
  ];
  const router = new ethers.Contract(routerAddr, routerAbi, provider);

  // Fetch nonce
  const nonce = await router.getNonce(trader.address);

  const side = (process.env.SIDE || "BUY").toUpperCase();
  const orderTypeStr = (process.env.ORDER_TYPE || "LIMIT").toUpperCase();
  const qty = process.env.QTY || process.env.MARKET_QTY || "1";
  const priceStr = process.env.PRICE || "10.00";

  const orderType = orderTypeStr === "MARKET" ? 0 : 1;
  const sideVal = side === "BUY" ? 0 : 1;

  const order = {
    orderId: 0,
    trader: trader.address,
    metricId: metricIdOnChain,
    orderType: orderType,
    side: sideVal,
    quantity: ethers.parseEther(qty).toString(),
    price: orderType === 0 ? "0" : ethers.parseEther(priceStr).toString(),
    filledQuantity: 0,
    timestamp: 0,
    expiryTime: 0,
    status: 0,
    timeInForce: 0,
    stopPrice: 0,
    icebergQty: 0,
    postOnly: false,
    metadataHash: "0x" + "0".repeat(64),
  };

  // EIP-712 domain and types
  const domain = {
    name: "DexextraOrderRouter",
    version: "1",
    chainId: 137,
    verifyingContract: routerAddr,
  };

  const types = {
    Order: [
      { name: "orderId", type: "uint256" },
      { name: "trader", type: "address" },
      { name: "metricId", type: "string" },
      { name: "orderType", type: "uint8" },
      { name: "side", type: "uint8" },
      { name: "quantity", type: "uint256" },
      { name: "price", type: "uint256" },
      { name: "filledQuantity", type: "uint256" },
      { name: "timestamp", type: "uint256" },
      { name: "expiryTime", type: "uint256" },
      { name: "status", type: "uint8" },
      { name: "timeInForce", type: "uint8" },
      { name: "stopPrice", type: "uint256" },
      { name: "icebergQty", type: "uint256" },
      { name: "postOnly", type: "bool" },
      { name: "metadataHash", type: "bytes32" },
      { name: "nonce", type: "uint256" },
    ],
  };

  const signature = await trader.signTypedData(domain, types, {
    ...order,
    nonce: nonce.toString(),
  });

  const tx = await new ethers.Contract(
    routerAddr,
    routerAbi,
    relayer
  ).placeOrderWithSig(order, signature);
  console.log("🔗 Tx:", tx.hash);
  const rc = await tx.wait();
  console.log("✅ Confirmed block", rc.blockNumber);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
