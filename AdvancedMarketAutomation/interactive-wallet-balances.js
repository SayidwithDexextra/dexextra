#!/usr/bin/env node
/**
 * Interactive wallet balance viewer
 *
 * - Reads wallets from AdvancedMarketAutomation/wallets.csv (nickname,address,privateKey)
 * - Shows Arbitrum ETH balance + CoreVault collateral breakdown per wallet
 * - Interactive CLI (no output files)
 *
 * CommonJS .js wrapper that uses dynamic import() for ethers (v6 is ESM-first).
 *
 * Required env (recommended):
 *   ARBITRUM_RPC_URL=...
 *   CORE_VAULT_ADDRESS=...
 *
 * Optional env fallbacks:
 *   SPOKE_ARBITRUM_VAULT_ADDRESS=...
 */

const fs = require("node:fs");
const path = require("node:path");
const readlinePromises = require("node:readline/promises");
const { stdin: input, stdout: output } = require("node:process");

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function colorText(text, color) {
  return `${color}${text}${colors.reset}`;
}

function padRight(s, n) {
  return String(s).padEnd(n);
}

function shortAddr(addr) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function parseArgs(argv) {
  const args = {
    csv: "AdvancedMarketAutomation/wallets.csv",
    pageSize: 10,
    once: false,
    concurrency: 8,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--csv" && argv[i + 1]) args.csv = argv[++i];
    else if (a === "--page" && argv[i + 1]) args.pageSize = Number(argv[++i]);
    else if (a === "--once") args.once = true;
    else if (a === "--concurrency" && argv[i + 1]) args.concurrency = Number(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log(
        [
          "Interactive wallet balance viewer (ETH + CoreVault)",
          "",
          "Usage:",
          "  node AdvancedMarketAutomation/interactive-wallet-balances.js",
          "",
          "Options:",
          "  --csv <path>          CSV path (default AdvancedMarketAutomation/wallets.csv)",
          "  --page <n>            Page size (default 10)",
          "  --concurrency <n>     RPC concurrency (default 8)",
          "  --once                Print one screen then exit (non-interactive)",
          "",
          "Env:",
          "  ARBITRUM_RPC_URL",
          "  CORE_VAULT_ADDRESS (fallback: SPOKE_ARBITRUM_VAULT_ADDRESS)",
        ].join("\n")
      );
      process.exit(0);
    }
  }

  if (!Number.isInteger(args.pageSize) || args.pageSize <= 0) {
    throw new Error(`--page must be a positive integer. Got: ${args.pageSize}`);
  }
  if (!Number.isInteger(args.concurrency) || args.concurrency <= 0) {
    throw new Error(`--concurrency must be a positive integer. Got: ${args.concurrency}`);
  }

  return args;
}

function parseWalletCsv(csvText) {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const header = lines[0].toLowerCase();
  const hasHeader = header.includes("nickname") && header.includes("address");
  const start = hasHeader ? 1 : 0;

  const wallets = [];
  for (let i = start; i < lines.length; i++) {
    const parts = lines[i].split(",");
    const nickname = (parts[0] ?? "").trim();
    const address = (parts[1] ?? "").trim();
    // privateKey intentionally ignored for safety
    if (!address || !address.startsWith("0x") || address.length < 10) continue;
    wallets.push({ nickname, address });
  }
  return wallets;
}

async function withConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;

  async function worker() {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(limit, items.length); i++) workers.push(worker());
  await Promise.all(workers);
  return results;
}

const CORE_VAULT_ABI = [
  "function getCollateralBreakdown(address user) view returns (uint256 depositedCollateral,uint256 crossChainCredit,uint256 withdrawableCollateral,uint256 availableForTrading)",
  "function getUnifiedMarginSummary(address user) view returns (uint256 totalCollateral,uint256 marginUsedInPositions,uint256 marginReservedForOrders,uint256 availableMargin,int256 realizedPnL,int256 unrealizedPnL,uint256 totalMarginCommitted,bool isMarginHealthy)",
  "function getMarginUtilization(address user) view returns (uint256 utilizationBps)",
  // Fallback reads (in case the deployed vault doesn't support getCollateralBreakdown)
  "function userCollateral(address) view returns (uint256)",
  "function userCrossChainCredit(address) view returns (uint256)",
  "function getAvailableCollateral(address user) view returns (uint256)",
];

function clearScreen() {
  output.write("\x1b[2J\x1b[H");
}

function headerLine(title, right = "") {
  const width = Math.max(80, (process.stdout.columns || 100) - 2);
  const left = ` ${title} `;
  const r = right ? ` ${right} ` : "";
  const fill = Math.max(1, width - left.length - r.length);
  return colorText(left + "─".repeat(fill) + r, colors.dim);
}

