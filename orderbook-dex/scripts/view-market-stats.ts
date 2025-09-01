import hre from "hardhat";
const { network } = hre as any;
const ethers = (hre as any).ethers as any;
import * as fs from "fs";
import * as path from "path";

function format18(value: bigint): string {
  return ethers.formatUnits(value, 18);
}

function parseArgs() {
  let address = "";
  let metric = "";
  // env support
  if (process.env.ADDRESS && ethers.isAddress(process.env.ADDRESS)) address = process.env.ADDRESS;
  if (process.env.METRIC) metric = process.env.METRIC;
  for (let i = 0; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === "--address" && process.argv[i + 1]) address = process.argv[i + 1];
    if (a === "--metric" && process.argv[i + 1]) metric = process.argv[i + 1];
    if (!address && /^0x[0-9a-fA-F]{40}$/.test(a)) address = a; // allow positional
  }
  return { address, metric };
}

async function resolveMarketAddress(metricId?: string, providedAddress?: string): Promise<string> {
  if (providedAddress && ethers.isAddress(providedAddress)) return providedAddress;
  if (!metricId) metricId = "SILVER_V2"; // sensible default

  const deploymentsPath = path.resolve(__dirname, "../deployments/polygon-deployment-current.json");
  const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
  const routerAddr = deployments.contracts.orderRouter as string;
  if (!routerAddr) throw new Error("Missing orderRouter in deployments file");

  const router = await ethers.getContractAt("OrderRouter", routerAddr);
  const marketAddress: string = await router.getMarketOrderBook(metricId);
  if (!marketAddress || marketAddress === ethers.ZeroAddress) {
    throw new Error(`No market found for metricId: ${metricId}`);
  }
  return marketAddress;
}

async function main() {
  const { address, metric } = parseArgs();
  const marketAddress = await resolveMarketAddress(metric || undefined, address || undefined);

  const orderBook = await ethers.getContractAt("OrderBook", marketAddress);

  // Fetch core stats (resilient to contract reverts) with explicit typing
  const bestBid: bigint = await orderBook.getBestBid().catch(() => 0n);
  const bestAsk: bigint = await orderBook.getBestAsk().catch(() => 0n);
  const marketStats: any = await orderBook.getMarketStats().catch(() => null as any);
  const orderCountBuy: bigint = await orderBook.getOrderCount(0).catch(() => 0n);
  const orderCountSell: bigint = await orderBook.getOrderCount(1).catch(() => 0n);
  const settlementStats: readonly bigint[] = await orderBook.getSettlementStats().catch(() => [0n, 0n, 0n, 0n] as unknown as readonly bigint[]);
  const openInterest: readonly bigint[] = await orderBook.getOpenInterest().catch(() => [0n, 0n] as unknown as readonly bigint[]);

  let lastPrice: bigint = 0n;
  let volume24h: bigint = 0n;
  let high24h: bigint = 0n;
  let low24h: bigint = 0n;
  let totalTrades: bigint = 0n;
  let spreadContract: bigint = 0n;

  if (marketStats) {
    lastPrice = marketStats[0] as bigint;
    volume24h = marketStats[1] as bigint;
    high24h = marketStats[2] as bigint;
    low24h = marketStats[3] as bigint;
    totalTrades = marketStats[5] as bigint;
    spreadContract = marketStats[8] as bigint;
  }

  // Derived values
  const hasBook = bestBid > 0n && bestAsk > 0n;
  const midPrice = hasBook ? (bestBid + bestAsk) / 2n : 0n;
  const spreadAbs = hasBook ? (bestAsk - bestBid) : 0n;
  const spreadBps = hasBook && midPrice > 0n ? Number((spreadAbs * 10000n) / midPrice) : 0;

  const totalPositions: bigint = settlementStats[0];
  const longInterest: bigint = openInterest[0];
  const shortInterest: bigint = openInterest[1];

  console.log("\n================= Market Snapshot =================");
  console.log(`Network: ${network.name}`);
  console.log(`OrderBook: ${marketAddress}`);
  if (metric) console.log(`Metric ID: ${metric}`);

  console.log("\nPrices (18-decimals)");
  const effectiveLast = lastPrice > 0n ? lastPrice : (hasBook ? midPrice : 0n);
  console.log(`- Last Price: ${format18(effectiveLast)}`);
  
  console.log(`- Best Bid  : ${format18(bestBid)}`);
  console.log(`- Best Ask  : ${format18(bestAsk)}`);
  console.log(`- Mid Price : ${format18(midPrice)}`);
  console.log(`- Spread    : ${format18(spreadAbs)} (${spreadBps} bps)`);

  console.log("\n24h Stats");
  console.log(`- Volume    : ${format18(volume24h)}`);
  console.log(`- High      : ${format18(high24h)}`);
  console.log(`- Low       : ${format18(low24h)}`);
  console.log(`- Trades    : ${totalTrades.toString()}`);

  console.log("\nOrder Book");
  console.log(`- Open BUY orders : ${orderCountBuy.toString()}`);
  console.log(`- Open SELL orders: ${orderCountSell.toString()}`);

  console.log("\nPositions");
  console.log(`- Total positions : ${totalPositions.toString()}`);
  console.log(`- Long interest   : ${format18(longInterest)}`);
  console.log(`- Short interest  : ${format18(shortInterest)}`);

  console.log("\n(Contract-reported spread value):", format18(spreadContract));
  console.log("===================================================\n");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});


