/**
 * Emit synthetic OrderBook events ON-CHAIN so they can be picked up by Alchemy webhooks.
 *
 * This script intentionally does NOT call Supabase/ClickHouse directly.
 * It submits transactions to the selected market's OrderBook DIAMOND so the log `address`
 * matches `markets.market_address` (and downstream ingest can resolve market_uuid).
 *
 * Usage (interactive):
 *   cd Dexetrav5
 *   npx hardhat run scripts/replay-trade-executions-to-ohlcv.js
 *
 * Network behavior:
 * - This script ALWAYS targets the `hyperliquid` network config from `hardhat.config.js`,
 *   regardless of how Hardhat itself was invoked.
 * - Private key is loaded from `.env.local` via Hardhat config (expects `PRIVATE_KEY_USERD`).
 *
 * Notes:
 * - Prices are uint256 and interpreted by your ingest as 6 decimals by default.
 * - sizeWei is uint256 and interpreted by your ingest as 18 decimals by default.
 */
const hre = require("hardhat");
const readline = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");
const { createClient } = require("@supabase/supabase-js");

function asInt(v, fallback) {
  if (v == null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function asBool(v, fallback) {
  if (v == null) return fallback;
  const s = String(v).toLowerCase().trim();
  if (["1", "true", "yes", "y"].includes(s)) return true;
  if (["0", "false", "no", "n"].includes(s)) return false;
  return fallback;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function ask(rl, prompt, fallback) {
  const suffix = fallback !== undefined ? ` [${fallback}]` : "";
  const ans = (await rl.question(`${prompt}${suffix}: `)).trim();
  return ans.length ? ans : String(fallback ?? "");
}

async function askYesNo(rl, prompt, fallbackBool) {
  const fallback = fallbackBool ? "y" : "n";
  const ans = (await ask(rl, `${prompt} (y/n)`, fallback)).toLowerCase();
  return ["y", "yes", "true", "1"].includes(ans);
}

async function askBigInt(rl, prompt, fallback) {
  while (true) {
    const v = await ask(rl, prompt, fallback);
    try {
      // Allow underscores for readability
      const clean = v.replace(/_/g, "");
      return BigInt(clean);
    } catch {
      // loop
    }
  }
}

async function askDecimalToUnits(rl, prompt, fallback, decimals) {
  while (true) {
    const v = await ask(rl, prompt, fallback);
    try {
      const clean = v.replace(/_/g, "").trim();
      // ethers v6: parseUnits -> bigint
      return hre.ethers.parseUnits(clean, decimals);
    } catch {
      // loop
    }
  }
}

function roundDiv(n, d) {
  // Round to nearest integer: (n + d/2) / d
  if (d === 0n) return 0n;
  return (n + d / 2n) / d;
}

async function askAddress(rl, prompt, fallback) {
  while (true) {
    const v = (await ask(rl, prompt, fallback)).trim();
    if (!v) return "";
    if (v.toLowerCase() === "none") return "";
    try {
      return hre.ethers.getAddress(v);
    } catch {
      // loop
    }
  }
}

function shortAddr(addr) {
  if (!addr || typeof addr !== "string") return String(addr || "");
  if (!addr.startsWith("0x") || addr.length < 10) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function getSupabaseCreds() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) in env (.env.local).");
  if (!key) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY in env (.env.local).");
  return { url, key };
}

function getHyperliquidProviderAndSigner() {
  const cfg = (hre.config && hre.config.networks && hre.config.networks.hyperliquid) || null;
  const url = cfg && cfg.url ? String(cfg.url) : "";
  const chainId = cfg && cfg.chainId ? Number(cfg.chainId) : 999;
  if (!url) {
    throw new Error("Missing Hardhat network config for `hyperliquid` (hardhat.config.js -> networks.hyperliquid.url).");
  }

  const pk = process.env.PRIVATE_KEY_USERD || "";
  if (!pk) {
    throw new Error("Missing PRIVATE_KEY_USERD in env (.env.local). Needed to sign txs on Hyperliquid mainnet.");
  }

  const provider = new hre.ethers.JsonRpcProvider(url, chainId);
  const signer = new hre.ethers.Wallet(pk, provider);
  return { provider, signer, chainId, url };
}

async function fetchActiveDeployedMarkets() {
  const { url, key } = getSupabaseCreds();
  const supabase = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const r = await supabase
    .from("markets")
    .select(
      "id,market_identifier,symbol,category,chain_id,network,market_status,deployment_status,market_address,created_at",
    )
    .eq("is_active", true)
    .eq("deployment_status", "DEPLOYED")
    .not("market_address", "is", null)
    .order("created_at", { ascending: false });

  if (r.error) throw new Error(`Supabase query failed: ${r.error.message}`);
  return r.data || [];
}

async function pickMarketFromSupabaseInteractively(rl, chainIdBigInt) {
  const all = await fetchActiveDeployedMarkets();
  if (!all.length) throw new Error("No deployed active markets found in Supabase (markets.is_active=true & deployment_status=DEPLOYED).");

  let filter = "";
  while (true) {
    if (!filter) {
      filter = (await rl.question('Market filter (press enter for all, or "q" to quit): ')).trim();
      if (filter.toLowerCase() === "q") throw new Error("Aborted.");
    }

    const markets = filter
      ? all.filter((m) => {
          const hay = `${m.market_identifier || ""} ${m.symbol || ""} ${m.category || ""} ${m.network || ""} ${m.market_status || ""}`
            .toLowerCase();
          return hay.includes(filter.toLowerCase());
        })
      : all;

    if (!markets.length) {
      console.log("No matches.\n");
      filter = "";
      continue;
    }

    const maxShow = 40;
    console.log(`\nShowing ${Math.min(maxShow, markets.length)} / ${markets.length} markets:`);
    markets.slice(0, maxShow).forEach((m, i) => {
      const label = m.market_identifier || m.symbol || m.id;
      const ob = m.market_address || "-";
      console.log(
        `[${i}] ${label} | status=${m.market_status ?? "?"}/${m.deployment_status ?? "?"} | chain=${m.chain_id ?? "?"} ${m.network ?? ""} | OB=${shortAddr(ob)}`,
      );
    });
    if (markets.length > maxShow) console.log(`... (${markets.length - maxShow} more hidden; refine your filter)\n`);
    else console.log("");

    const rawIdx = (await rl.question('Select index (or "r" to refilter, "q" to quit): ')).trim();
    if (rawIdx.toLowerCase() === "q") throw new Error("Aborted.");
    if (rawIdx.toLowerCase() === "r") {
      filter = "";
      continue;
    }
    const idx = Number(rawIdx);
    if (!Number.isInteger(idx) || idx < 0 || idx >= Math.min(maxShow, markets.length)) {
      console.log("Invalid selection.\n");
      continue;
    }

    const picked = markets[idx];
    const ob = picked.market_address;
    if (!ob) {
      console.log("Selected row has no `market_address`.\n");
      filter = "";
      continue;
    }

    let obAddr = "";
    try {
      obAddr = hre.ethers.getAddress(String(ob));
    } catch {
      console.log("Selected row has invalid `market_address`.\n");
      filter = "";
      continue;
    }

    if (picked.chain_id != null && chainIdBigInt != null && BigInt(picked.chain_id) !== chainIdBigInt) {
      console.log(
        `⚠️ ChainId mismatch: Supabase says ${picked.chain_id}, RPC says ${chainIdBigInt.toString()}. If you continue, reads/txs may fail.\n`,
      );
      const cont = await askYesNo(rl, "Continue with this market anyway?", false);
      if (!cont) {
        filter = "";
        continue;
      }
    }

    return { market: picked, orderBookDiamond: obAddr };
  }
}

async function readMarkPriceFromOrderBookDiamond(orderBookDiamond, provider) {
  // Minimal ABI for OBPricingFacet functions (called through the diamond)
  const abi = [
    "function getMarketPriceData() view returns (uint256 midPrice,uint256 bestBidPrice,uint256 bestAskPrice,uint256 lastTradePriceReturn,uint256 markPrice,uint256 spread,uint256 spreadBps,bool isValid)",
    "function calculateMarkPrice() view returns (uint256)",
  ];
  const c = new hre.ethers.Contract(orderBookDiamond, abi, provider);
  try {
    const res = await c.getMarketPriceData();
    // ethers v6 returns a Result which is array-like with named props
    return {
      markPrice: res.markPrice ?? res[4],
      bestBid: res.bestBidPrice ?? res[1],
      bestAsk: res.bestAskPrice ?? res[2],
      isValid: res.isValid ?? res[7],
    };
  } catch {
    const mp = await c.calculateMarkPrice();
    return { markPrice: mp, bestBid: 0n, bestAsk: 0n, isValid: true };
  }
}

async function main() {
  const rl = readline.createInterface({ input, output });
  rl.on("SIGINT", () => {
    rl.close();
    process.exit(130);
  });

  // Ensure artifacts exist.
  try {
    await hre.run("compile");
  } catch {
    // ignore
  }

  const { provider, signer, chainId, url } = getHyperliquidProviderAndSigner();
  const net = await provider.getNetwork();
  console.log("\nTarget network: hyperliquid");
  console.log("RPC:", url);
  console.log("chainId:", net.chainId.toString(), `(expected ${chainId})`);
  console.log("signer:", signer.address);

  console.log("\nEnter parameters (press Enter to accept defaults).");
  console.log("\nPicking an active market from Supabase…");
  const picked = await pickMarketFromSupabaseInteractively(rl, BigInt(net.chainId));
  const orderBookDiamond = picked.orderBookDiamond;
  console.log(
    `Picked market: ${picked.market.market_identifier || picked.market.symbol || picked.market.id} | OB=${orderBookDiamond}`,
  );

  const count = asInt(await ask(rl, "How many iterations?", "60"), 60);
  // Normalize user I/O to whole-number units.
  // Internally we keep on-chain scaling compatible with your pipeline:
  // - price is uint256 with 6 decimals (1 unit => 1_000_000 raw)
  // - size is uint256 with 18 decimals (1 unit => 1e18 raw)
  const PRICE_DECIMALS = 6;
  const PRICE_SCALE = 10n ** 6n;
  const SIZE_SCALE = 10n ** 18n;

  const mark = await readMarkPriceFromOrderBookDiamond(orderBookDiamond, provider);
  const markRaw = BigInt(mark.markPrice);
  const markUnits = roundDiv(markRaw, PRICE_SCALE);
  const bestBidUnits = roundDiv(BigInt(mark.bestBid || 0n), PRICE_SCALE);
  const bestAskUnits = roundDiv(BigInt(mark.bestAsk || 0n), PRICE_SCALE);

  console.log("\nDetected prices from diamond (rounded to whole units):");
  console.log("  bestBid:", bestBidUnits.toString());
  console.log("  bestAsk:", bestAskUnits.toString());
  console.log("  markPrice:", markUnits.toString());

  // Start price is derived from mark price and NOT user-selectable.
  const startPriceUnits = markUnits;
  const startPrice = startPriceUnits * PRICE_SCALE;

  const priceStepUnits = await askBigInt(rl, "Price step per iteration (whole units, e.g. 1)", "0");
  const priceStep = priceStepUnits * PRICE_SCALE;

  const sizeUnits = await askBigInt(rl, "Trade size per execution (whole units, e.g. 1)", "1");
  const sizeWei = sizeUnits * SIZE_SCALE;
  const sleepMs = asInt(await ask(rl, "Sleep between iterations (ms)", "0"), 0);

  const buyerAddr = await askAddress(rl, "Buyer address (or 'none' to use default)", "none");
  const sellerAddr = await askAddress(rl, "Seller address (or 'none' to use default)", "none");

  const buyer = buyerAddr || signer.address;
  const seller = sellerAddr || signer.address;

  console.log("\nSummary:");
  console.log("  iterations:", count);
  console.log("  market:", picked.market.market_identifier || picked.market.symbol || picked.market.id);
  console.log("  orderBook:", orderBookDiamond);
  console.log("  startPrice (from mark, whole units):", startPriceUnits.toString());
  console.log("  priceStep (whole units):", priceStepUnits.toString());
  console.log("  tradeSize (whole units):", sizeUnits.toString());
  console.log("  sleepMs:", sleepMs);
  console.log("  buyer:", buyer);
  console.log("  seller:", seller);
  console.log("  emitFrom:", orderBookDiamond, "(OrderBook diamond)");

  const proceed = await askYesNo(rl, "Proceed and send transactions?", true);
  rl.close();
  if (!proceed) {
    console.log("Cancelled.");
    return;
  }

  // Call the real OrderBook diamond so the emitted log address matches the Supabase market_address.
  // This is the key to avoiding "no resolved trades to insert" in ohlcv-ingest.
  const obAbi = [
    "function obExecuteTrade(address buyer,address seller,uint256 price,uint256 amount,bool buyerMargin,bool sellerMargin) external",
  ];
  const orderBook = new hre.ethers.Contract(orderBookDiamond, obAbi, signer);
  console.log("OrderBookDiamond (tx target):", orderBookDiamond);

  for (let i = 0; i < count; i++) {
    const price = startPrice + BigInt(i) * priceStep;
    // Emit TradeExecutionCompleted (and related pricing/trade events) from the diamond itself.
    // We use margin=true for both sides to match the futures market flow.
    const tx = await orderBook.obExecuteTrade(buyer, seller, price, sizeWei, true, true);
    await tx.wait();

    if (sleepMs > 0) await sleep(sleepMs);
    if ((i + 1) % 10 === 0 || i === count - 1) {
      console.log(`progress: ${i + 1}/${count}`);
    }
  }

  console.log("done. emitted", count, "iteration(s)");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

