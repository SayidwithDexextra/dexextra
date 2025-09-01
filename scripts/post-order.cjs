// Create a Node.js script to sign and POST an order to /api/orders
require("dotenv").config({ path: ".env.local" });
const fetch = require("node-fetch");
const { ethers } = require("ethers");

(async () => {
  try {
    const apiBase = process.env.API_BASE || "http://localhost:3000";
    const walletPk = process.env.TEST_TRADER_PK;
    if (!walletPk) throw new Error("TEST_TRADER_PK not set");

    const routerAddress =
      process.env.ORDER_ROUTER_ADDRESS ||
      "0x836AaF8c558F7390d59591248e02435fc9Ea66aD";
    const wallet = new ethers.Wallet(walletPk);

    const metricIdUi = process.env.METRIC_ID_UI || "SILVER_V4";
    const metricIdOnChain =
      process.env.METRIC_ID_ONCHAIN || "SILVER_Relayed_Meridian_2025_85969";

    const orderType = process.env.ORDER_TYPE || "LIMIT";
    const side = process.env.SIDE || "BUY";
    const quantity = process.env.QUANTITY || "1";
    const price = process.env.PRICE || "10.00";
    const timeInForce = process.env.TIF || "GTC";

    const domain = {
      name: "DexextraOrderRouter",
      version: "1",
      chainId: 137,
      verifyingContract: routerAddress,
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

    const provider = new ethers.JsonRpcProvider(
      process.env.RPC_URL || "https://polygon-rpc.com"
    );
    const signer = wallet.connect(provider);

    // Fetch router nonce for this trader
    const routerAbi = [
      "function getNonce(address trader) view returns (uint256)",
    ];
    const router = new ethers.Contract(routerAddress, routerAbi, provider);
    const nonce = (await router.getNonce(wallet.address)).toString();

    const orderStruct = {
      orderId: 0,
      trader: wallet.address,
      metricId: metricIdOnChain,
      orderType: orderType === "MARKET" ? 0 : 1,
      side: side === "BUY" ? 0 : 1,
      quantity: ethers.parseEther(quantity).toString(),
      price: orderType === "MARKET" ? "0" : ethers.parseEther(price).toString(),
      filledQuantity: 0,
      timestamp: 0,
      expiryTime: 0,
      status: 0,
      timeInForce: 0,
      stopPrice: 0,
      icebergQty: 0,
      postOnly: false,
      metadataHash: "0x" + "0".repeat(64),
      nonce: nonce,
    };

    const signature = await signer.signTypedData(domain, types, orderStruct);

    const body = {
      metricId: metricIdUi,
      orderType,
      side,
      quantity,
      price: orderType === "MARKET" ? undefined : price,
      timeInForce,
      postOnly: false,
      reduceOnly: false,
      clientOrderId: "api-test-" + Date.now(),
      signature,
      walletAddress: wallet.address,
      nonce: Number(nonce),
      timestamp: Date.now(),
      metadataHash: orderStruct.metadataHash,
    };

    const res = await fetch(`${apiBase}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const json = await res.json();
    console.log("Status:", res.status);
    console.log("Response:", JSON.stringify(json, null, 2));
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
})();
