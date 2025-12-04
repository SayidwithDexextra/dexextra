const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // Simple CLI flags:
  // --orderbook <address>      Direct OB address
  // --symbol <SYMBOL>          Lookup OB address by market symbol in deployments JSON
  // --file <path>              Override deployments file (defaults to hyperliquid-deployment.json)
  //
  // Examples:
  // npx hardhat run scripts/poke-liquidations.js --network hyperliquid --orderbook 0x...
  // npx hardhat run scripts/poke-liquidations.js --network hyperliquid --symbol ALU-USD
  // npx hardhat run scripts/poke-liquidations.js --network localhost --file deployments/localhost-deployment.json --symbol GOLD-USD

  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
    return undefined;
  };

  const suppliedOrderBook = getFlag("orderbook") || process.env.ORDERBOOK_ADDRESS;
  const symbol = getFlag("symbol");
  const fileOverride = getFlag("file");

  const defaultDeployPath = path.join(__dirname, "../deployments/hyperliquid-deployment.json");
  const deploymentsPath = fileOverride
    ? path.isAbsolute(fileOverride)
      ? fileOverride
      : path.join(__dirname, "..", fileOverride)
    : defaultDeployPath;

  const loadDeployments = (p) => {
    try {
      if (fs.existsSync(p)) {
        return JSON.parse(fs.readFileSync(p, "utf8"));
      }
    } catch (e) {}
    return null;
  };

  let orderBook;
  if (suppliedOrderBook) {
    orderBook = suppliedOrderBook;
  } else {
    const deployment = loadDeployments(deploymentsPath);
    if (!deployment) {
      throw new Error(
        `No orderbook provided and deployments file not found at: ${deploymentsPath}\n` +
          `Provide --orderbook <address> or a valid --file with markets/defaultMarket.`
      );
    }
    if (symbol) {
      const markets = Array.isArray(deployment.markets) ? deployment.markets : [];
      const found = markets.find((m) => (m.symbol || "").toLowerCase() === symbol.toLowerCase());
      if (!found || !found.orderBook) {
        throw new Error(`Symbol '${symbol}' not found in ${deploymentsPath}`);
      }
      orderBook = found.orderBook;
    } else if (deployment.defaultMarket?.orderBook) {
      orderBook = deployment.defaultMarket.orderBook;
    } else if (deployment.contracts?.ORDERBOOK) {
      orderBook = deployment.contracts.ORDERBOOK;
    } else {
      throw new Error(
        `Could not resolve orderbook from deployments. Specify --orderbook or --symbol.\nFile: ${deploymentsPath}`
      );
    }
  }

  const isAddr = (addr) => {
    try {
      if (ethers.utils && typeof ethers.utils.isAddress === "function") return ethers.utils.isAddress(addr);
      if (typeof ethers.isAddress === "function") return ethers.isAddress(addr);
    } catch (e) {}
    return /^0x[0-9a-fA-F]{40}$/.test(addr);
  };

  if (!isAddr(orderBook)) {
    throw new Error(`Invalid orderbook address: ${orderBook}`);
  }

  const obLiq = await ethers.getContractAt("OBLiquidationFacet", orderBook);
  const tx = await obLiq.pokeLiquidations();
  const receipt = await tx.wait();
  console.log(
    `pokeLiquidations sent to ${orderBook} on '${hre.network.name}' → tx: ${receipt?.hash}`
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