async function main() {
  // Load environment variables, preferring .env.local (same pattern as Dexetrav5 scripts)
  const loadedEnvFiles = [];
  try {
    const dotenv = await import("dotenv");
    const candidates = [
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "..", ".env.local"),
      path.resolve(process.cwd(), "..", ".env"),
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        // Force .env.local values to win over any inherited shell env (prevents empty vars masking real values)
        dotenv.config({ path: p, override: true });
        loadedEnvFiles.push(p);
        break;
      }
    }
  } catch {
    // dotenv not available / not needed
  }

  // Fallback: some .env formats (or sandboxed environments) may result in dotenv loading 0 vars.
  // If ARBITRUM_RPC_URL / CORE_VAULT_ADDRESS are missing, try to read them directly from the env file.
  function readEnvVarFromFile(varName, filePath) {
    try {
      const txt = fs.readFileSync(filePath, "utf8");
      const re = new RegExp(`^\\s*${varName}\\s*=\\s*(.*)\\s*$`, "m");
      const m = txt.match(re);
      if (!m) return "";
      let v = String(m[1] ?? "").trim();
      // Strip surrounding quotes
      if (
        (v.startsWith('"') && v.endsWith('"')) ||
        (v.startsWith("'") && v.endsWith("'"))
      ) {
        v = v.slice(1, -1);
      }
      return v.trim();
    } catch {
      return "";
    }
  }

  if (!process.env.ARBITRUM_RPC_URL || process.env.ARBITRUM_RPC_URL.trim() === "") {
    const candidates = [
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "..", ".env.local"),
      path.resolve(process.cwd(), "..", ".env"),
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const v = readEnvVarFromFile("ARBITRUM_RPC_URL", p);
      if (v) {
        process.env.ARBITRUM_RPC_URL = v;
        break;
      }
    }
  }

  if (!process.env.CORE_VAULT_ADDRESS || process.env.CORE_VAULT_ADDRESS.trim() === "") {
    const candidates = [
      path.resolve(process.cwd(), ".env.local"),
      path.resolve(process.cwd(), ".env"),
      path.resolve(process.cwd(), "..", ".env.local"),
      path.resolve(process.cwd(), "..", ".env"),
    ];
    for (const p of candidates) {
      if (!fs.existsSync(p)) continue;
      const v = readEnvVarFromFile("CORE_VAULT_ADDRESS", p);
      if (v) {
        process.env.CORE_VAULT_ADDRESS = v;
        break;
      }
    }
  }

  const { JsonRpcProvider, Contract, formatEther, formatUnits } = await import("ethers");

  const args = parseArgs(process.argv.slice(2));

  const arbitrumRpcUrl =
    process.env.ARBITRUM_RPC_URL ||
    process.env.RPC_URL_ARBITRUM ||
    process.env.ARB_RPC_URL ||
    "";
  if (!arbitrumRpcUrl) {
    console.error(
      colorText(
        "Missing ARBITRUM_RPC_URL. Set it in your shell or .env.local before running.",
        colors.red
      )
    );
    process.exit(1);
  }

  const vaultAddress = process.env.CORE_VAULT_ADDRESS || "";
  if (!vaultAddress) {
    console.error(
      colorText(
        "Missing CORE_VAULT_ADDRESS. Set it before running.",
        colors.red
      )
    );
    process.exit(1);
  }

  // CoreVault typically lives on the "hub" chain (Hyperliquid / HyperEVM), not Arbitrum.
  // Use a second RPC for CoreVault reads.
  const coreVaultRpcUrl =
    process.env.CORE_VAULT_RPC_URL ||
    process.env.RPC_URL_HYPEREVM ||
    process.env.RPC_URL ||
    "";
  if (!coreVaultRpcUrl) {
    console.error(
      colorText(
        "Missing CORE_VAULT_RPC_URL (or RPC_URL / RPC_URL_HYPEREVM). Needed to read CoreVault balances.",
        colors.red
      )
    );
    process.exit(1);
  }

  const csvPath = path.resolve(process.cwd(), args.csv);
  if (!fs.existsSync(csvPath)) {
    console.error(colorText(`CSV not found: ${csvPath}`, colors.red));
    process.exit(1);
  }

  const wallets = parseWalletCsv(fs.readFileSync(csvPath, "utf8"));
  if (wallets.length === 0) {
    console.error(colorText(`No wallets parsed from: ${csvPath}`, colors.red));
    process.exit(1);
  }

  const arbProvider = new JsonRpcProvider(arbitrumRpcUrl);
  const coreProvider = new JsonRpcProvider(coreVaultRpcUrl);

  const [arbNet, coreNet] = await Promise.all([
    arbProvider.getNetwork(),
    coreProvider.getNetwork(),
  ]);

  const arbHint =
    arbNet.chainId === 42161n
      ? colorText("Arbitrum One", colors.green)
      : colorText(`Arb chainId=${arbNet.chainId}`, colors.yellow);

  const coreHint = colorText(`Core chainId=${coreNet.chainId}`, colors.magenta);

  // Ensure CORE_VAULT_ADDRESS is actually a deployed contract on the core RPC
  const coreCode = await coreProvider.getCode(vaultAddress);
  if (!coreCode || coreCode === "0x") {
    console.error(
      colorText(
        `CORE_VAULT_ADDRESS is not a contract on CORE_VAULT_RPC_URL/RPC_URL (address=${vaultAddress}). Are you pointing at the correct hub RPC?`,
        colors.red
      )
    );
    process.exit(1);
  }

  const vault = new Contract(vaultAddress, CORE_VAULT_ABI, coreProvider);

  function fmtUsdc6(value) {
    try {
      return Number(formatUnits(value ?? 0n, 6)).toFixed(2);
    } catch {
      return "0.00";
    }
  }

  function fmtEth(valueWei) {
    try {
      return Number(formatEther(valueWei ?? 0n)).toFixed(5);
    } catch {
      return "0.00000";
    }
  }

  let page = 0;
  const rl = readlinePromises.createInterface({ input, output });

  async function fetchRow(w) {
    const ethWei = await arbProvider.getBalance(w.address);

    let deposited = 0n;
    let credit = 0n;
    let withdrawable = 0n;
    let available = 0n;
    let vaultOk = true;

    try {
      const breakdown = await vault.getCollateralBreakdown(w.address);
      deposited = breakdown.depositedCollateral ?? breakdown[0];
      credit = breakdown.crossChainCredit ?? breakdown[1];
      withdrawable = breakdown.withdrawableCollateral ?? breakdown[2];
      available = breakdown.availableForTrading ?? breakdown[3];
    } catch {
      // Fallback: try minimal reads that exist on CoreVault
      try {
        const [uc, xcc, avail] = await Promise.all([
          vault.userCollateral(w.address),
          vault.userCrossChainCredit(w.address),
          vault.getAvailableCollateral(w.address),
        ]);
        deposited = uc ?? 0n;
        credit = xcc ?? 0n;
        available = avail ?? 0n;
        withdrawable = 0n;
      } catch {
        vaultOk = false;
      }
    }

    return {
      nickname: w.nickname,
      address: w.address,
      ethWei,
      deposited,
      credit,
      withdrawable,
      available,
      vaultOk,
    };
  }

  async function renderOnce() {
    const start = page * args.pageSize;
    const end = Math.min(wallets.length, start + args.pageSize);
    const slice = wallets.slice(start, end);

    const rows = await withConcurrency(slice, args.concurrency, fetchRow);

    clearScreen();
    console.log(headerLine("Advanced Market Automation • Wallet Balances", `${arbHint} | ${coreHint}`));
    console.log(
      colorText(
        `CoreVault: ${vaultAddress}  |  CSV: ${path.relative(process.cwd(), csvPath)}  |  Wallets: ${wallets.length}`,
        colors.dim
      )
    );
    console.log("");
    console.log(
      colorText(
        [
          padRight("#", 4),
          padRight("Nickname", 12),
          padRight("Address", 14),
          padRight("ETH(ARB)", 12),
          padRight("VaultDeposited(USDC)", 20),
          padRight("VaultAvail(USDC)", 16),
          padRight("XChainCredit", 14),
        ].join(" "),
        colors.bright
      )
    );

    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const globalIndex = start + i;
      const eth = fmtEth(r.ethWei);
      const dep = fmtUsdc6(r.deposited);
      const avail = fmtUsdc6(r.available);
      const credit = fmtUsdc6(r.credit);
      const vaultStatus = r.vaultOk ? "" : colorText(" (vault err)", colors.yellow);

      console.log(
        [
          padRight(String(globalIndex + 1), 4),
          padRight(r.nickname || `User${globalIndex + 1}`, 12),
          padRight(shortAddr(r.address), 14),
          padRight(eth, 12),
          padRight(dep + vaultStatus, 20),
          padRight(avail, 16),
          padRight(credit, 14),
        ].join(" ")
      );
    }

    console.log("");
    console.log(
      colorText(
        `Page ${page + 1}/${Math.ceil(wallets.length / args.pageSize)}  •  Commands: [n]ext [p]rev [r]efresh [#]details [q]uit`,
        colors.dim
      )
    );
  }

  async function showDetails(index) {
    const w = wallets[index];
    clearScreen();
    console.log(headerLine("Wallet Details", `${arbHint} | ${coreHint}`));
    console.log(colorText(`Nickname: ${w.nickname || ""}`, colors.cyan));
    console.log(colorText(`Address : ${w.address}`, colors.cyan));
    console.log(colorText(`CoreVault: ${vaultAddress}`, colors.dim));
    console.log("");

    try {
      const [ethWei, breakdown, unified, utilBps] = await Promise.all([
        arbProvider.getBalance(w.address),
        vault.getCollateralBreakdown(w.address),
        vault.getUnifiedMarginSummary(w.address),
        vault.getMarginUtilization(w.address),
      ]);

      const deposited = breakdown.depositedCollateral ?? breakdown[0];
      const credit = breakdown.crossChainCredit ?? breakdown[1];
      const withdrawable = breakdown.withdrawableCollateral ?? breakdown[2];
      const availableForTrading = breakdown.availableForTrading ?? breakdown[3];

      const totalCollateral = unified.totalCollateral ?? unified[0];
      const marginUsed = unified.marginUsedInPositions ?? unified[1];
      const marginReserved = unified.marginReservedForOrders ?? unified[2];
      const availableMargin = unified.availableMargin ?? unified[3];
      const totalCommitted = unified.totalMarginCommitted ?? unified[6];
      const isHealthy = unified.isMarginHealthy ?? unified[7];

      console.log(colorText("ETH", colors.bright));
      console.log(`  balance: ${fmtEth(ethWei)} ETH`);
      console.log("");

      console.log(colorText("CoreVault collateral breakdown (USDC, 6 decimals)", colors.bright));
      console.log(`  depositedCollateral   : ${fmtUsdc6(deposited)}`);
      console.log(`  crossChainCredit      : ${fmtUsdc6(credit)}`);
      console.log(`  withdrawableCollateral: ${fmtUsdc6(withdrawable)}`);
      console.log(`  availableForTrading   : ${fmtUsdc6(availableForTrading)}`);
      console.log("");

      console.log(colorText("CoreVault unified margin (USDC, 6 decimals)", colors.bright));
      console.log(`  totalCollateral       : ${fmtUsdc6(totalCollateral)}`);
      console.log(`  marginUsedInPositions : ${fmtUsdc6(marginUsed)}`);
      console.log(`  marginReservedOrders  : ${fmtUsdc6(marginReserved)}`);
      console.log(`  availableMargin       : ${fmtUsdc6(availableMargin)}`);
      console.log(`  totalCommitted        : ${fmtUsdc6(totalCommitted)}`);
      console.log(
        `  utilization           : ${(Number(utilBps) / 100).toFixed(2)}% (${utilBps.toString()} bps)`
      );
      console.log(
        `  isMarginHealthy       : ${
          isHealthy ? colorText("YES", colors.green) : colorText("NO", colors.red)
        }`
      );
    } catch (e) {
      console.log(colorText(`Error fetching wallet details: ${e?.message || String(e)}`, colors.red));
    }

    console.log("");
    console.log(colorText("Press Enter to return…", colors.dim));
    await rl.question("");
  }

  await renderOnce();
  if (args.once) {
    rl.close();
    return;
  }

  while (true) {
    const cmd = (await rl.question(colorText("> ", colors.dim))).trim().toLowerCase();
    if (cmd === "q" || cmd === "quit" || cmd === "exit") break;
    if (cmd === "n" || cmd === "next") {
      page = Math.min(page + 1, Math.ceil(wallets.length / args.pageSize) - 1);
      await renderOnce();
      continue;
    }
    if (cmd === "p" || cmd === "prev") {
      page = Math.max(page - 1, 0);
      await renderOnce();
      continue;
    }
    if (cmd === "r" || cmd === "refresh") {
      await renderOnce();
      continue;
    }
    if (/^\d+$/.test(cmd)) {
      const idx = Number(cmd) - 1;
      if (idx >= 0 && idx < wallets.length) {
        await showDetails(idx);
        await renderOnce();
      } else {
        console.log(colorText("Index out of range.", colors.yellow));
      }
      continue;
    }
    console.log(colorText("Unknown command. Use n/p/r/#/q.", colors.yellow));
  }

  rl.close();
  clearScreen();
  console.log(colorText("Bye.", colors.dim));
}

main().catch((e) => {
  console.error(colorText(e?.stack || e?.message || String(e), colors.red));
  process.exit(1);
});


