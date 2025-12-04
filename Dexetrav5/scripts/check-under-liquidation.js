const { ethers } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  // CLI flags:
  // --vault <address>         CoreVault address (optional; falls back to deployments)
  // --user <address>          Target user (required if env USER_ADDRESS not set)
  // --marketId <bytes32>      Market ID (bytes32). If omitted, use --symbol or defaultMarket
  // --symbol <SYMBOL>         Market symbol to resolve marketId from deployments
  // --file <path>             Deployments JSON (defaults to deployments/hyperliquid-deployment.json)
  //
  // Examples:
  // npx hardhat run scripts/check-under-liquidation.js --network hyperliquid --user 0x... --symbol ALU-USD
  // npx hardhat run scripts/check-under-liquidation.js --network hyperliquid --user 0x... --marketId 0x...
  // CORE_VAULT_ADDRESS=0x... USER_ADDRESS=0x... npx hardhat run scripts/check-under-liquidation.js --network hyperliquid --symbol GOLD-USD

  const args = process.argv.slice(2);
  const getFlag = (name) => {
    const i = args.indexOf(`--${name}`);
    return i !== -1 && i + 1 < args.length ? args[i + 1] : undefined;
  };

  const vaultFlag = getFlag("vault") || process.env.CORE_VAULT_ADDRESS;
  const user = getFlag("user") || process.env.USER_ADDRESS;
  const marketIdFlag = getFlag("marketId") || getFlag("marketid") || process.env.MARKET_ID;
  const symbol = getFlag("symbol");
  const fileOverride = getFlag("file");

  const defaultDeployPath = path.join(__dirname, "../deployments/hyperliquid-deployment.json");
  const deploymentsPath = fileOverride
    ? path.isAbsolute(fileOverride)
      ? fileOverride
      : path.join(__dirname, "..", fileOverride)
    : defaultDeployPath;

  const loadJSON = (p) => {
    try {
      if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch (e) {}
    return null;
  };

  const isAddr = (addr) => {
    try {
      if (ethers.utils && typeof ethers.utils.isAddress === "function") return ethers.utils.isAddress(addr);
      if (typeof ethers.isAddress === "function") return ethers.isAddress(addr);
    } catch (e) {}
    return /^0x[0-9a-fA-F]{40}$/.test(addr);
  };

  const isBytes32 = (v) => typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);

  const deployments = loadJSON(deploymentsPath);

  // Resolve CoreVault address
  let vaultAddress = vaultFlag;
  if (!vaultAddress) {
    if (!deployments?.contracts?.CORE_VAULT) {
      throw new Error(
        `CORE_VAULT not provided and not found in deployments file: ${deploymentsPath}\n` +
          `Provide --vault <address> or set CORE_VAULT_ADDRESS.`
      );
    }
    vaultAddress = deployments.contracts.CORE_VAULT;
  }
  if (!isAddr(vaultAddress)) throw new Error(`Invalid CoreVault address: ${vaultAddress}`);

  // Resolve user
  if (!user || !isAddr(user)) {
    throw new Error(`Provide a valid --user <address> or set USER_ADDRESS env var.`);
  }

  // Resolve marketId
  let marketId = marketIdFlag;
  if (!marketId) {
    if (symbol && deployments?.markets) {
      const found = deployments.markets.find((m) => (m.symbol || "").toLowerCase() === symbol.toLowerCase());
      if (!found?.marketId) throw new Error(`Symbol '${symbol}' not found in ${deploymentsPath}`);
      marketId = found.marketId;
    } else if (deployments?.defaultMarket?.marketId) {
      marketId = deployments.defaultMarket.marketId;
    } else {
      throw new Error(
        `Missing marketId. Provide --marketId <bytes32> or --symbol <SYMBOL>, or ensure defaultMarket.marketId exists in ${deploymentsPath}`
      );
    }
  }
  if (!isBytes32(marketId)) throw new Error(`Invalid marketId (bytes32 expected): ${marketId}`);

  // Bind contracts
  const vault = await ethers.getContractAt("CoreVault", vaultAddress);

  // 1) Direct under-liquidation flag
  const under = await vault.isUnderLiquidationPosition(user, marketId);

  // 2) Fetch current mark, compute liquidatable via static call (no tx)
  let markPrice = 0;
  try {
    markPrice = await vault.getMarkPrice(marketId);
  } catch {}

  let liquidatable;
  try {
    liquidatable = await vault.callStatic.isLiquidatable(user, marketId, markPrice || 0);
  } catch {
    liquidatable = undefined; // Some networks/impl may revert in callStatic
  }

  // 3) Fetch reported liquidation price (returns (0,true) when under control per current impl)
  let liqPrice = 0;
  let hasPosition = false;
  try {
    const res = await vault.getLiquidationPrice(user, marketId);
    liqPrice = res[0];
    hasPosition = res[1];
  } catch {}

  console.log(JSON.stringify({
    network: ethers?.provider?.network?.name || (await ethers.provider.getNetwork()).name,
    vault: vaultAddress,
    user,
    marketId,
    isUnderLiquidation: under,
    hasPosition,
    liquidationPrice: liqPrice?.toString?.() || String(liqPrice),
    markPrice: markPrice?.toString?.() || String(markPrice),
    isLiquidatableAtMark: liquidatable,
  }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });


