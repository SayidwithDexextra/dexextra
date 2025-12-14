/* eslint-disable no-console */
// Lists all markets created by FuturesMarketFactory by scanning FuturesMarketCreated events.
// Usage:
//   FUTURES_MARKET_FACTORY_ADDRESS=0x... npx hardhat run scripts/list-markets.js --network hyperliquid
// Optional:
//   FROM_BLOCK=0x... (hex) or number
//   TO_BLOCK=latest (default)

const { ethers } = require("hardhat");

async function main() {
  const factoryAddress = process.env.FUTURES_MARKET_FACTORY_ADDRESS;
  if (!factoryAddress) throw new Error("FUTURES_MARKET_FACTORY_ADDRESS required");

  const provider = (await ethers.getSigners())[0].provider;
  const artifact = require("../artifacts/src/FuturesMarketFactory.sol/FuturesMarketFactory.json");
  const iface = new ethers.Interface(artifact.abi);

  const eventFragment = iface.getEvent("FuturesMarketCreated");
  const topic = eventFragment.topicHash;

  const fromBlockEnv = process.env.FROM_BLOCK;
  const toBlockEnv = process.env.TO_BLOCK || "latest";
  const fromBlock = fromBlockEnv
    ? (fromBlockEnv.startsWith("0x") ? fromBlockEnv : Number(fromBlockEnv))
    : 0;

  console.log("Scanning events...");
  console.log({ factoryAddress, fromBlock, toBlock: toBlockEnv });

  // Pagination to respect provider's 10k block range limit
  const logs = [];
  const latest = toBlockEnv === "latest" ? await provider.getBlockNumber() : Number(toBlockEnv);
  let start = typeof fromBlock === "number" ? fromBlock : 0;
  const end = latest;
  const step = 9_000;
  while (start <= end) {
    const chunkFrom = start;
    const chunkTo = Math.min(start + step, end);
    console.log(`...chunk [${chunkFrom}, ${chunkTo}]`);
    const chunkLogs = await provider.getLogs({
      address: factoryAddress,
      fromBlock: chunkFrom,
      toBlock: chunkTo,
      topics: [topic],
    });
    logs.push(...chunkLogs);
    start = chunkTo + 1;
  }

  console.log(`Found ${logs.length} FuturesMarketCreated event(s):\n`);
  for (const log of logs) {
    const parsed = iface.parseLog(log);
    const orderBook = parsed.args?.orderBook;
    const marketId = parsed.args?.marketId;
    const marketSymbol = parsed.args?.marketSymbol;
    const creator = parsed.args?.creator;
    const creationFee = parsed.args?.creationFee;
    const metricUrl = parsed.args?.metricUrl;
    const settlementDate = parsed.args?.settlementDate;
    const startPrice = parsed.args?.startPrice;
    console.log({
      blockNumber: log.blockNumber,
      txHash: log.transactionHash,
      orderBook,
      marketId,
      marketSymbol,
      creator,
      creationFee: creationFee?.toString?.(),
      metricUrl,
      settlementDate: settlementDate?.toString?.(),
      startPrice: startPrice?.toString?.(),
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

